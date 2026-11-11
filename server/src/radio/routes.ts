import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { errorMessage } from '../api/errors.js'
import { ApiError, Credential, Day, Ok, Timestamp, zodRoutes } from '../api/schemas.js'
import { cached } from '../core/cache.js'
import type { OnAir, OnAirStore } from './on-air.js'
import type { RadioSettings, RadioSettingsStore } from './settings.js'
import type { HlsStream, InvalidTrack, PlaylistLink, SoundCloudClient, SoundCloudCredentials, SoundCloudTrack } from './soundcloud.js'
import { NO_CREDENTIALS } from './soundcloud-app.js'
import type { EnteredApp, SoundCloudApp } from './soundcloud-app.js'
import type { StoredSoundCloudCredentials } from './soundcloud-credentials.js'

// The API's requests and responses (see docs/design/server/radio.md). Since responses are checked against them, what
// they say of the values that come from SoundCloud must hold for everything that the schemas of radio/soundcloud.ts
// accept, or a quirk in SoundCloud's data would fail with 500 rather than be handled: strings that come from SoundCloud
// are plain strings, e.g. URLs, and an empty title makes an empty artist. A track's date is only read from its title
// when it's a `Day` (see `toRadioTrack`).

const RadioTrack = z
  .object({
    id: z.string(),
    artist: z.string(),
    event: z.string().nullable(),
    date: Day.nullable(),
    // Like SoundCloud's durations (see radio/soundcloud.ts).
    durationMs: z.number().int().positive(),
  })
  .meta({ id: 'RadioTrack' })
type RadioTrack = z.infer<typeof RadioTrack>

// The track on air, and what comes next. Like the stream below, it has no `ok`.
const Radio = z
  .object({
    current: z.object({ track: RadioTrack, startedAt: Timestamp }),
    upcoming: z.array(RadioTrack),
  })
  .meta({ id: 'Radio' })
export type Radio = z.infer<typeof Radio>

const RadioStream = z.object({ url: z.string(), expiresAt: Timestamp }).meta({ id: 'RadioStream' })

const RotationTrack = z.object({ kind: z.literal('rotation'), track: RadioTrack }).meta({ id: 'RotationTrack' })
const LeftOutTrack = z
  .object({ kind: z.literal('left-out'), track: RadioTrack, reason: z.enum(['preview', 'blocked', 'not-streamable']) })
  .meta({ id: 'LeftOutTrack' })
// Only its title is known, or SoundCloud's id for it, without one (see radio/soundcloud.ts).
const UnexpectedTrack = z.object({ kind: z.literal('unexpected'), title: z.string() }).meta({ id: 'UnexpectedTrack' })
const RadioPlaylistTrack = z.discriminatedUnion('kind', [RotationTrack, LeftOutTrack, UnexpectedTrack]).meta({ id: 'RadioPlaylistTrack' })
type RadioPlaylistTrack = z.infer<typeof RadioPlaylistTrack>

const RadioPlaylist = z
  .object({
    url: z.string(),
    title: z.string(),
    private: z.boolean(),
    account: z.object({ name: z.string(), url: z.string() }),
    tracks: z.array(RadioPlaylistTrack),
  })
  .meta({ id: 'RadioPlaylist' })
type RadioPlaylist = z.infer<typeof RadioPlaylist>

const ChosenPlaylist = z
  .object({
    url: z.string(),
    title: z.string(),
    chosenBy: z.string(),
    chosenAt: Timestamp,
    playlist: RadioPlaylist.nullable(),
    error: z.string().nullable(),
  })
  .meta({ id: 'ChosenPlaylist' })
type ChosenPlaylist = z.infer<typeof ChosenPlaylist>

const PlaylistRequest = z.object({ link: z.string() })

const CredentialsRequest = z.object({ clientId: Credential, clientSecret: Credential })

// What `GET` and `PUT /api/admin/radio/credentials` respond. The secret is never sent back.
const RadioCredentials = z
  .object({
    ok: z.literal(true),
    credentials: z
      .object({
        clientId: z.string(),
        updatedBy: z.string(),
        updatedAt: Timestamp,
        error: z.string().nullable().meta({ description: "Why the radio's last read of its playlist failed, or null" }),
      })
      .nullable(),
  })
  .meta({ id: 'RadioCredentials' })
type RadioCredentials = z.infer<typeof RadioCredentials>

// Links to SoundCloud playlists, e.g. "https://soundcloud.com/parkingdotradio/sets/rotation". A private
// playlist can only be read through its private link, which ends with its secret, e.g.
// "https://soundcloud.com/parkingdotradio/sets/rotation/s-AbC123". Parameters, e.g. "?si=...", are allowed.
// The client has a copy of this, to check links before asking for a preview (see client/src/pages/admin/rotation.tsx).
const PLAYLIST_LINK = /^\s*https?:\/\/(?:www\.)?soundcloud\.com(\/[^/?#\s]+\/sets\/[^/?#\s]+(?:\/s-[^/?#\s]+)?)\/?(?:[?#]\S*)?\s*$/

// The playlist `link` leads to, as a link without anything that doesn't identify the playlist, or null if
// it isn't a link to a playlist.
function playlistLink(link: string): string | null {
  const path = PLAYLIST_LINK.exec(link)?.[1]
  return path ? `https://soundcloud.com${path}` : null
}

// The rotation is the tracks of a SoundCloud playlist chosen on the admin pages, in the playlist's order. It's
// read again every ROTATION_CACHE_TTL_MS, so that changes to the playlist get on the radio. When reading it
// fails, the radio goes on with what it read before, and it's tried again after ROTATION_RETRY_MS.
const ROTATION_CACHE_TTL_MS = 5 * 60 * 1000
const ROTATION_RETRY_MS = 60 * 1000
const RADIO_UNAVAILABLE: z.infer<typeof ApiError> = { ok: false, error: 'The radio is unavailable right now' }
const NO_PLAYLIST: z.infer<typeof ApiError> = { ok: false, error: 'No playlist has been chosen for the radio yet' }
const NOT_IN_ROTATION: z.infer<typeof ApiError> = { ok: false, error: 'Not a track of the radio rotation' }

// A track's stream URL is shared by the listeners who start it around the same time, which in a radio is
// most of them. A URL's playlist has to be loaded before it expires, about 2 minutes later than the
// length of the track, while the audio the playlist lists is available for 2 hours longer than that.
// Reusing a URL only while it's recent leaves plenty of that time to play the track through.
const STREAM_URL_MAX_AGE_MS = 30 * 60 * 1000
const STREAM_URL_MIN_REMAINING_MS = 2 * 60 * 1000
// A failure to get a track's stream is kept for this long, so that a track SoundCloud keeps failing to stream
// isn't asked for again by every listener who retries, which would run into SoundCloud's limits on requests.
const STREAM_FAILURE_BACKOFF_MS = 30 * 1000

// The titles Parking Radio gives its sets on SoundCloud, e.g. "3TONS | parking.radio | 2026.09.27" or
// "ZEFRA | HAUTE RIVE TAKEOVER @ parking.radio | 2026.09.13".
const TITLE = /^(?<artist>.+?)\s*\|\s*(?:(?<event>.+?)\s*@\s*)?parking\.radio\s*\|\s*(?<year>\d{4})\.(?<month>\d{2})\.(?<day>\d{2})$/i

function toRadioTrack(track: SoundCloudTrack): RadioTrack {
  const title = track.title.trim()
  const groups = TITLE.exec(title)?.groups
  const date = groups ? `${groups.year}-${groups.month}-${groups.day}` : ''
  // A title whose day doesn't exist, e.g. "2026.13.45", doesn't follow the pattern either.
  if (!groups || !Day.safeParse(date).success) {
    return { id: track.id, artist: title, event: null, date: null, durationMs: track.durationMs }
  }
  return { id: track.id, artist: groups.artist, event: groups.event ?? null, date, durationMs: track.durationMs }
}

// Where the rotation is at `now`: the track on air when it was last saved, or the one after it, and so on,
// as tracks end. A track that has left the rotation, e.g. because it was deleted, is taken off air right
// away, since it can't be streamed anymore, and the first of the tracks that came after it that's still
// in the rotation goes on air instead.
function onAirAt(rotation: RadioTrack[], saved: OnAir | null, now: number): { index: number; startedAt: number } {
  if (!saved) return { index: 0, startedAt: now }
  let index = rotation.findIndex((track) => track.id === saved.trackId)
  if (index === -1) {
    const next = saved.nextTrackIds.map((id) => rotation.findIndex((track) => track.id === id)).find((i) => i !== -1)
    return { index: next ?? 0, startedAt: now }
  }

  let { startedAt } = saved
  // Whole rounds of the rotation are skipped at once, e.g. after nobody listened for days, since a round
  // from any track leads back to it.
  const round = rotation.reduce((total, track) => total + track.durationMs, 0)
  if (now - startedAt >= round) startedAt += Math.floor((now - startedAt) / round) * round
  while (startedAt + rotation[index].durationMs <= now) {
    startedAt += rotation[index].durationMs
    index = (index + 1) % rotation.length
  }
  return { index, startedAt }
}

// A playlist as the radio reads it: what the admin pages show of it, and the tracks that go in the rotation.
type Rotation = {
  playlist: RadioPlaylist
  tracks: RadioTrack[]
}

// What the radio knows of the playlist chosen for the rotation: the rotation as it was last read successfully,
// if it was, and why it couldn't be read the last time it was tried, if it couldn't.
type Chosen = {
  settings: RadioSettings
  rotation: Rotation | null
  error: string | null
}

// The rotation read from the playlist of `settings`, through `soundcloud`.
type Source = {
  settings: RadioSettings
  soundcloud: SoundCloudClient
  // The rotation as it was last read successfully, if it was.
  rotation(): Rotation | null
  read(): Promise<Pick<Chosen, 'rotation' | 'error'>>
}

type RadioOptions = {
  soundcloud: SoundCloudApp
  onAir: OnAirStore
  settings: RadioSettingsStore
}

function samePlaylist(a: RadioSettings, b: RadioSettings): boolean {
  return a.playlistId === b.playlistId && a.secretToken === b.secretToken
}

function credentialsResponse(credentials: StoredSoundCloudCredentials | null, error: string | null): RadioCredentials {
  return {
    ok: true,
    credentials: credentials && {
      clientId: credentials.clientId,
      updatedBy: credentials.updatedBy,
      updatedAt: credentials.updatedAt.toISOString(),
      error,
    },
  }
}

function currentPlaylist({ settings, rotation, error }: Chosen): ChosenPlaylist {
  return {
    url: settings.url,
    title: settings.title,
    chosenBy: settings.updatedBy,
    chosenAt: new Date(settings.updatedAt).toISOString(),
    playlist: rotation?.playlist ?? null,
    error,
  }
}

export async function radioRoutes(
  app: FastifyInstance,
  { soundcloud: soundcloudApp, onAir, settings: settingsStore }: RadioOptions,
) {
  // The credentials, and a private playlist's secret, are values of the queries that save them, which the app's error
  // handler keeps out of the logs and responses (see `useApiErrors`).
  const api = zodRoutes(app)

  // The secrets of the private tracks of the playlists read, by track id, as they were last read.
  const trackSecrets = new Map<string, string>()

  async function readPlaylist(soundcloud: SoundCloudClient, id: string, secretToken: string | null): Promise<Rotation> {
    const { playlist, tracks } = await soundcloud.playlist(id, secretToken)
    const playlistTracks: RadioPlaylistTrack[] = []
    // The tracks that are left out, for the logs.
    const invalid: InvalidTrack[] = []
    const skipped: { title: string; reason: z.infer<typeof LeftOutTrack>['reason'] }[] = []
    for (const track of tracks) {
      if ('invalid' in track) {
        playlistTracks.push({ kind: 'unexpected', title: track.name })
        invalid.push(track)
        continue
      }
      if (track.secretToken) trackSecrets.set(track.id, track.secretToken)
      else trackSecrets.delete(track.id)
      if (track.unplayable) {
        // Tracks that can't be played in full would leave silence in the rotation.
        playlistTracks.push({ kind: 'left-out', track: toRadioTrack(track), reason: track.unplayable })
        skipped.push({ title: track.title, reason: track.unplayable })
      } else {
        playlistTracks.push({ kind: 'rotation', track: toRadioTrack(track) })
      }
    }
    if (invalid.length > 0) {
      app.log.warn({ invalid }, 'Leaving tracks that SoundCloud describes unexpectedly out of the radio rotation')
    }
    if (skipped.length > 0) {
      app.log.warn({ skipped }, 'Leaving tracks that cannot be played in full out of the radio rotation')
    }
    return {
      playlist: {
        url: playlist.url,
        title: playlist.title,
        private: playlist.private,
        account: playlist.account,
        tracks: playlistTracks,
      },
      tracks: playlistTracks.flatMap((track) => (track.kind === 'rotation' ? [track.track] : [])),
    }
  }

  // The tracks that left the rotation, by id, with until when they can still be streamed: for as long as
  // they last from when that was noticed, so that listeners who were playing one when it left can get a new
  // stream to finish it if they need one. This is only kept in memory, so it's lost when the server restarts.
  const departed = new Map<string, number>()
  // The tracks of the rotation as it was last read, from whichever playlist.
  let lastTracks: RadioTrack[] = []

  // Notes which tracks left the rotation since it was last read.
  function rotationRead(tracks: RadioTrack[]) {
    const now = Date.now()
    const ids = new Set(tracks.map(({ id }) => id))
    for (const track of lastTracks) {
      if (!ids.has(track.id)) departed.set(track.id, now + track.durationMs)
    }
    for (const [id, until] of departed) {
      if (ids.has(id) || until <= now) departed.delete(id)
    }
    lastTracks = tracks
  }

  // Where to stream each track from, by track id, through each client for SoundCloud, so that they're forgotten along
  // with the client when other credentials are entered.
  const streamsByClient = new WeakMap<SoundCloudClient, Map<string, () => Promise<HlsStream>>>()

  // The source the rotation is read from, replaced whenever another playlist is chosen, or other credentials are
  // entered.
  let source: Source | null = null

  // The radio goes on with `start`, if any, until the playlist is read again: right away, unless `start` was just read.
  function sourceFor(
    settings: RadioSettings,
    soundcloud: SoundCloudClient,
    { rotation: start, justRead = false }: { rotation: Rotation | null; justRead?: boolean } = { rotation: null },
  ): Source {
    const refresh = cached(
      async () => {
        try {
          const rotation = await readPlaylist(soundcloud, settings.playlistId, settings.secretToken)
          // There would be nothing to put on air.
          if (rotation.tracks.length === 0) throw new Error('None of the tracks of the playlist can be played in full')
          return rotation
        } catch (error) {
          app.log.error(error, 'Failed to read the radio rotation from SoundCloud')
          throw error
        }
      },
      (outcome, startedAt) => startedAt + (outcome.status === 'fulfilled' ? ROTATION_CACHE_TTL_MS : ROTATION_RETRY_MS),
      justRead && start ? { value: start } : undefined,
    )
    let rotation = start
    let error: string | null = null
    return {
      settings,
      soundcloud,
      rotation: () => rotation,
      async read() {
        try {
          rotation = await refresh()
          error = null
        } catch (reason) {
          error = errorMessage(reason)
        }
        return { rotation, error }
      },
    }
  }

  // Reads the rotation from the playlist of `settings` through `soundcloud`, unless it was read recently.
  async function readRotation(settings: RadioSettings, soundcloud: SoundCloudClient): Promise<Chosen> {
    if (!source || !samePlaylist(source.settings, settings)) source = sourceFor(settings, soundcloud)
    // With other credentials, the playlist is read again right away, while the radio goes on with what it read before.
    else if (source.soundcloud !== soundcloud) source = sourceFor(settings, soundcloud, { rotation: source.rotation() })
    const { rotation, error } = await source.read()
    if (rotation && rotation.tracks !== lastTracks) rotationRead(rotation.tracks)
    return { settings, rotation, error }
  }

  // What the radio knows of the playlist chosen for the rotation, or null until one is chosen, and the SoundCloud app's
  // credentials, with their client, or null until they've been entered. The choice is loaded every time, rather than kept
  // in memory, so that every server picks it up.
  async function current(): Promise<{ radio: Chosen | null; entered: EnteredApp | null }> {
    const [settings, entered] = await Promise.all([settingsStore.load(), soundcloudApp.current()])
    if (!settings) return { radio: null, entered }
    // Nothing can be read until then, which isn't a failure to read the playlist.
    if (!entered) return { radio: { settings, rotation: null, error: null }, entered }
    return { radio: await readRotation(settings, entered.client), entered }
  }

  // Where to stream a track from, through `soundcloud`.
  function stream(soundcloud: SoundCloudClient, trackId: string): Promise<HlsStream> {
    let streams = streamsByClient.get(soundcloud)
    if (!streams) streamsByClient.set(soundcloud, (streams = new Map()))
    let trackStream = streams.get(trackId)
    if (!trackStream) {
      // The secret is looked up whenever a stream is asked for, since it changes if the track's private link is reset.
      trackStream = cached(
        () => soundcloud.hlsStream(trackId, trackSecrets.get(trackId) ?? null),
        (outcome, startedAt) =>
          outcome.status === 'fulfilled'
            ? Math.min(startedAt + STREAM_URL_MAX_AGE_MS, outcome.value.expiresAt - STREAM_URL_MIN_REMAINING_MS)
            : startedAt + STREAM_FAILURE_BACKOFF_MS,
      )
      streams.set(trackId, trackStream)
    }
    return trackStream()
  }

  api.get(
    '/api/radio',
    {
      config: { tool: { title: 'Voir ce qui joue à la radio' } },
      schema: {
        operationId: 'get_on_air',
        summary: "What's on the radio, and what comes next",
        tags: ['Radio'],
        querystring: z.object({ upcoming: z.string().regex(/^\d+$/, 'Invalid input: expected a whole number').optional() }),
        response: { 200: Radio, 502: ApiError, 503: ApiError },
      },
    },
    async (request, reply) => {
      const { upcoming } = request.query

      let radio: Chosen | null
      let saved: OnAir | null
      try {
        ;[{ radio }, saved] = await Promise.all([current(), onAir.load()])
      } catch (error) {
        request.log.error(error, 'Failed to load the radio from the database')
        return reply.status(502).send(RADIO_UNAVAILABLE)
      }
      if (!radio) return reply.status(503).send(NO_PLAYLIST)

      const { rotation } = radio
      if (!rotation) return reply.status(502).send(RADIO_UNAVAILABLE)
      const { playlistId } = radio.settings
      // When another playlist was chosen, it goes on air from its first track.
      const previous = saved?.playlistId === playlistId ? saved : null
      const now = Date.now()
      const { index, startedAt } = onAirAt(rotation.tracks, previous, now)
      const track = rotation.tracks[index]
      // The rest of the rotation, in the order it comes after the track on air.
      const after = [...rotation.tracks.slice(index + 1), ...rotation.tracks.slice(0, index)]
      const nextTrackIds = after.map(({ id }) => id)
      if (
        track.id !== previous?.trackId ||
        startedAt !== previous.startedAt ||
        nextTrackIds.length !== previous.nextTrackIds.length ||
        nextTrackIds.some((id, i) => id !== previous.nextTrackIds[i])
      ) {
        // Moving along from an older save comes to the same outcome, so failing to save that only costs the
        // next request some work. A track put on air anew, the first time or in place of one that left the
        // rotation, is only kept if it's saved, but the radio can go on anyway.
        await onAir.save({ playlistId, trackId: track.id, startedAt, nextTrackIds }).catch((error: unknown) => {
          request.log.error(error, 'Failed to save the track on air on the radio')
        })
      }

      return {
        current: { track, startedAt: new Date(startedAt).toISOString() },
        upcoming: upcoming === undefined ? after : after.slice(0, Number(upcoming)),
      }
    },
  )

  api.get(
    '/api/radio/tracks/:id/stream',
    {
      schema: {
        summary: 'Where to stream a track of the rotation from',
        tags: ['Radio'],
        params: z.object({ id: z.string() }),
        response: { 200: RadioStream, 404: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      let radio: Chosen | null
      let entered: EnteredApp | null
      try {
        ;({ radio, entered } = await current())
      } catch (error) {
        request.log.error(error, 'Failed to load the radio from the database')
        return reply.status(502).send(RADIO_UNAVAILABLE)
      }
      // Only tracks of the rotation, or that just left it, can be streamed, so that this doesn't hand out any
      // track on SoundCloud.
      if (!radio?.rotation?.tracks.some((track) => track.id === id) && (departed.get(id) ?? 0) <= Date.now()) {
        if (radio && !radio.rotation) return reply.status(502).send(RADIO_UNAVAILABLE)
        return reply.status(404).send(NOT_IN_ROTATION)
      }
      try {
        // Tracks only get in the rotation once credentials have been entered, so there's a client by then.
        const { url, expiresAt } = await stream(entered!.client, id)
        return { url, expiresAt: new Date(expiresAt).toISOString() }
      } catch (error) {
        request.log.error(error, 'Failed to get a stream from SoundCloud')
        return reply.status(502).send({ ok: false, error: 'This track cannot be played right now' })
      }
    },
  )

  api.get(
    '/api/admin/radio',
    {
      config: { admin: true, tool: { title: 'Voir la playlist de la radio' } },
      schema: {
        operationId: 'get_radio_playlist',
        summary: "The playlist the radio's rotation is read from",
        tags: ['Radio'],
        response: { 200: z.object({ ok: z.literal(true), credentialsEntered: z.boolean(), current: ChosenPlaylist.nullable() }) },
      },
    },
    async () => {
      const { radio, entered } = await current()
      return { ok: true as const, credentialsEntered: entered !== null, current: radio && currentPlaylist(radio) }
    },
  )

  // The playlist that `link` leads to, read like the rotation is, or the error to respond with.
  async function readLink(
    link: string,
  ): Promise<{ soundcloud: SoundCloudClient; playlist: PlaylistLink; rotation: Rotation } | { status: 400 | 404 | 409 | 502; error: string }> {
    const normalized = playlistLink(link)
    if (!normalized) return { status: 400, error: 'Not a link to a SoundCloud playlist' }
    const entered = await soundcloudApp.current()
    if (!entered) return { status: 409, error: NO_CREDENTIALS }
    const soundcloud = entered.client
    try {
      const playlist = await soundcloud.resolvePlaylist(normalized)
      if (!playlist) return { status: 404, error: 'SoundCloud shows no playlist at this link' }
      return { soundcloud, playlist, rotation: await readPlaylist(soundcloud, playlist.id, playlist.secretToken) }
    } catch (error) {
      app.log.error(error, 'Failed to read a playlist from SoundCloud')
      return { status: 502, error: `The playlist cannot be read from SoundCloud: ${errorMessage(error)}` }
    }
  }

  api.post(
    '/api/admin/radio/preview',
    {
      config: { admin: true, tool: { title: 'Prévisualiser une playlist', readOnly: true } },
      schema: {
        operationId: 'preview_playlist',
        summary: 'What the radio would read from a playlist',
        tags: ['Radio'],
        body: PlaylistRequest,
        response: {
          200: z.object({ ok: z.literal(true), playlist: RadioPlaylist }),
          400: ApiError,
          404: ApiError,
          409: ApiError,
          502: ApiError,
        },
      },
    },
    async (request, reply) => {
      const read = await readLink(request.body.link)
      if ('error' in read) return reply.status(read.status).send({ ok: false, error: read.error })
      return { ok: true as const, playlist: read.rotation.playlist }
    },
  )

  api.post(
    '/api/admin/radio/playlist',
    {
      config: { admin: true, tool: { title: 'Changer la playlist de la radio' } },
      schema: {
        operationId: 'choose_playlist',
        summary: 'Chooses the playlist the rotation is read from',
        tags: ['Radio'],
        body: PlaylistRequest,
        response: { 200: Ok, 400: ApiError, 404: ApiError, 409: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const read = await readLink(request.body.link)
      if ('error' in read) return reply.status(read.status).send({ ok: false, error: read.error })
      const { soundcloud, playlist, rotation } = read
      if (rotation.tracks.length === 0) {
        return reply.status(400).send({ ok: false, error: 'None of the tracks of this playlist can be played in full' })
      }

      const settings: RadioSettings = {
        playlistId: playlist.id,
        secretToken: playlist.secretToken,
        url: rotation.playlist.url,
        title: rotation.playlist.title,
        updatedBy: request.user!.email,
        updatedAt: Date.now(),
      }
      await settingsStore.save(settings)
      // The playlist was just read, so it goes on air without being read again. Its first track goes on air
      // with the next request, since the track on air is from another playlist (unless the same playlist was
      // chosen again), and the tracks of the previous playlist can still be streamed for a while.
      source = sourceFor(settings, soundcloud, { rotation, justRead: true })
      request.log.info({ playlistId: playlist.id, title: settings.title, by: settings.updatedBy }, 'Chose the playlist of the radio rotation')
      return { ok: true as const }
    },
  )

  api.get(
    '/api/admin/radio/credentials',
    {
      config: { admin: true, tool: { title: "Voir l'app SoundCloud" } },
      schema: {
        operationId: 'get_soundcloud_app',
        summary: 'The SoundCloud app the radio reads playlists through, and why the last read of its playlist failed, if it did',
        tags: ['Radio'],
        response: { 200: RadioCredentials },
      },
    },
    async () => {
      const { radio, entered } = await current()
      return credentialsResponse(entered?.credentials ?? null, radio?.error ?? null)
    },
  )

  // The credentials that were sent, with a client that uses them, once SoundCloud accepts them, or the error to respond
  // with.
  async function checkedCredentials(
    credentials: SoundCloudCredentials,
  ): Promise<{ credentials: SoundCloudCredentials; soundcloud: SoundCloudClient } | { status: 400 | 502; error: string }> {
    const soundcloud = soundcloudApp.newClient(credentials)
    try {
      if (!(await soundcloud.checkCredentials())) return { status: 400, error: 'SoundCloud refused these credentials' }
    } catch (error) {
      app.log.error(error, 'Failed to check SoundCloud credentials')
      return { status: 502, error: `The credentials cannot be checked with SoundCloud: ${errorMessage(error)}` }
    }
    return { credentials, soundcloud }
  }

  api.post(
    '/api/admin/radio/credentials/check',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Whether SoundCloud accepts credentials, without saving them',
        tags: ['Radio'],
        body: CredentialsRequest,
        response: { 200: Ok, 400: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const checked = await checkedCredentials(request.body)
      if ('error' in checked) return reply.status(checked.status).send({ ok: false, error: checked.error })
      return { ok: true as const }
    },
  )

  api.put(
    '/api/admin/radio/credentials',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Entering the credentials of the SoundCloud app',
        tags: ['Radio'],
        body: CredentialsRequest,
        response: { 200: RadioCredentials, 400: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      // They're checked again, even if they were just checked, so that a typo can't take the radio off air.
      const checked = await checkedCredentials(request.body)
      if ('error' in checked) return reply.status(checked.status).send({ ok: false, error: checked.error })
      const { credentials, soundcloud } = checked

      // Loaded before the credentials are saved, so that once they are, the response doesn't depend on the database.
      const settings = await settingsStore.load()
      const saved = { ...credentials, updatedBy: request.user!.email, updatedAt: new Date() }
      // The client already has a token, so it's used rather than one that would ask for another.
      await soundcloudApp.save(saved, soundcloud)
      request.log.info({ clientId: credentials.clientId, by: saved.updatedBy }, 'Changed the credentials of the SoundCloud app of the radio')
      const error = settings ? (await readRotation(settings, soundcloud)).error : null
      return credentialsResponse(saved, error)
    },
  )
}
