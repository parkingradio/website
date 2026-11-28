import type { HlsStream, SoundCloudClient } from './soundcloud.js'

// Where to stream tracks from, which both rotations hand out: the playlist's (see routes.ts) and the rotation of sets'
// (see rotation-routes.ts).

// A track's stream URL is shared by the listeners who start it around the same time, which in a radio is
// most of them. A URL's playlist has to be loaded before it expires, about 2 minutes later than the
// length of the track, while the audio the playlist lists is available for 2 hours longer than that.
// Reusing a URL only while it's recent leaves plenty of that time to play the track through.
const STREAM_URL_MAX_AGE_MS = 30 * 60 * 1000
const STREAM_URL_MIN_REMAINING_MS = 2 * 60 * 1000
// A failure to get a track's stream is kept for this long, so that a track SoundCloud keeps failing to stream
// isn't asked for again by every listener who retries, which would run into SoundCloud's limits on requests.
const STREAM_FAILURE_BACKOFF_MS = 30 * 1000

// Where to stream the track `trackId` from, through `soundcloud`, with its secret if it's private.
export type TrackStreams = (soundcloud: SoundCloudClient, trackId: string, secretToken: string | null) => Promise<HlsStream>

// A stream, or the failure to get it, which is reused until `expiresAt`, only known once it's been got.
type Entry = { result: Promise<HlsStream>; expiresAt: number }
// By client, so that they're forgotten along with the client when other credentials are entered, then by track and
// secret, since the secret changes when a private track's link is reset.
export type StreamsByClient = WeakMap<SoundCloudClient, Map<string, Entry>>

// Each stream is only kept until it expires (30 minutes at most after it was got, 30 seconds after a failure), so that a
// private track's secret, and its stream, aren't kept for long once nobody asks for it, e.g. once its set is deleted.
//
// `streamsByClient` is only for tests, to see what's kept.
export function trackStreams(streamsByClient: StreamsByClient = new WeakMap()): TrackStreams {
  return (soundcloud, trackId, secretToken) => {
    const streams = streamsByClient.get(soundcloud) ?? new Map<string, Entry>()
    if (!streamsByClient.has(soundcloud)) streamsByClient.set(soundcloud, streams)
    const key = `${trackId} ${secretToken ?? ''}`
    const found = streams.get(key)
    if (found && Date.now() < found.expiresAt) return found.result

    const startedAt = Date.now()
    const entry: Entry = { result: soundcloud.hlsStream(trackId, secretToken), expiresAt: Infinity }
    streams.set(key, entry)
    const expireAt = (at: number) => {
      entry.expiresAt = at
      // Unless another one has replaced it by then. It doesn't keep the server running.
      setTimeout(() => streams.get(key) === entry && streams.delete(key), at - Date.now()).unref()
    }
    entry.result.then(
      ({ expiresAt }) => expireAt(Math.min(startedAt + STREAM_URL_MAX_AGE_MS, expiresAt - STREAM_URL_MIN_REMAINING_MS)),
      () => expireAt(startedAt + STREAM_FAILURE_BACKOFF_MS),
    )
    return entry.result
  }
}
