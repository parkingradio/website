import type { FastifyInstance } from 'fastify'
import type { ApiError } from 'shared/error'
import { SOUNDCLOUD_CREDENTIAL_MAX_LENGTH, playlistLink } from 'shared/radio'
import type {
  RadioLeftOutReason,
  RadioPlaylist,
  RadioPlaylistRequest,
  RadioPlaylistTrack,
  RadioPlaylistResponse,
  RadioCredentialsCheckResponse,
  RadioCredentialsRequest,
  RadioCredentialsResponse,
  RadioPreviewRequest,
  RadioPreviewResponse,
  RadioResponse,
  RadioSettingsResponse,
  RadioStreamResponse,
  RadioTrack,
} from 'shared/radio'
import { requireAuth } from '../auth.js'
import { cached } from '../cache.js'
import { keepQueryValuesPrivate } from '../query-errors.js'
import type { OnAir, OnAirStore } from '../on-air.js'
import type { RadioSettings, RadioSettingsStore } from '../radio-settings.js'
import type { HlsStream, InvalidTrack, PlaylistLink, SoundCloudClient, SoundCloudCredentials, SoundCloudTrack } from '../soundcloud.js'
import type { SoundCloudCredentialsStore, StoredSoundCloudCredentials } from '../soundcloud-credentials.js'

// The rotation is the tracks of a SoundCloud playlist chosen on the admin pages, in the playlist's order. It's
// read again every ROTATION_CACHE_TTL_MS, so that changes to the playlist get on the radio. When reading it
// fails, the radio goes on with what it read before, and it's tried again after ROTATION_RETRY_MS.
const ROTATION_CACHE_TTL_MS = 5 * 60 * 1000
const ROTATION_RETRY_MS = 60 * 1000
const RADIO_UNAVAILABLE: ApiError = { ok: false, error: 'The radio is unavailable right now' }
const NO_PLAYLIST: ApiError = { ok: false, error: 'No playlist has been chosen for the radio yet' }
const NOT_IN_ROTATION: ApiError = { ok: false, error: 'Not a track of the radio rotation' }
const NO_CREDENTIALS = 'The credentials of the SoundCloud app have not been entered yet'

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
  return {
    id: track.id,
    artist: groups?.artist ?? title,
    event: groups?.event ?? null,
    date: groups ? `${groups.year}-${groups.month}-${groups.day}` : null,
    durationMs: track.durationMs,
  }
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
type Radio = {
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
  read(): Promise<Pick<Radio, 'rotation' | 'error'>>
}

// A client for SoundCloud, the credentials it uses, as they were saved, and where to stream each track from through it,
// by track id.
type Client = {
  credentials: StoredSoundCloudCredentials
  soundcloud: SoundCloudClient
  streams: Map<string, () => Promise<HlsStream>>
}

type RadioOptions = {
  // Builds a client for SoundCloud that uses the credentials it's given.
  soundcloud: (credentials: SoundCloudCredentials) => SoundCloudClient
  credentials: SoundCloudCredentialsStore
  onAir: OnAirStore
  settings: RadioSettingsStore
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function samePlaylist(a: RadioSettings, b: RadioSettings): boolean {
  return a.playlistId === b.playlistId && a.secretToken === b.secretToken
}

function sameCredentials(a: SoundCloudCredentials, b: SoundCloudCredentials): boolean {
  return a.clientId === b.clientId && a.clientSecret === b.clientSecret
}

function credentialsResponse(credentials: StoredSoundCloudCredentials | null): RadioCredentialsResponse {
  return {
    ok: true,
    credentials: credentials && {
      clientId: credentials.clientId,
      updatedBy: credentials.updatedBy,
      updatedAt: credentials.updatedAt.toISOString(),
    },
  }
}

// A credential that was sent, trimmed, or null if it isn't valid.
function validatedCredential(sent: unknown): string | null {
  if (typeof sent !== 'string') return null
  const credential = sent.trim()
  return credential && credential.length <= SOUNDCLOUD_CREDENTIAL_MAX_LENGTH ? credential : null
}

function currentPlaylist({ settings, rotation, error }: Radio): RadioSettingsResponse['current'] {
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
  { soundcloud: newClient, credentials: credentialsStore, onAir, settings: settingsStore }: RadioOptions,
) {
  // The credentials, and a private playlist's secret, are values of the queries that save them.
  keepQueryValuesPrivate(app, 'Failed to handle a request about the radio')

  // The secrets of the private tracks of the playlists read, by track id, as they were last read.
  const trackSecrets = new Map<string, string>()

  async function readPlaylist(soundcloud: SoundCloudClient, id: string, secretToken: string | null): Promise<Rotation> {
    const { playlist, tracks } = await soundcloud.playlist(id, secretToken)
    const playlistTracks: RadioPlaylistTrack[] = []
    // The tracks that are left out, for the logs.
    const invalid: InvalidTrack[] = []
    const skipped: { title: string; reason: RadioLeftOutReason }[] = []
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

  // The client for the credentials that were entered last, replaced whenever they change.
  let client: Client | null = null

  function useClient(credentials: StoredSoundCloudCredentials, soundcloud: SoundCloudClient): SoundCloudClient {
    client = { credentials, soundcloud, streams: new Map() }
    return soundcloud
  }

  // The client for the credentials that were entered, or null until they are. They're loaded every time, like the
  // playlist, so that every server picks up a change. Credentials loaded before newer ones were saved, by a request
  // that was already under way, are ignored.
  async function loadClient(): Promise<SoundCloudClient | null> {
    const credentials = await credentialsStore.load()
    if (!credentials) return null
    if (client && (sameCredentials(client.credentials, credentials) || client.credentials.updatedAt > credentials.updatedAt)) {
      return client.soundcloud
    }
    return useClient(credentials, newClient(credentials))
  }

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

  // What the radio knows of the playlist chosen for the rotation, or null until one is chosen, and whether the
  // credentials have been entered. The choice is loaded every time, rather than kept in memory, so that every server
  // picks it up.
  async function current(): Promise<{ radio: Radio | null; credentialsEntered: boolean }> {
    const [settings, soundcloud] = await Promise.all([settingsStore.load(), loadClient()])
    const credentialsEntered = soundcloud !== null
    if (!settings) return { radio: null, credentialsEntered }
    // Nothing can be read until then, which isn't a failure to read the playlist.
    if (!soundcloud) return { radio: { settings, rotation: null, error: null }, credentialsEntered }
    if (!source || !samePlaylist(source.settings, settings)) source = sourceFor(settings, soundcloud)
    // With other credentials, the playlist is read again right away, while the radio goes on with what it read before.
    else if (source.soundcloud !== soundcloud) source = sourceFor(settings, soundcloud, { rotation: source.rotation() })
    const { rotation, error } = await source.read()
    if (rotation && rotation.tracks !== lastTracks) rotationRead(rotation.tracks)
    return { radio: { settings, rotation, error }, credentialsEntered }
  }

  // Tracks only get in the rotation once credentials have been entered, so there's a client by then.
  function stream(trackId: string): Promise<HlsStream> {
    const { soundcloud, streams } = client!
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

  app.get<{ Querystring: { upcoming?: string }; Reply: RadioResponse | ApiError }>('/api/radio', async (request, reply) => {
    const { upcoming } = request.query
    if (upcoming !== undefined && !/^\d+$/.test(upcoming)) {
      return reply.status(400).send({ ok: false, error: 'upcoming must be a whole number' })
    }

    let radio: Radio | null
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
  })

  app.get<{ Params: { id: string }; Reply: RadioStreamResponse | ApiError }>(
    '/api/radio/tracks/:id/stream',
    async (request, reply) => {
      const { id } = request.params
      let radio: Radio | null
      try {
        ;({ radio } = await current())
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
        const { url, expiresAt } = await stream(id)
        return { url, expiresAt: new Date(expiresAt).toISOString() }
      } catch (error) {
        request.log.error(error, 'Failed to get a stream from SoundCloud')
        return reply.status(502).send({ ok: false, error: 'This track cannot be played right now' })
      }
    },
  )

  app.get<{ Reply: RadioSettingsResponse }>('/api/admin/radio', { preHandler: requireAuth }, async () => {
    const { radio, credentialsEntered } = await current()
    return { ok: true, credentialsEntered, current: radio && currentPlaylist(radio) }
  })

  // The playlist that `link` leads to, read like the rotation is, or the error to respond with.
  async function readLink(
    link: unknown,
  ): Promise<{ soundcloud: SoundCloudClient; playlist: PlaylistLink; rotation: Rotation } | { status: number; error: string }> {
    const normalized = typeof link === 'string' ? playlistLink(link) : null
    if (!normalized) return { status: 400, error: 'Not a link to a SoundCloud playlist' }
    const soundcloud = await loadClient()
    if (!soundcloud) return { status: 409, error: NO_CREDENTIALS }
    try {
      const playlist = await soundcloud.resolvePlaylist(normalized)
      if (!playlist) return { status: 404, error: 'SoundCloud shows no playlist at this link' }
      return { soundcloud, playlist, rotation: await readPlaylist(soundcloud, playlist.id, playlist.secretToken) }
    } catch (error) {
      app.log.error(error, 'Failed to read a playlist from SoundCloud')
      return { status: 502, error: `The playlist cannot be read from SoundCloud: ${errorMessage(error)}` }
    }
  }

  app.post<{ Body: Partial<RadioPreviewRequest>; Reply: RadioPreviewResponse | ApiError }>(
    '/api/admin/radio/preview',
    { preHandler: requireAuth },
    async (request, reply) => {
      const read = await readLink(request.body?.link)
      if ('error' in read) return reply.status(read.status).send({ ok: false, error: read.error })
      return { ok: true, playlist: read.rotation.playlist }
    },
  )

  app.post<{ Body: Partial<RadioPlaylistRequest>; Reply: RadioPlaylistResponse | ApiError }>(
    '/api/admin/radio/playlist',
    { preHandler: requireAuth },
    async (request, reply) => {
      const read = await readLink(request.body?.link)
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
      return { ok: true }
    },
  )

  app.get<{ Reply: RadioCredentialsResponse }>('/api/admin/radio/credentials', { preHandler: requireAuth }, async () => {
    return credentialsResponse(await credentialsStore.load())
  })

  // The credentials that were sent, with a client that uses them, once SoundCloud accepts them, or the error to respond
  // with.
  async function checkedCredentials(
    sent: Partial<RadioCredentialsRequest> | null,
  ): Promise<{ credentials: SoundCloudCredentials; soundcloud: SoundCloudClient } | { status: number; error: string }> {
    const clientId = validatedCredential(sent?.clientId)
    const clientSecret = validatedCredential(sent?.clientSecret)
    if (clientId === null || clientSecret === null) {
      return { status: 400, error: `The client id and the client secret must each have between 1 and ${SOUNDCLOUD_CREDENTIAL_MAX_LENGTH} characters` }
    }
    const credentials = { clientId, clientSecret }
    const soundcloud = newClient(credentials)
    try {
      if (!(await soundcloud.checkCredentials())) return { status: 400, error: 'SoundCloud refused these credentials' }
    } catch (error) {
      app.log.error(error, 'Failed to check SoundCloud credentials')
      return { status: 502, error: `The credentials cannot be checked with SoundCloud: ${errorMessage(error)}` }
    }
    return { credentials, soundcloud }
  }

  app.post<{ Body: Partial<RadioCredentialsRequest> | null; Reply: RadioCredentialsCheckResponse | ApiError }>(
    '/api/admin/radio/credentials/check',
    { preHandler: requireAuth },
    async (request, reply) => {
      const checked = await checkedCredentials(request.body)
      if ('error' in checked) return reply.status(checked.status).send({ ok: false, error: checked.error })
      return { ok: true }
    },
  )

  app.put<{ Body: Partial<RadioCredentialsRequest> | null; Reply: RadioCredentialsResponse | ApiError }>(
    '/api/admin/radio/credentials',
    { preHandler: requireAuth },
    async (request, reply) => {
      // They're checked again, even if they were just checked, so that a typo can't take the radio off air.
      const checked = await checkedCredentials(request.body)
      if ('error' in checked) return reply.status(checked.status).send({ ok: false, error: checked.error })
      const { credentials, soundcloud } = checked

      const saved = { ...credentials, updatedBy: request.user!.email, updatedAt: new Date() }
      await credentialsStore.save(saved)
      // The client already has a token, so it's used rather than one that would ask for another.
      useClient(saved, soundcloud)
      request.log.info({ clientId: credentials.clientId, by: saved.updatedBy }, 'Changed the credentials of the SoundCloud app of the radio')
      return credentialsResponse(saved)
    },
  )
}
