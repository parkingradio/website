import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

import type { RadioResponse } from 'shared/radio'
import type { OnAir } from '../on-air.js'
import type { HlsStream, SoundCloudTrack, UserTracks } from '../soundcloud.js'
import { radioRoutes } from './radio.js'

const userTracks = vi.fn<(userId: string) => Promise<UserTracks>>()
const hlsStream = vi.fn<(trackId: string) => Promise<HlsStream>>()

// The track on air, as the database would keep it.
let stored: OnAir | null = null
const load = vi.fn<() => Promise<OnAir | null>>()
const save = vi.fn<(onAir: OnAir) => Promise<void>>()

function track(id: number, title: string, overrides: Partial<SoundCloudTrack> = {}): SoundCloudTrack {
  return {
    id: String(id),
    title,
    durationMs: 3_600_000,
    url: `https://soundcloud.com/parkingdotradio/track-${id}`,
    playable: true,
    ...overrides,
  }
}

// What the client returns for these tracks, all of which SoundCloud described as expected.
function soundCloudTracks(...tracks: SoundCloudTrack[]): UserTracks {
  return { tracks, invalid: [] }
}

const NOW = new Date('2026-10-01T12:00:00Z').getTime()
const MINUTE = 60 * 1000

function streamFor(id: number, expiresAt = NOW + 62 * MINUTE): HlsStream {
  return { url: `https://cdn.test/${id}/playlist.m3u8?n=${hlsStream.mock.calls.length}`, expiresAt }
}

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(radioRoutes, { soundcloud: { userTracks, hlsStream }, onAir: { load, save } })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function radio(app: App, query = ''): Promise<RadioResponse> {
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

describe('radio routes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    userTracks.mockReset()
    hlsStream.mockReset()
    userTracks.mockResolvedValue(soundCloudTracks(track(1, 'NIM K | parking.radio | 2026.03.14')))
    hlsStream.mockImplementation(async (id: string) => streamFor(Number(id)))
    stored = null
    load.mockReset().mockImplementation(async () => stored)
    save.mockReset().mockImplementation(async (onAir) => {
      stored = onAir
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('GET /api/radio', () => {
    it("returns what's on air and what comes next, parsed from the tracks' titles", async () => {
      userTracks.mockResolvedValue(soundCloudTracks(
        track(1, 'NIM K | parking.radio | 2026.03.14', { durationMs: 3_420_000 }),
        track(2, 'ZEFRA | HAUTE RIVE TAKEOVER @ parking.radio | 2026.09.13'),
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
        url: 'https://soundcloud.com/parkingdotradio/track-1',
      }
      expect(response.json()).toEqual({
        current: { track: nimK, startedAt: '2026-10-01T12:00:00.000Z' },
        upcoming: [
          {
            id: '2',
            artist: 'ZEFRA',
            event: 'HAUTE RIVE TAKEOVER',
            date: '2026-09-13',
            durationMs: 3_600_000,
            url: 'https://soundcloud.com/parkingdotradio/track-2',
          },
          {
            id: '3',
            artist: 'Lumo',
            event: 'QRTZ TAKEOVER',
            date: '2026-04-19',
            durationMs: 3_600_000,
            url: 'https://soundcloud.com/parkingdotradio/track-3',
          },
        ],
      })
      expect(userTracks).toHaveBeenCalledWith('1677037676')
    })

    it('uses a title that does not follow the usual pattern whole', async () => {
      userTracks.mockResolvedValue(soundCloudTracks(track(1, 'Special broadcast')))
      const app = await buildApp()

      const { current } = await radio(app)

      expect(current.track).toMatchObject({ artist: 'Special broadcast', event: null, date: null })
    })

    it('keeps the order SoundCloud lists the tracks in, e.g. newest first', async () => {
      userTracks.mockResolvedValue(soundCloudTracks(
        track(1, 'NEW | parking.radio | 2026.09.27'),
        track(2, 'OLD | parking.radio | 2026.03.14'),
        track(3, 'MIDDLE | parking.radio | 2026.06.07'),
      ))
      const app = await buildApp()

      const tracks = await inOrder(app)

      expect(tracks.map((t) => t.artist)).toEqual(['NEW', 'OLD', 'MIDDLE'])
    })

    it('leaves out tracks that SoundCloud describes unexpectedly', async () => {
      userTracks.mockResolvedValue({
        tracks: [track(1, 'A | parking.radio | 2026.09.10')],
        invalid: ['"B | parking.radio | 2026.09.11": ✖ Invalid input: expected number, received null → at duration'],
      })
      const app = await buildApp()

      const tracks = await inOrder(app)

      expect(tracks.map((t) => t.id)).toEqual(['1'])
    })

    it('leaves out tracks that cannot be played in full', async () => {
      userTracks.mockResolvedValue(soundCloudTracks(
        track(1, 'A | parking.radio | 2026.09.10'),
        track(2, 'B | parking.radio | 2026.09.11', { playable: false }),
      ))
      const app = await buildApp()

      const tracks = await inOrder(app)

      expect(tracks.map((t) => t.id)).toEqual(['1'])
    })

    it.each([
      ['SoundCloud fails', () => userTracks.mockRejectedValue(new Error('SoundCloud responded with 500'))],
      ['no track can be played', () => userTracks.mockResolvedValue(soundCloudTracks(track(1, 'A', { playable: false })))],
      ['the account has no tracks', () => userTracks.mockResolvedValue(soundCloudTracks())],
      ['the track on air cannot be loaded', () => load.mockRejectedValue(new Error('Connection terminated'))],
    ])('responds 502 when %s', async (_, setUp) => {
      setUp()
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio' })

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ ok: false, error: 'The radio is unavailable right now' })
    })

    it('asks SoundCloud at most once every 5 minutes', async () => {
      const app = await buildApp()

      await app.inject({ method: 'GET', url: '/api/radio' })
      vi.advanceTimersByTime(4 * MINUTE)
      await app.inject({ method: 'GET', url: '/api/radio' })
      expect(userTracks).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2 * MINUTE)
      await app.inject({ method: 'GET', url: '/api/radio' })
      expect(userTracks).toHaveBeenCalledTimes(2)
    })

    it('shares a fetch that is in flight between requests', async () => {
      const app = await buildApp()

      const responses = await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url: '/api/radio' })))

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200])
      expect(userTracks).toHaveBeenCalledTimes(1)
    })

    it('does not fall back on the last good rotation when SoundCloud fails, and recovers 5 minutes later', async () => {
      const app = await buildApp()
      await app.inject({ method: 'GET', url: '/api/radio' })

      userTracks.mockRejectedValueOnce(new Error('SoundCloud responded with 500'))
      vi.advanceTimersByTime(6 * MINUTE)
      expect((await app.inject({ method: 'GET', url: '/api/radio' })).statusCode).toBe(502)

      vi.advanceTimersByTime(4 * MINUTE)
      expect((await app.inject({ method: 'GET', url: '/api/radio' })).statusCode).toBe(502)
      vi.advanceTimersByTime(2 * MINUTE)
      expect((await app.inject({ method: 'GET', url: '/api/radio' })).statusCode).toBe(200)
      expect(userTracks).toHaveBeenCalledTimes(3)
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
      userTracks.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60)))
      const app = await buildApp()

      expect(await onAir(app)).toEqual({ id: '1', startedAt: NOW, upcoming: ['2'] })
      expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ trackId: '1', startedAt: NOW }))
    })

    it('keeps a track on air until it ends, then moves on to the next one', async () => {
      userTracks.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60)))
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
      userTracks.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60)))
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
      userTracks.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(3, 3, 60)))
      const app = await buildApp()
      await onAir(app)
      vi.advanceTimersByTime(70 * MINUTE)
      expect(await onAir(app)).toMatchObject({ id: '3', startedAt: NOW + 60 * MINUTE })

      // A set recorded before the one on air and one recorded after it get uploaded.
      userTracks.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 60), set(3, 3, 60), set(4, 4, 60)))
      vi.advanceTimersByTime(6 * MINUTE)

      expect(await onAir(app)).toEqual({ id: '3', startedAt: NOW + 60 * MINUTE, upcoming: ['4', '1', '2'] })
    })

    it('catches up after nobody listened for a long time', async () => {
      // 90 minutes a round, so 10 days is 160 rounds, and 70 minutes more is 10 minutes into the second set.
      userTracks.mockResolvedValue(soundCloudTracks(set(1, 1, 60), set(2, 2, 30)))
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
      userTracks.mockResolvedValue(soundCloudTracks(...ids.map((id) => set(id, id, 60))))
      const app = await buildApp()
      await onAir(app)
      vi.advanceTimersByTime((left - 1) * 60 * MINUTE + 10 * MINUTE)
      expect(await onAir(app)).toMatchObject({ id: String(left) })

      userTracks.mockResolvedValue(soundCloudTracks(...ids.filter((id) => !removed.includes(id)).map((id) => set(id, id, 60))))
      vi.advanceTimersByTime(6 * MINUTE)

      expect(await onAir(app)).toMatchObject({ id: String(next), startedAt: Date.now() })
      expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ trackId: String(next), startedAt: Date.now() }))
    })

    describe('what comes after the track on air', () => {
      // With the third of four sets on air.
      async function buildAppOnTrack3() {
        userTracks.mockResolvedValue(soundCloudTracks(...[1, 2, 3, 4].map((id) => set(id, id, 60))))
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
      expect(response.json()).toEqual({ ok: false, error: 'upcoming must be a whole number' })
      expect(userTracks).not.toHaveBeenCalled()
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
        expiresAt: '2026-10-01T13:02:00.000Z',
      })
      expect(hlsStream).toHaveBeenCalledWith('1')
    })

    it.each(['2', 'abc', '1%2Fstreams'])('responds 404 for a track that is not in the rotation (%s)', async (id) => {
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: `/api/radio/tracks/${id}/stream` })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'Not a track of the radio rotation' })
      expect(hlsStream).not.toHaveBeenCalled()
    })

    it('responds 502 when the rotation is unavailable', async () => {
      userTracks.mockRejectedValue(new Error('SoundCloud responded with 500'))
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/radio/tracks/1/stream' })

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ ok: false, error: 'The radio is unavailable right now' })
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
})
