import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import fastifyCookie from '@fastify/cookie'

import { useZodSchemas } from '../api/schemas.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import type { OnAir } from './on-air.js'
import type { RadioSettings } from './settings.js'
import { soundCloudClient } from './soundcloud.js'
import type { HlsStream, PlaylistTracks, SoundCloudClient, SoundCloudCredentials, SoundCloudTrack } from './soundcloud.js'
import type { StoredSoundCloudCredentials } from './soundcloud-credentials.js'
import { soundCloudApp } from './soundcloud-app.js'
import { radioRoutes } from './routes.js'
import type { Radio } from './routes.js'
import { inQuebecTime } from '../api/formats.js'

const checkCredentials = vi.fn<SoundCloudClient['checkCredentials']>()
const playlist = vi.fn<SoundCloudClient['playlist']>()
const resolvePlaylist = vi.fn<SoundCloudClient['resolvePlaylist']>()
const hlsStream = vi.fn<SoundCloudClient['hlsStream']>()
const resolveTrack = vi.fn<SoundCloudClient['resolveTrack']>()
// Every client is a new one, as far as the routes can tell, but they all share the mocks above.
const newClient = vi.fn<(credentials: SoundCloudCredentials) => SoundCloudClient>(() => ({ checkCredentials, playlist, resolvePlaylist, resolveTrack, hlsStream }))

// The credentials of the SoundCloud app, as the database would keep them.
let entered: StoredSoundCloudCredentials | null = null
const loadCredentials = vi.fn<() => Promise<StoredSoundCloudCredentials | null>>()
const saveCredentials = vi.fn<(credentials: StoredSoundCloudCredentials) => Promise<void>>()

// The track on air, as the database would keep it.
let stored: OnAir | null = null
const load = vi.fn<() => Promise<OnAir | null>>()
const save = vi.fn<(onAir: OnAir) => Promise<void>>()

// The playlist chosen for the rotation, as the database would keep it.
let chosen: RadioSettings | null = null
const loadSettings = vi.fn<() => Promise<RadioSettings | null>>()
const saveSettings = vi.fn<(settings: RadioSettings) => Promise<void>>()

function track(id: number, title: string, overrides: Partial<SoundCloudTrack> = {}): SoundCloudTrack {
  return {
    id: String(id),
    title,
    durationMs: 3_600_000,
    unplayable: null,
    secretToken: null,
    ...overrides,
  }
}

const ROTATION = {
  title: 'Rotation',
  url: 'https://soundcloud.com/parkingdotradio/sets/rotation',
  private: false,
  account: { name: 'parking.radio', url: 'https://soundcloud.com/parkingdotradio' },
}

// What the client returns for a playlist of these tracks, all of which SoundCloud described as expected.
function soundCloudTracks(...tracks: SoundCloudTrack[]): PlaylistTracks {
  return { playlist: ROTATION, tracks }
}

const NOW = new Date('2026-10-01T12:00:00Z').getTime()
const MINUTE = 60 * 1000

const CHOSEN: RadioSettings = {
  playlistId: '7',
  secretToken: null,
  url: ROTATION.url,
  title: 'Rotation',
  updatedBy: 'someone@example.com',
  updatedAt: NOW - 24 * 60 * MINUTE,
}

const ENTERED: StoredSoundCloudCredentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  updatedBy: 'someone@example.com',
  updatedAt: new Date(NOW - 48 * 60 * MINUTE),
}

function streamFor(id: number, expiresAt = NOW + 62 * MINUTE): HlsStream {
  return { url: `https://cdn.test/${id}/playlist.m3u8?n=${hlsStream.mock.calls.length}`, expiresAt }
}

async function buildApp(logs?: string[]) {
  const app = Fastify({ logger: logs ? { stream: { write: (line: string) => logs.push(line) } } : false })
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(radioRoutes, {
    soundcloud: soundCloudApp(newClient, { load: loadCredentials, save: saveCredentials }),
    onAir: { load, save },
    settings: { load: loadSettings, save: saveSettings },
  })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function radio(app: App, query = ''): Promise<Radio> {
  return (await app.inject({ method: 'GET', url: `/api/radio${query}` })).json()
}

// The track on air, then the ones after it.
async function inOrder(app: App) {
  const { current, upcoming } = await radio(app)
  return [current.track, ...upcoming]
}

async function streamUrl(app: App) {
  return (await app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })).json().url
}

async function streamStatus(app: App, id: string) {
  return (await app.inject({ method: 'GET', url: `/api/radio/tracks/${id}/stream` })).statusCode
}

describe('radio routes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    process.env.JWT_SECRET = 'test-secret'
    newClient.mockClear()
    checkCredentials.mockReset().mockResolvedValue(true)
    playlist.mockReset()
    resolvePlaylist.mockReset()
    hlsStream.mockReset()
    playlist.mockResolvedValue(soundCloudTracks(track(1, 'NIM K | parking.radio | 2026.03.14')))
    hlsStream.mockImplementation(async (id: string) => streamFor(Number(id)))
    stored = null
    load.mockReset().mockImplementation(async () => stored)
    save.mockReset().mockImplementation(async (onAir) => {
      stored = onAir
    })
    chosen = CHOSEN
    entered = ENTERED
    loadCredentials.mockReset().mockImplementation(async () => entered)
    saveCredentials.mockReset().mockImplementation(async (credentials) => {
      entered = credentials
    })
    loadSettings.mockReset().mockImplementation(async () => chosen)
    saveSettings.mockReset().mockImplementation(async (settings) => {
      chosen = settings
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete process.env.JWT_SECRET
  })

  describe('GET /api/radio', () => {
    it("returns what's on air and what comes next, parsed from the tracks' titles, without private tracks' secrets", async () => {
      playlist.mockResolvedValue(soundCloudTracks(
        track(1, 'NIM K | parking.radio | 2026.03.14', { durationMs: 3_420_000 }),
        track(2, 'ZEFRA | HAUTE RIVE TAKEOVER @ parking.radio | 2026.09.13', { secretToken: 's-XyZ789' }),
        track(3, '  Lumo | QRTZ TAKEOVER @ PARKING.RADIO | 2026.04.19 '),
      ))
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio' })

      expect(response.statusCode).toBe(200)
      const nimK = {
        id: '1',
        artist: 'NIM K',
        event: null,
        date: '2026-03-14',
        durationMs: 3_420_000,
      }
      expect(response.json()).toEqual({
        current: { track: nimK, startedAt: '2026-10-01T08:00:00-04:00' },
        upcoming: [
          {
            id: '2',
            artist: 'ZEFRA',
            event: 'HAUTE RIVE TAKEOVER',
            date: '2026-09-13',
            durationMs: 3_600_000,
          },
          {
            id: '3',
            artist: 'Lumo',
            event: 'QRTZ TAKEOVER',
            date: '2026-04-19',
            durationMs: 3_600_000,
          },
        ],
      })
      expect(playlist).toHaveBeenCalledWith('7', null)
    })

    it('uses a title that does not follow the usual pattern whole', async () => {
      playlist.mockResolvedValue(soundCloudTracks(track(1, 'Special broadcast')))
      const app = await buildApp()

      const { current } = await radio(app)

      expect(current.track).toMatchObject({ artist: 'Special broadcast', event: null, date: null })
    })

    it('uses a title whose day does not exist whole', async () => {
      playlist.mockResolvedValue(soundCloudTracks(track(1, 'NIM K | parking.radio | 2026.02.29'), track(2, 'LEAP | parking.radio | 2028.02.29')))
      const app = await buildApp()

      const [nimK, leap] = await inOrder(app)

      expect(nimK).toMatchObject({ artist: 'NIM K | parking.radio | 2026.02.29', event: null, date: null })
      expect(leap).toMatchObject({ artist: 'LEAP', date: '2028-02-29' })
    })

    it('reads a private playlist with its secret', async () => {
      chosen = { ...CHOSEN, secretToken: 's-AbC123' }
      const app = await buildApp()

      await radio(app)

      expect(playlist).toHaveBeenCalledWith('7', 's-AbC123')
    })

    it("keeps the playlist's order", async () => {
      playlist.mockResolvedValue(soundCloudTracks(
        track(1, 'NEW | parking.radio | 2026.09.27'),
        track(2, 'OLD | parking.radio | 2026.03.14'),
        track(3, 'MIDDLE | parking.radio | 2026.06.07'),
      ))
      const app = await buildApp()

      const tracks = await inOrder(app)

      expect(tracks.map((t) => t.artist)).toEqual(['NEW', 'OLD', 'MIDDLE'])
    })

    it('leaves out tracks that SoundCloud describes unexpectedly', async () => {
      playlist.mockResolvedValue({
        playlist: ROTATION,
        tracks: [
          { invalid: true, name: 'B | parking.radio | 2026.09.11', problem: '✖ Invalid input: expected number, received null → at duration' },
          track(1, 'A | parking.radio | 2026.09.10'),
        ],
      })
      const app = await buildApp()

      const tracks = await inOrder(app)

      expect(tracks.map((t) => t.id)).toEqual(['1'])
    })

    it('leaves out tracks that cannot be played in full', async () => {
      playlist.mockResolvedValue(soundCloudTracks(
        track(1, 'A | parking.radio | 2026.09.10'),
        track(2, 'B | parking.radio | 2026.09.11', { unplayable: 'preview' }),
      ))
      const app = await buildApp()

      const tracks = await inOrder(app)

      expect(tracks.map((t) => t.id)).toEqual(['1'])
    })

    it.each([
      ['SoundCloud fails', () => playlist.mockRejectedValue(new Error('SoundCloud responded with 500'))],
      ['no track can be played', () => playlist.mockResolvedValue(soundCloudTracks(track(1, 'A', { unplayable: 'preview' })))],
      ['the playlist has no tracks', () => playlist.mockResolvedValue(soundCloudTracks())],
      ['the track on air cannot be loaded', () => load.mockRejectedValue(new Error('Connection terminated'))],
      ['the chosen playlist cannot be loaded', () => loadSettings.mockRejectedValue(new Error('Connection terminated'))],
    ])('responds 502 when %s', async (_, setUp) => {
      setUp()
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio' })

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ ok: false, error: 'The radio is unavailable right now' })
    })

    it('responds 503 when no playlist has been chosen yet', async () => {
      chosen = null
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio' })

      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({ ok: false, error: 'No playlist has been chosen for the radio yet' })
      expect(playlist).not.toHaveBeenCalled()
    })

    it('reads the rotation through the credentials of the SoundCloud app that were entered', async () => {
      const app = await buildApp()

      await radio(app)

      expect(newClient).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientId: 'client-id', clientSecret: 'client-secret' }))
    })

    it('responds 502 until the credentials of the SoundCloud app have been entered', async () => {
      entered = null
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio' })

      expect(response.statusCode).toBe(502)
      expect(newClient).not.toHaveBeenCalled()
    })

    it('reads the rotation anew through other credentials entered elsewhere, going on with what it read before if that fails', async () => {
      const app = await buildApp()
      await radio(app)

      entered = { ...ENTERED, clientId: 'other-id', clientSecret: 'other-secret', updatedAt: new Date(NOW) }
      playlist.mockRejectedValue(new Error('SoundCloud refused to issue a token: 401'))

      expect((await radio(app)).current.track.id).toBe('1')
      expect(playlist).toHaveBeenCalledTimes(2)
      expect(newClient).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'other-id', clientSecret: 'other-secret' }))
    })

    it('asks SoundCloud at most once every 5 minutes', async () => {
      const app = await buildApp()

      await app.inject({ method: 'GET', url: '/api/radio' })
      vi.advanceTimersByTime(4 * MINUTE)
      await app.inject({ method: 'GET', url: '/api/radio' })
      expect(playlist).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2 * MINUTE)
      await app.inject({ method: 'GET', url: '/api/radio' })
      expect(playlist).toHaveBeenCalledTimes(2)
    })

    it('shares a fetch that is in flight between requests', async () => {
      const app = await buildApp()

      const responses = await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url: '/api/radio' })))

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200])
      expect(playlist).toHaveBeenCalledTimes(1)
    })

    it('goes on with the rotation it read before when SoundCloud fails, and tries again a minute later', async () => {
      const app = await buildApp()
      await app.inject({ method: 'GET', url: '/api/radio' })

      playlist.mockRejectedValueOnce(new Error('SoundCloud responded with 500'))
      vi.advanceTimersByTime(6 * MINUTE)
      expect((await radio(app)).current.track.id).toBe('1')
      expect(playlist).toHaveBeenCalledTimes(2)

      playlist.mockResolvedValue(soundCloudTracks(track(2, 'A | parking.radio | 2026.09.10')))
      vi.advanceTimersByTime(59 * 1000)
      expect((await radio(app)).current.track.id).toBe('1')
      vi.advanceTimersByTime(1000)
      expect((await radio(app)).current.track.id).toBe('2')
      expect(playlist).toHaveBeenCalledTimes(3)
    })

    it('tries again a minute later when SoundCloud fails before the rotation could ever be read', async () => {
      playlist.mockRejectedValueOnce(new Error('SoundCloud responded with 500'))
      const app = await buildApp()
      expect((await app.inject({ method: 'GET', url: '/api/radio' })).statusCode).toBe(502)

      vi.advanceTimersByTime(MINUTE)
      expect((await app.inject({ method: 'GET', url: '/api/radio' })).statusCode).toBe(200)
    })

    it('reads the rotation anew from another playlist chosen elsewhere, e.g. by another server', async () => {
      const app = await buildApp()
      await radio(app)

      chosen = { ...CHOSEN, playlistId: '8' }
      playlist.mockResolvedValue(soundCloudTracks(track(2, 'A | parking.radio | 2026.09.10')))

      expect((await radio(app)).current.track.id).toBe('2')
      expect(playlist).toHaveBeenLastCalledWith('8', null)
    })
  })

  describe("what's on air", () => {
    // A set recorded on day `day` of September, which lasts `minutes`.
    const set = (id: number, day: number, minutes: number) =>
      track(id, `S${id} | parking.radio | 2026.09.${String(day).padStart(2, '0')}`, { durationMs: minutes * MINUTE })
    const onAir = async (app: App, query = '') => {
      const { current, upcoming } = await radio(app, query)
      return { id: current.track.id, startedAt: new Date(current.startedAt).getTime(), upcoming: upcoming.map((t) => t.id) }
    }

    it('puts the first track of the rotation on air the first time, and saves it', async () => {
      playlist.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60)))
      const app = await buildApp()

      expect(await onAir(app)).toEqual({ id: '1', startedAt: NOW, upcoming: ['2'] })
      expect(save).toHaveBeenCalledExactlyOnceWith({ playlistId: '7', trackId: '1', startedAt: NOW, nextTrackIds: ['2'] })
    })

    it('puts the first track of the rotation on air when the track on air is from another playlist', async () => {
      playlist.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60)))
      stored = { playlistId: '6', trackId: '2', startedAt: NOW - 10 * MINUTE, nextTrackIds: ['1'] }
      const app = await buildApp()

      expect(await onAir(app)).toEqual({ id: '1', startedAt: NOW, upcoming: ['2'] })
      expect(stored).toEqual({ playlistId: '7', trackId: '1', startedAt: NOW, nextTrackIds: ['2'] })
    })

    it('keeps a track on air until it ends, then moves on to the next one', async () => {
      playlist.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60)))
      const app = await buildApp()
      await onAir(app)

      vi.advanceTimersByTime(59 * MINUTE)
      expect(await onAir(app)).toMatchObject({ id: '1', startedAt: NOW })
      expect(save).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2 * MINUTE)
      expect(await onAir(app)).toMatchObject({ id: '2', startedAt: NOW + 60 * MINUTE })
      expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: '2', startedAt: NOW + 60 * MINUTE }))
    })

    it('picks up where the radio was after the server restarts', async () => {
      playlist.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60)))
      const before = await buildApp()
      await onAir(before)
      vi.advanceTimersByTime(70 * MINUTE)
      await onAir(before)
      save.mockClear()

      const after = await buildApp()
      vi.advanceTimersByTime(5 * MINUTE)

      expect(await onAir(after)).toMatchObject({ id: '2', startedAt: NOW + 60 * MINUTE })
      expect(save).not.toHaveBeenCalled()
    })

    it('only changes what comes after the track on air when the rotation changes', async () => {
      playlist.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(3, 3, 60)))
      const app = await buildApp()
      await onAir(app)
      vi.advanceTimersByTime(70 * MINUTE)
      expect(await onAir(app)).toMatchObject({ id: '3', startedAt: NOW + 60 * MINUTE })

      // A set recorded before the one on air and one recorded after it get uploaded.
      playlist.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60), set(3, 3, 60), set(4, 4, 60)))
      vi.advanceTimersByTime(6 * MINUTE)

      expect(await onAir(app)).toEqual({ id: '3', startedAt: NOW + 60 * MINUTE, upcoming: ['4', '1', '2'] })
    })

    it('catches up after nobody listened for a long time', async () => {
      // 90 minutes a round, so 10 days is 160 rounds, and 70 minutes more is 10 minutes into the second set.
      playlist.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 30)))
      const app = await buildApp()
      await onAir(app)

      vi.advanceTimersByTime(10 * 24 * 60 * MINUTE + 70 * MINUTE)

      expect(await onAir(app)).toMatchObject({ id: '2', startedAt: NOW + 10 * 24 * 60 * MINUTE + 60 * MINUTE })
    })

    it.each([
      ['goes on with the track that came after it', 2, [2], 3],
      ['goes on with the first of the tracks after it that is still in the rotation', 2, [2, 3], 4],
      ['goes on with the first track when it was the last one', 4, [4], 1],
    ])('takes a track that left the rotation off air right away, and %s', async (_, left, removed, next) => {
      const ids = [1, 2, 3, 4]
      playlist.mockResolvedValue(soundCloudTracks(...ids.map((id) => set(id, id, 60))))
      const app = await buildApp()
      await onAir(app)
      vi.advanceTimersByTime((left - 1) * 60 * MINUTE + 10 * MINUTE)
      expect(await onAir(app)).toMatchObject({ id: String(left) })

      playlist.mockResolvedValue(soundCloudTracks(...ids.filter((id) => !removed.includes(id)).map((id) => set(id, id, 60))))
      vi.advanceTimersByTime(6 * MINUTE)

      expect(await onAir(app)).toMatchObject({ id: String(next), startedAt: Date.now() })
      expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: String(next), startedAt: Date.now() }))
    })

    describe('what comes after the track on air', () => {
      // With the third of four sets on air.
      async function buildAppOnTrack3() {
        playlist.mockResolvedValue(soundCloudTracks(...[1, 2, 3, 4].map((id) => set(id, id, 60))))
        const app = await buildApp()
        await onAir(app)
        vi.advanceTimersByTime(120 * MINUTE)
        return app
      }

      it('is the rest of the rotation, in the order it comes after the track on air', async () => {
        const app = await buildAppOnTrack3()

        expect(await onAir(app)).toMatchObject({ id: '3', upcoming: ['4', '1', '2'] })
      })

      it.each([
        ['2', ['4', '1']],
        ['0', []],
        ['10', ['4', '1', '2']],
      ])('is as many tracks as asked for, with ?upcoming=%s', async (count, upcoming) => {
        const app = await buildAppOnTrack3()

        expect((await onAir(app, `?upcoming=${count}`)).upcoming).toEqual(upcoming)
      })
    })

    it.each(['-1', '1.5', 'all', ''])('responds 400 to ?upcoming=%s', async (count) => {
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: `/api/radio?upcoming=${count}` })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: '`upcoming`: Invalid input: expected a whole number' })
      expect(playlist).not.toHaveBeenCalled()
    })

    it('still answers when the track on air cannot be saved', async () => {
      save.mockRejectedValue(new Error('Connection terminated'))
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio' })

      expect(response.statusCode).toBe(200)
      expect(response.json().current.track.id).toBe('1')
    })
  })

  describe('GET /api/radio/tracks/:id/stream', () => {
    it("returns where to stream the track from, and until when that's possible", async () => {
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        url: 'https://cdn.test/1/playlist.m3u8?n=1',
        expiresAt: '2026-10-01T09:02:00-04:00',
      })
      expect(hlsStream).toHaveBeenCalledWith('1', null)
    })

    // The SoundCloud client only gives expiries from the year 2000 to 2999, in UTC (see radio/soundcloud.ts), which all
    // make timestamps.
    it.each([
      ['2000-01-01T00:00:00.000Z', '1999-12-31T19:00:00-05:00'],
      ['2999-12-31T23:59:59.999Z', '2999-12-31T18:59:59-05:00'],
    ])('hands out a stream that expires at %s', async (expiresAt, given) => {
      hlsStream.mockResolvedValue(streamFor(1, Date.parse(expiresAt)))
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })

      expect(response.statusCode).toBe(200)
      expect(response.json().expiresAt).toBe(given)
    })

    it('streams a private track with its secret, as it was last read', async () => {
      playlist.mockResolvedValue(soundCloudTracks(track(1, 'A', { secretToken: 's-AbC123' })))
      const app = await buildApp()

      expect(await streamStatus(app, '1')).toBe(200)
      expect(hlsStream).toHaveBeenLastCalledWith('1', 's-AbC123')

      // Its private link is reset: once the stream URL can't be shared anymore, the next one is asked for with the new secret.
      playlist.mockResolvedValue(soundCloudTracks(track(1, 'A', { secretToken: 's-DeF456' })))
      vi.advanceTimersByTime(31 * MINUTE)
      expect(await streamStatus(app, '1')).toBe(200)
      expect(hlsStream).toHaveBeenLastCalledWith('1', 's-DeF456')

      // Once it's made public, it's streamed without a secret.
      playlist.mockResolvedValue(soundCloudTracks(track(1, 'A')))
      vi.advanceTimersByTime(31 * MINUTE)
      expect(await streamStatus(app, '1')).toBe(200)
      expect(hlsStream).toHaveBeenLastCalledWith('1', null)
    })

    it.each(['2', 'abc', '1%2Fstreams'])('responds 404 for a track that is not in the rotation (%s)', async (id) => {
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: `/api/radio/tracks/${id}/stream` })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'Not a track of the radio rotation' })
      expect(hlsStream).not.toHaveBeenCalled()
    })

    it('responds 404 when no playlist has been chosen yet', async () => {
      chosen = null
      const app = await buildApp()

      expect(await streamStatus(app, '1')).toBe(404)
    })

    it('still streams a track that left the playlist for as long as it lasts, so that its listeners can finish it', async () => {
      playlist.mockResolvedValue(soundCloudTracks(track(1, 'A', { durationMs: 30 * MINUTE }), track(2, 'B')))
      const app = await buildApp()
      await radio(app)

      playlist.mockResolvedValue(soundCloudTracks(track(2, 'B')))
      vi.advanceTimersByTime(6 * MINUTE)
      await radio(app)

      vi.advanceTimersByTime(30 * MINUTE - 1)
      expect(await streamStatus(app, '1')).toBe(200)
      vi.advanceTimersByTime(1)
      expect(await streamStatus(app, '1')).toBe(404)
    })

    it('still streams a private track that left the playlist with its secret', async () => {
      playlist.mockResolvedValue(soundCloudTracks(track(1, 'A', { secretToken: 's-AbC123' }), track(2, 'B')))
      const app = await buildApp()
      await radio(app)

      playlist.mockResolvedValue(soundCloudTracks(track(2, 'B')))
      vi.advanceTimersByTime(6 * MINUTE)
      await radio(app)

      expect(await streamStatus(app, '1')).toBe(200)
      expect(hlsStream).toHaveBeenLastCalledWith('1', 's-AbC123')
    })

    it('responds 502 when the rotation is unavailable', async () => {
      playlist.mockRejectedValue(new Error('SoundCloud responded with 500'))
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ ok: false, error: 'The radio is unavailable right now' })
    })

    it('asks for streams again through other credentials entered elsewhere', async () => {
      const app = await buildApp()
      const first = await streamUrl(app)

      entered = { ...ENTERED, clientId: 'other-id', clientSecret: 'other-secret', updatedAt: new Date(NOW) }

      expect(await streamUrl(app)).not.toBe(first)
      expect(hlsStream).toHaveBeenCalledTimes(2)
      expect(newClient).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'other-id' }))
    })

    it('responds 502 when SoundCloud fails to give a stream, and tries again 30 seconds later', async () => {
      hlsStream.mockRejectedValueOnce(new Error('SoundCloud did not redirect to a stream'))
      const app = await buildApp()

      const failed = await app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })
      expect(failed.statusCode).toBe(502)
      expect(failed.json()).toEqual({ ok: false, error: 'This track cannot be played right now' })

      vi.advanceTimersByTime(29 * 1000)
      const stillFailed = await app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })
      expect(stillFailed.statusCode).toBe(502)
      expect(hlsStream).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1000)
      const retried = await app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })
      expect(retried.statusCode).toBe(200)
      expect(hlsStream).toHaveBeenCalledTimes(2)
    })

    it('shares a stream URL between listeners for up to 30 minutes', async () => {
      const app = await buildApp()

      const first = await streamUrl(app)
      vi.advanceTimersByTime(29 * MINUTE)
      expect(await streamUrl(app)).toBe(first)
      expect(hlsStream).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2 * MINUTE)
      expect(await streamUrl(app)).not.toBe(first)
      expect(hlsStream).toHaveBeenCalledTimes(2)
    })

    it('does not hand out a stream URL that is about to expire', async () => {
      // A 10 minute track, whose playlist URL expires 2 minutes after it would have ended.
      hlsStream.mockImplementation(async () => streamFor(1, Date.now() + 12 * MINUTE))
      const app = await buildApp()

      const first = await streamUrl(app)
      vi.advanceTimersByTime(9 * MINUTE)
      expect(await streamUrl(app)).toBe(first)

      vi.advanceTimersByTime(2 * MINUTE)
      expect(await streamUrl(app)).not.toBe(first)
    })

    it('shares a stream request that is in flight', async () => {
      const app = await buildApp()

      const responses = await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })))

      expect(new Set(responses.map((response) => response.json().url)).size).toBe(1)
      expect(hlsStream).toHaveBeenCalledTimes(1)
    })
  })

  describe('admin', () => {
    async function settings(app: App) {
      return (await app.inject({ method: 'GET', url: '/api/admin/radio', cookies: await sessionCookies() })).json()
    }

    async function post(app: App, url: string, body: unknown) {
      return app.inject({ method: 'POST', url, payload: body as object, cookies: await sessionCookies() })
    }

    // Sends `body` as JSON, whatever it is, e.g. `null`, or no body at all when it's undefined.
    async function sendJson(app: App, method: 'POST' | 'PUT', url: string, body: unknown, headers: Record<string, string> = {}) {
      const json = body === undefined ? {} : { headers: { 'content-type': 'application/json', ...headers }, payload: JSON.stringify(body) }
      return app.inject({ method, url, headers, ...json, cookies: await sessionCookies() })
    }

    // Requests that are refused before they're handled.
    function expectNothingDone() {
      expect(saveSettings).not.toHaveBeenCalled()
      expect(saveCredentials).not.toHaveBeenCalled()
      expect(checkCredentials).not.toHaveBeenCalled()
      expect(resolvePlaylist).not.toHaveBeenCalled()
    }

    // Another playlist, at LINK, with two sets.
    const LINK = 'https://soundcloud.com/parkingdotradio/sets/other/s-AbC123'
    const other = (...tracks: SoundCloudTrack[]): PlaylistTracks => ({
      playlist: { ...ROTATION, title: 'Other', url: LINK, private: true },
      tracks,
    })
    function otherPlaylistAtLink(tracks = [track(8, 'H | parking.radio | 2026.09.08'), track(9, 'I | parking.radio | 2026.09.09')]) {
      resolvePlaylist.mockResolvedValue({ id: '9', secretToken: 's-AbC123' })
      playlist.mockImplementation(async (id) => (id === '9' ? other(...tracks) : soundCloudTracks(track(1, 'A'), track(2, 'B'))))
    }

    const CHANGES = [
      ['POST', '/api/admin/radio/preview', { link: LINK }],
      ['POST', '/api/admin/radio/playlist', { link: LINK }],
      ['PUT', '/api/admin/radio/credentials', { clientId: 'id', clientSecret: 'secret' }],
      ['POST', '/api/admin/radio/credentials/check', { clientId: 'id', clientSecret: 'secret' }],
    ] as const

    it.each([
      ['GET', '/api/admin/radio', undefined],
      ['GET', '/api/admin/radio/credentials', undefined],
      ...CHANGES,
    ] as const)('responds 401 to %s %s without a session, whatever the request', async (method, url, payload) => {
      const app = await buildApp()

      // Bodies that are valid, invalid, null, or not even JSON.
      for (const sent of payload ? [JSON.stringify(payload), '{}', 'null', '{'] : [undefined]) {
        const headers = sent === undefined ? {} : { 'content-type': 'application/json' }
        const response = await app.inject({ method, url, headers, payload: sent })

        expect(response.statusCode).toBe(401)
        expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' })
      }
      expectNothingDone()
    })

    it.each(CHANGES)('responds 403 to %s %s from another origin, whatever the request', async (method, url, payload) => {
      const app = await buildApp()

      for (const sent of [payload, {}, null]) {
        const response = await sendJson(app, method, url, sent, { 'sec-fetch-site': 'cross-site' })

        expect(response.statusCode).toBe(403)
        expect(response.json()).toEqual({ ok: false, error: 'Cross-origin request refused' })
      }
      expectNothingDone()
    })

    describe('GET /api/admin/radio', () => {
      it('returns null until a playlist has been chosen', async () => {
        chosen = null
        const app = await buildApp()

        expect(await settings(app)).toEqual({ ok: true, credentialsEntered: true, current: null })
      })

      it('returns the chosen playlist, with every track in it, in order, and whether it is on the radio', async () => {
        playlist.mockResolvedValue({
          playlist: ROTATION,
          tracks: [
            track(1, 'A | parking.radio | 2026.09.01'),
            track(3, 'PREVIEW | parking.radio | 2026.09.03', { unplayable: 'preview' }),
            track(4, 'Blocked', { unplayable: 'blocked' }),
            { invalid: true, name: 'Broken', problem: '✖ Invalid input' },
            track(2, 'B', { durationMs: 20 * MINUTE, secretToken: 's-XyZ789' }),
          ],
        })
        const app = await buildApp()

        expect(await settings(app)).toEqual({
          ok: true,
          credentialsEntered: true,
          current: {
            url: ROTATION.url,
            title: 'Rotation',
            chosenBy: 'someone@example.com',
            chosenAt: '2026-09-30T08:00:00-04:00',
            playlist: {
              url: ROTATION.url,
              title: 'Rotation',
              private: false,
              account: ROTATION.account,
              tracks: [
                {
                  kind: 'rotation',
                  track: { id: '1', artist: 'A', event: null, date: '2026-09-01', durationMs: 60 * MINUTE },
                },
                {
                  kind: 'left-out',
                  track: { id: '3', artist: 'PREVIEW', event: null, date: '2026-09-03', durationMs: 60 * MINUTE },
                  reason: 'preview',
                },
                {
                  kind: 'left-out',
                  track: { id: '4', artist: 'Blocked', event: null, date: null, durationMs: 60 * MINUTE },
                  reason: 'blocked',
                },
                { kind: 'unexpected', title: 'Broken' },
                {
                  kind: 'rotation',
                  track: { id: '2', artist: 'B', event: null, date: null, durationMs: 20 * MINUTE },
                },
              ],
            },
            error: null,
          },
        })
      })

      it('says why the playlist could not be read, while the radio goes on with what it read before', async () => {
        const app = await buildApp()
        await radio(app)

        playlist.mockRejectedValue(new Error('SoundCloud shows no such playlist'))
        vi.advanceTimersByTime(6 * MINUTE)

        const { current } = await settings(app)
        expect(current.error).toBe('SoundCloud shows no such playlist')
        expect(current.playlist).toMatchObject({ title: 'Rotation', tracks: [{ kind: 'rotation', track: { id: '1' } }] })
        expect((await radio(app)).current.track.id).toBe('1')
      })

      it('says that the credentials of the SoundCloud app have not been entered, and that nothing could be read', async () => {
        entered = null
        const app = await buildApp()

        const response = await settings(app)

        expect(response.credentialsEntered).toBe(false)
        // That's not a failure to read the playlist.
        expect(response.current).toMatchObject({ title: 'Rotation', playlist: null, error: null })
        expect(playlist).not.toHaveBeenCalled()
      })

      it('says that the credentials have not been entered before a playlist is chosen too', async () => {
        entered = null
        chosen = null
        const app = await buildApp()

        expect(await settings(app)).toEqual({ ok: true, credentialsEntered: false, current: null })
      })

      it('says why the playlist could not be read when it never could be', async () => {
        playlist.mockRejectedValue(new Error('SoundCloud responded with 500'))
        const app = await buildApp()

        const { current } = await settings(app)
        expect(current).toMatchObject({ title: 'Rotation', playlist: null, error: 'SoundCloud responded with 500' })
      })
    })

    describe.each(['/api/admin/radio/preview', '/api/admin/radio/playlist'])('POST %s', (url) => {
      it.each([
        ['an account', 'https://soundcloud.com/parkingdotradio'],
        ['a track', 'https://soundcloud.com/parkingdotradio/3tons'],
        ['another site', 'https://example.com/parkingdotradio/sets/rotation'],
        ['not a link', 'rotation'],
        ['empty', ''],
      ])('responds 400 when the link is %s', async (_, link) => {
        const app = await buildApp()

        const response = await post(app, url, { link })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'Not a link to a SoundCloud playlist' })
        expect(resolvePlaylist).not.toHaveBeenCalled()
      })

      it.each([
        [{ link: 42 }, '`link`: Invalid input: expected string, received number'],
        [{}, '`link`: Invalid input: expected string, received undefined'],
        [null, 'body: Invalid input: expected object, received null'],
        [LINK, 'body: Invalid input: expected object, received string'],
      ])('responds 400 to %j, saying why', async (body, error) => {
        const app = await buildApp()

        const response = await sendJson(app, 'POST', url, body)

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
        expect(resolvePlaylist).not.toHaveBeenCalled()
      })

      it('resolves the link without what does not identify the playlist', async () => {
        otherPlaylistAtLink()
        const app = await buildApp()

        await post(app, url, { link: ` https://www.soundcloud.com/parkingdotradio/sets/other/s-AbC123/?si=abc&utm_source=clipboard ` })

        expect(resolvePlaylist).toHaveBeenCalledWith(LINK)
        expect(playlist).toHaveBeenCalledWith('9', 's-AbC123')
      })

      it('responds 409 until the credentials of the SoundCloud app have been entered', async () => {
        entered = null
        const app = await buildApp()

        const response = await post(app, url, { link: LINK })

        expect(response.statusCode).toBe(409)
        expect(response.json()).toEqual({ ok: false, error: 'The credentials of the SoundCloud app have not been entered yet' })
        expect(resolvePlaylist).not.toHaveBeenCalled()
        expect(saveSettings).not.toHaveBeenCalled()
      })

      it('responds 404 when SoundCloud shows no playlist at the link', async () => {
        resolvePlaylist.mockResolvedValue(null)
        const app = await buildApp()

        const response = await post(app, url, { link: LINK })

        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual({ ok: false, error: 'SoundCloud shows no playlist at this link' })
      })

      it.each([
        ['resolving the link', () => resolvePlaylist.mockRejectedValue(new Error('SoundCloud responded to /resolve with 500'))],
        ['reading the playlist', () => {
          resolvePlaylist.mockResolvedValue({ id: '9', secretToken: null })
          playlist.mockRejectedValue(new Error('SoundCloud responded to /playlists with 500'))
        }],
      ])('responds 502 when SoundCloud fails %s', async (_, setUp) => {
        setUp()
        const app = await buildApp()

        const response = await post(app, url, { link: LINK })

        expect(response.statusCode).toBe(502)
        expect(response.json().error).toMatch(/^The playlist cannot be read from SoundCloud: SoundCloud responded to/)
        expect(saveSettings).not.toHaveBeenCalled()
      })
    })

    // Responses are checked against the API's schemas, so a quirk in SoundCloud's data that radio/soundcloud.ts accepts
    // must still make a valid response, rather than a 500.
    it('passes on whatever the SoundCloud client reads', async () => {
      const quirky: PlaylistTracks = {
        playlist: { title: '', url: 'https://soundcloud.com/', private: true, account: { name: '', url: 'https://soundcloud.com/' } },
        tracks: [
          track(1, '', { durationMs: 1 }),
          track(2, 'A | parking.radio | 2026.13.45'),
          track(3, '| parking.radio | 2026.09.13'),
          track(4, ' \u00a0 '),
          track(5, 'B | parking.radio | 2026.09.13', { unplayable: 'not-streamable' }),
          { invalid: true, name: '', problem: '✖ Invalid input' },
          { invalid: true, name: 'soundcloud:tracks:99', problem: '✖ Invalid input' },
          { invalid: true, name: 'A track with no title', problem: '✖ Invalid input' },
        ],
      }
      playlist.mockResolvedValue(quirky)
      resolvePlaylist.mockResolvedValue({ id: '7', secretToken: 's-AbC123' })
      const app = await buildApp()

      const onAir = await app.inject({ method: 'GET', url: '/api/radio' })
      expect(onAir.statusCode).toBe(200)
      expect([onAir.json().current.track, ...onAir.json().upcoming]).toEqual([
        { id: '1', artist: '', event: null, date: null, durationMs: 1 },
        { id: '2', artist: 'A | parking.radio | 2026.13.45', event: null, date: null, durationMs: 60 * MINUTE },
        { id: '3', artist: '| parking.radio | 2026.09.13', event: null, date: null, durationMs: 60 * MINUTE },
        { id: '4', artist: '', event: null, date: null, durationMs: 60 * MINUTE },
      ])

      const chosen = await app.inject({ method: 'GET', url: '/api/admin/radio', cookies: await sessionCookies() })
      expect(chosen.statusCode).toBe(200)
      expect(chosen.json().current.playlist.tracks.slice(4)).toEqual([
        { kind: 'left-out', track: expect.objectContaining({ id: '5' }), reason: 'not-streamable' },
        { kind: 'unexpected', title: '' },
        { kind: 'unexpected', title: 'soundcloud:tracks:99' },
        { kind: 'unexpected', title: 'A track with no title' },
      ])

      const preview = await post(app, '/api/admin/radio/preview', { link: LINK })
      expect(preview.statusCode).toBe(200)
      expect(preview.json().playlist).toEqual(chosen.json().current.playlist)
    })

    describe('POST /api/admin/radio/preview', () => {
      it('returns what the radio would read from the playlist, without choosing it', async () => {
        otherPlaylistAtLink()
        const app = await buildApp()

        const response = await post(app, '/api/admin/radio/preview', { link: LINK })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({
          ok: true,
          playlist: {
            url: LINK,
            title: 'Other',
            private: true,
            account: ROTATION.account,
            tracks: [
              {
                kind: 'rotation',
                track: { id: '8', artist: 'H', event: null, date: '2026-09-08', durationMs: 60 * MINUTE },
              },
              {
                kind: 'rotation',
                track: { id: '9', artist: 'I', event: null, date: '2026-09-09', durationMs: 60 * MINUTE },
              },
            ],
          },
        })
        expect(saveSettings).not.toHaveBeenCalled()
        expect((await radio(app)).current.track.id).toBe('1')
      })

      it('previews a playlist none of whose tracks can be played', async () => {
        otherPlaylistAtLink([track(8, 'H', { unplayable: 'preview' })])
        const app = await buildApp()

        const response = await post(app, '/api/admin/radio/preview', { link: LINK })

        expect(response.statusCode).toBe(200)
        expect(response.json().playlist.tracks).toEqual([{ kind: 'left-out', track: expect.objectContaining({ id: '8', artist: 'H' }), reason: 'preview' }])
      })
    })

    describe('POST /api/admin/radio/playlist', () => {
      it('chooses the playlist', async () => {
        otherPlaylistAtLink()
        const app = await buildApp()

        const response = await post(app, '/api/admin/radio/playlist', { link: LINK })

        expect(response.statusCode).toBe(200)
        expect(chosen).toEqual({
          playlistId: '9',
          secretToken: 's-AbC123',
          url: LINK,
          title: 'Other',
          updatedBy: 'admin@example.com',
          updatedAt: NOW,
        })
        expect(response.json()).toEqual({ ok: true })
        expect((await settings(app)).current).toMatchObject({ url: LINK, chosenBy: 'admin@example.com', chosenAt: '2026-10-01T08:00:00-04:00', error: null })
      })

      it('responds 400 when none of the tracks of the playlist can be played', async () => {
        otherPlaylistAtLink([track(8, 'H', { unplayable: 'preview' })])
        const app = await buildApp()

        const response = await post(app, '/api/admin/radio/playlist', { link: LINK })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'None of the tracks of this playlist can be played in full' })
        expect(saveSettings).not.toHaveBeenCalled()
      })

      it('puts the first track of the playlist on air right away, without reading it again', async () => {
        otherPlaylistAtLink()
        const app = await buildApp()
        await radio(app)
        vi.advanceTimersByTime(10 * MINUTE)

        await post(app, '/api/admin/radio/playlist', { link: LINK })
        vi.advanceTimersByTime(MINUTE)

        expect(await inOrder(app)).toMatchObject([{ id: '8' }, { id: '9' }])
        expect((await radio(app)).current.startedAt).toBe('2026-10-01T08:11:00-04:00')
        expect(playlist.mock.calls).toEqual([['7', null], ['9', 's-AbC123']])
      })

      it('keeps the track on air when the same playlist is chosen again', async () => {
        resolvePlaylist.mockResolvedValue({ id: '7', secretToken: null })
        playlist.mockResolvedValue(soundCloudTracks(track(1, 'A'), track(2, 'B')))
        const app = await buildApp()
        await radio(app)
        vi.advanceTimersByTime(70 * MINUTE)
        expect((await radio(app)).current.track.id).toBe('2')

        await post(app, '/api/admin/radio/playlist', { link: ROTATION.url })

        expect((await radio(app)).current).toMatchObject({ track: { id: '2' }, startedAt: '2026-10-01T09:00:00-04:00' })
      })

      it('still streams the tracks of the previous playlist for as long as they last, so that their listeners can finish them', async () => {
        otherPlaylistAtLink()
        playlist.mockImplementation(async (id) =>
          id === '9'
            ? other(track(8, 'H'), track(9, 'I'))
            : soundCloudTracks(track(1, 'A', { durationMs: 30 * MINUTE }), track(2, 'B', { durationMs: 60 * MINUTE })),
        )
        const app = await buildApp()
        await radio(app)

        await post(app, '/api/admin/radio/playlist', { link: LINK })

        expect(await streamStatus(app, '8')).toBe(200)
        vi.advanceTimersByTime(30 * MINUTE - 1)
        expect(await streamStatus(app, '1')).toBe(200)
        vi.advanceTimersByTime(1)
        expect(await streamStatus(app, '1')).toBe(404)
        expect(await streamStatus(app, '2')).toBe(200)
        vi.advanceTimersByTime(30 * MINUTE)
        expect(await streamStatus(app, '2')).toBe(404)
      })
    })

    describe('/api/admin/radio/credentials', () => {
      const URL = '/api/admin/radio/credentials'
      const PLAYLIST_FAILED = 'SoundCloud responded to /playlists with 500'

      async function credentials(app: App) {
        return (await app.inject({ method: 'GET', url: URL, cookies: await sessionCookies() })).json()
      }

      async function put(app: App, body: unknown) {
        return app.inject({ method: 'PUT', url: URL, payload: body as object, cookies: await sessionCookies() })
      }

      it('returns null until the credentials have been entered', async () => {
        entered = null
        const app = await buildApp()

        expect(await credentials(app)).toEqual({ ok: true, credentials: null })
      })

      it('returns the client id, and who entered the credentials and when, but never the secret', async () => {
        const app = await buildApp()

        const response = await credentials(app)

        expect(response).toEqual({
          ok: true,
          credentials: { clientId: 'client-id', updatedBy: 'someone@example.com', updatedAt: inQuebecTime(ENTERED.updatedAt), error: null },
        })
        expect(JSON.stringify(response)).not.toContain('client-secret')
      })

      it("says why the radio's last read of its playlist failed, reading it again when that's due, and a read that succeeds clears it", async () => {
        const app = await buildApp()
        await radio(app)

        playlist.mockRejectedValue(new Error(PLAYLIST_FAILED))
        vi.advanceTimersByTime(6 * MINUTE)
        expect((await credentials(app)).credentials.error).toBe(PLAYLIST_FAILED)
        expect(playlist).toHaveBeenCalledTimes(2)

        playlist.mockResolvedValue(soundCloudTracks(track(1, 'A')))
        vi.advanceTimersByTime(MINUTE - 1)
        expect((await credentials(app)).credentials.error).toBe(PLAYLIST_FAILED)
        vi.advanceTimersByTime(1)
        expect((await credentials(app)).credentials.error).toBeNull()
        expect(playlist).toHaveBeenCalledTimes(3)
      })

      it('says why, keeping the secret out of the error, when SoundCloud stops issuing tokens for the credentials', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
        newClient.mockImplementationOnce(soundCloudClient)
        const app = await buildApp()

        const response = await credentials(app)

        expect(response.credentials.error).toBe('SoundCloud refused to issue a token: 401')
        expect(JSON.stringify(response)).not.toContain('client-secret')
        expect(JSON.stringify(response)).not.toContain(Buffer.from('client-id:client-secret').toString('base64'))
      })

      it('has no error while no playlist is chosen, since nothing is read', async () => {
        chosen = null
        const app = await buildApp()

        expect((await credentials(app)).credentials.error).toBeNull()
        expect(playlist).not.toHaveBeenCalled()
      })

      it('keeps the error through previews, whether they succeed or fail', async () => {
        resolvePlaylist.mockRejectedValue(new Error('SoundCloud responded to /resolve with 500'))
        const app = await buildApp()
        await radio(app)
        expect((await post(app, '/api/admin/radio/preview', { link: LINK })).statusCode).toBe(502)
        expect((await credentials(app)).credentials.error).toBeNull()

        playlist.mockRejectedValue(new Error(PLAYLIST_FAILED))
        vi.advanceTimersByTime(6 * MINUTE)
        expect((await credentials(app)).credentials.error).toBe(PLAYLIST_FAILED)
        otherPlaylistAtLink()
        expect((await post(app, '/api/admin/radio/preview', { link: LINK })).statusCode).toBe(200)
        expect((await credentials(app)).credentials.error).toBe(PLAYLIST_FAILED)
      })

      it('clears the error when a playlist is chosen, since it was just read', async () => {
        playlist.mockRejectedValue(new Error(PLAYLIST_FAILED))
        const app = await buildApp()
        expect((await credentials(app)).credentials.error).toBe(PLAYLIST_FAILED)

        otherPlaylistAtLink()
        expect((await post(app, '/api/admin/radio/playlist', { link: LINK })).statusCode).toBe(200)

        expect((await credentials(app)).credentials.error).toBeNull()
        expect(playlist.mock.calls).toEqual([['7', null], ['9', 's-AbC123']])
      })

      it('saves the credentials, trimmed, once SoundCloud accepts them, and returns them without the secret', async () => {
        entered = null
        const app = await buildApp()

        const response = await put(app, { clientId: ' new-id ', clientSecret: ' new-secret ' })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({
          ok: true,
          credentials: { clientId: 'new-id', updatedBy: 'admin@example.com', updatedAt: '2026-10-01T08:00:00-04:00', error: null },
        })
        expect(newClient).toHaveBeenCalledExactlyOnceWith({ clientId: 'new-id', clientSecret: 'new-secret' })
        expect(checkCredentials).toHaveBeenCalledOnce()
        expect(saveCredentials).toHaveBeenCalledExactlyOnceWith({
          clientId: 'new-id',
          clientSecret: 'new-secret',
          updatedBy: 'admin@example.com',
          updatedAt: new Date(NOW),
        })
      })

      it('puts the radio on air through them right away, reading the playlist with the client that checked them', async () => {
        entered = null
        const app = await buildApp()
        expect((await app.inject({ method: 'GET', url: '/api/radio' })).statusCode).toBe(502)

        const response = await put(app, { clientId: 'new-id', clientSecret: 'new-secret' })

        expect(response.json().credentials.error).toBeNull()
        expect(playlist).toHaveBeenCalledOnce()
        expect((await radio(app)).current.track.id).toBe('1')
        // It already has a token for them, so no other client asks for one.
        expect(newClient).toHaveBeenCalledOnce()
        // /api/radio didn't read the playlist again.
        expect(playlist).toHaveBeenCalledOnce()
      })

      it('shows who entered the same credentials again elsewhere, and when, keeping their client', async () => {
        const app = await buildApp()
        await credentials(app)

        entered = { ...ENTERED, updatedBy: 'other@example.com', updatedAt: new Date(NOW - MINUTE) }

        expect((await credentials(app)).credentials).toMatchObject({ updatedBy: 'other@example.com', updatedAt: inQuebecTime(new Date(NOW - MINUTE)) })
        expect(newClient).toHaveBeenCalledOnce()
      })

      it('keeps reading through new credentials when a request that loaded the old ones goes on after they were saved', async () => {
        const app = await buildApp()
        await radio(app)
        let resolveStale: ((settings: RadioSettings) => void) | undefined
        loadSettings.mockImplementationOnce(() => new Promise((resolve) => (resolveStale = resolve)))
        const stale = radio(app)
        await vi.waitFor(() => expect(resolveStale).toBeDefined())
        await vi.waitFor(() => expect(loadCredentials).toHaveBeenCalledTimes(2))

        await put(app, { clientId: 'new-id', clientSecret: 'new-secret' })
        resolveStale!(CHOSEN)
        await stale
        await radio(app)

        // Once at first, then once through the new credentials, which the request that loaded the old ones went on with.
        expect(playlist).toHaveBeenCalledTimes(2)
      })

      it('says why reading the playlist through new credentials failed, though they were saved, and the radio goes on with what it read before', async () => {
        const app = await buildApp()
        await radio(app)
        playlist.mockRejectedValue(new Error(PLAYLIST_FAILED))

        const response = await put(app, { clientId: 'new-id', clientSecret: 'new-secret' })

        expect(response.statusCode).toBe(200)
        expect(response.json().credentials).toMatchObject({ clientId: 'new-id', error: PLAYLIST_FAILED })
        expect(saveCredentials).toHaveBeenCalledOnce()
        expect((await radio(app)).current.track.id).toBe('1')
        expect(playlist).toHaveBeenCalledTimes(2)
        // The one that checked them.
        expect(newClient).toHaveBeenCalledTimes(2)
      })

      it('reads nothing while no playlist is chosen', async () => {
        chosen = null
        const app = await buildApp()

        const response = await put(app, { clientId: 'new-id', clientSecret: 'new-secret' })

        expect(response.json().credentials).toMatchObject({ clientId: 'new-id', error: null })
        expect(playlist).not.toHaveBeenCalled()
      })

      it('needs nothing more from the database once the credentials are saved', async () => {
        const app = await buildApp()
        saveCredentials.mockImplementationOnce(async (credentials) => {
          entered = credentials
          loadSettings.mockRejectedValue(new Error('Connection terminated'))
          loadCredentials.mockRejectedValue(new Error('Connection terminated'))
        })

        const response = await put(app, { clientId: 'new-id', clientSecret: 'new-secret' })

        expect(response.statusCode).toBe(200)
        expect(response.json().credentials).toMatchObject({ clientId: 'new-id', error: null })
        expect(playlist).toHaveBeenCalledOnce()
      })

      it('ignores credentials that a request loaded before newer ones were saved', async () => {
        const app = await buildApp()
        await radio(app)
        let resolveStale: ((credentials: StoredSoundCloudCredentials) => void) | undefined
        loadCredentials.mockImplementationOnce(() => new Promise((resolve) => (resolveStale = resolve)))
        const stale = radio(app)

        await put(app, { clientId: 'new-id', clientSecret: 'new-secret' })
        await vi.waitFor(() => expect(resolveStale).toBeDefined())
        resolveStale!(ENTERED)
        await stale
        await radio(app)

        expect(newClient).toHaveBeenCalledTimes(2)
        expect(newClient).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'new-id' }))
      })

      it('keeps the credentials out of the logs and the response when the database fails to save them', async () => {
        const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
        const query = 'insert into "soundcloud_credentials" ("id", "client_id", "client_secret") values (default, $1, $2)'
        saveCredentials.mockRejectedValueOnce(new DrizzleQueryError(query, ['new-id', 'new-secret'], cause))
        const logs: string[] = []
        const app = await buildApp(logs)

        const response = await put(app, { clientId: 'new-id', clientSecret: 'new-secret' })

        expect(response.statusCode).toBe(500)
        expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
        expect(logs.join('')).toContain('57P01')
        expect(logs.join('')).not.toContain('new-secret')
      })

      it('checks credentials with SoundCloud without saving them', async () => {
        const app = await buildApp()

        const response = await app.inject({
          method: 'POST',
          url: `${URL}/check`,
          payload: { clientId: ' new-id ', clientSecret: ' new-secret ' },
          cookies: await sessionCookies(),
        })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({ ok: true })
        expect(newClient).toHaveBeenCalledExactlyOnceWith({ clientId: 'new-id', clientSecret: 'new-secret' })
        expect(checkCredentials).toHaveBeenCalledOnce()
        expect(saveCredentials).not.toHaveBeenCalled()
        // The radio goes on with the credentials it had.
        await radio(app)
        expect(newClient).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'client-id' }))
      })

      // Saving them checks them too, the same way.
      describe.each([
        ['PUT', URL],
        ['POST', `${URL}/check`],
      ] as const)('%s %s', (method, url) => {
        const send = (app: App, body: unknown) => sendJson(app, method, url, body)

        it.each([
          ['the client id is missing', { clientSecret: 'secret' }, '`clientId`: Invalid input: expected string, received undefined'],
          ['the client secret is missing', { clientId: 'id' }, '`clientSecret`: Invalid input: expected string, received undefined'],
          ['the client id is blank', { clientId: '  ', clientSecret: 'secret' }, '`clientId`: Too small: expected string to have >=1 characters'],
          ['the client secret is not a string', { clientId: 'id', clientSecret: 42 }, '`clientSecret`: Invalid input: expected string, received number'],
          [
            'the client id is too long',
            { clientId: 'x'.repeat(201), clientSecret: 'secret' },
            '`clientId`: Too big: expected string to have <=200 characters',
          ],
          ['the body is null', null, 'body: Invalid input: expected object, received null'],
          ['there is no body', undefined, 'body: Invalid input: expected object, received null'],
        ])('responds 400 when %s, saying why', async (_, body, error) => {
          const app = await buildApp()

          const response = await send(app, body)

          expect(response.statusCode).toBe(400)
          expect(response.json()).toEqual({ ok: false, error })
          expect(checkCredentials).not.toHaveBeenCalled()
          expect(saveCredentials).not.toHaveBeenCalled()
        })

        it('accepts credentials of 200 characters once trimmed', async () => {
          const app = await buildApp()

          const response = await send(app, { clientId: ` ${'x'.repeat(200)} `, clientSecret: 'secret' })

          expect(response.statusCode).toBe(200)
          expect(newClient).toHaveBeenCalledExactlyOnceWith({ clientId: 'x'.repeat(200), clientSecret: 'secret' })
        })

        it('responds 400, and keeps the credentials it had, when SoundCloud refuses them', async () => {
          checkCredentials.mockResolvedValue(false)
          const app = await buildApp()

          const response = await send(app, { clientId: 'wrong-id', clientSecret: 'wrong-secret' })

          expect(response.statusCode).toBe(400)
          expect(response.json()).toEqual({ ok: false, error: 'SoundCloud refused these credentials' })
          expect(saveCredentials).not.toHaveBeenCalled()
          await radio(app)
          expect(newClient).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'client-id' }))
        })

        it('responds 502 when SoundCloud cannot be reached to check them', async () => {
          checkCredentials.mockRejectedValue(new Error('SoundCloud refused to issue a token: 503'))
          const app = await buildApp()

          const response = await send(app, { clientId: 'new-id', clientSecret: 'new-secret' })

          expect(response.statusCode).toBe(502)
          expect(response.json()).toEqual({
            ok: false,
            error: 'The credentials cannot be checked with SoundCloud: SoundCloud refused to issue a token: 503',
          })
          expect(saveCredentials).not.toHaveBeenCalled()
        })
      })
    })
  })
})
