import type { FastifyInstance } from 'fastify'
import type { ApiError } from 'shared/error'
import type { RadioResponse, RadioStreamResponse, RadioTrack } from 'shared/radio'
import { cached } from '../cache.js'
import type { OnAir, OnAirStore } from '../on-air.js'
import type { HlsStream, SoundCloudClient, SoundCloudTrack } from '../soundcloud.js'

// The rotation is every public track of Parking Radio's SoundCloud account, in the order SoundCloud lists
// them, so that a set goes on the radio as soon as it's uploaded there.
const SOUNDCLOUD_USER_ID = '1677037676' // https://soundcloud.com/parkingdotradio
const ROTATION_CACHE_TTL_MS = 5 * 60 * 1000
const RADIO_UNAVAILABLE: ApiError = { ok: false, error: 'The radio is unavailable right now' }

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
    url: track.url,
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

type RadioOptions = {
  soundcloud: SoundCloudClient
  onAir: OnAirStore
}

export async function radioRoutes(app: FastifyInstance, { soundcloud, onAir }: RadioOptions) {
  // The outcome of the last fetch of the rotation, successful or not, kept for ROTATION_CACHE_TTL_MS. Like
  // for events, failures are kept too, and never papered over with an older rotation.
  const rotation = cached(
    () =>
      fetchRotation().catch((error: unknown) => {
        app.log.error(error, 'Failed to fetch the radio rotation from SoundCloud')
        return null
      }),
    (_outcome, startedAt) => startedAt + ROTATION_CACHE_TTL_MS,
  )

  async function fetchRotation(): Promise<RadioTrack[]> {
    const { tracks, invalid } = await soundcloud.userTracks(SOUNDCLOUD_USER_ID)
    if (invalid.length > 0) {
      app.log.warn({ invalid }, 'Leaving tracks that SoundCloud describes unexpectedly out of the radio rotation')
    }
    // Tracks that can't be played in full would leave silence in the rotation.
    const skipped = tracks.filter((track) => !track.playable)
    if (skipped.length > 0) {
      app.log.warn({ skipped: skipped.map((track) => track.title) }, 'Leaving tracks that cannot be played in full out of the radio rotation')
    }
    const playable = tracks.filter((track) => track.playable)
    // There would be nothing to put on air.
    if (playable.length === 0) throw new Error('SoundCloud returned no playable tracks')
    return playable.map(toRadioTrack)
  }

  // By track id.
  const streams = new Map<string, () => Promise<HlsStream>>()

  function stream(trackId: string): Promise<HlsStream> {
    let trackStream = streams.get(trackId)
    if (!trackStream) {
      trackStream = cached(
        () => soundcloud.hlsStream(trackId),
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

    const tracks = await rotation()
    if (!tracks) return reply.status(502).send(RADIO_UNAVAILABLE)

    let saved: OnAir | null
    try {
      saved = await onAir.load()
    } catch (error) {
      request.log.error(error, 'Failed to load the track on air on the radio')
      return reply.status(502).send(RADIO_UNAVAILABLE)
    }
    const now = Date.now()
    const { index, startedAt } = onAirAt(tracks, saved, now)
    const track = tracks[index]
    // The rest of the rotation, in the order it comes after the track on air.
    const after = [...tracks.slice(index + 1), ...tracks.slice(0, index)]
    const nextTrackIds = after.map(({ id }) => id)
    if (
      track.id !== saved?.trackId ||
      startedAt !== saved.startedAt ||
      nextTrackIds.length !== saved.nextTrackIds.length ||
      nextTrackIds.some((id, i) => id !== saved.nextTrackIds[i])
    ) {
      // Moving along from an older save comes to the same outcome, so failing to save that only costs the
      // next request some work. A track put on air anew, the first time or in place of one that left the
      // rotation, is only kept if it's saved, but the radio can go on anyway.
      await onAir.save({ trackId: track.id, startedAt, nextTrackIds }).catch((error: unknown) => {
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
      const tracks = await rotation()
      if (!tracks) return reply.status(502).send(RADIO_UNAVAILABLE)
      // Only tracks of the rotation can be streamed, so that this doesn't hand out any track on SoundCloud.
      if (!tracks.some((track) => track.id === request.params.id)) {
        return reply.status(404).send({ ok: false, error: 'Not a track of the radio rotation' })
      }

      try {
        const { url, expiresAt } = await stream(request.params.id)
        return { url, expiresAt: new Date(expiresAt).toISOString() }
      } catch (error) {
        request.log.error(error, 'Failed to get a stream from SoundCloud')
        return reply.status(502).send({ ok: false, error: 'This track cannot be played right now' })
      }
    },
  )
}
