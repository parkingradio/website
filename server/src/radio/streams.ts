import { cached } from '../core/cache.js'
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

export function trackStreams(): TrackStreams {
  // By client, so that they're forgotten along with the client when other credentials are entered, then by track and
  // secret, since the secret changes when a private track's link is reset.
  const streamsByClient = new WeakMap<SoundCloudClient, Map<string, () => Promise<HlsStream>>>()

  return (soundcloud, trackId, secretToken) => {
    let streams = streamsByClient.get(soundcloud)
    if (!streams) streamsByClient.set(soundcloud, (streams = new Map()))
    const key = `${trackId} ${secretToken ?? ''}`
    let stream = streams.get(key)
    if (!stream) {
      stream = cached(
        () => soundcloud.hlsStream(trackId, secretToken),
        (outcome, startedAt) =>
          outcome.status === 'fulfilled'
            ? Math.min(startedAt + STREAM_URL_MAX_AGE_MS, outcome.value.expiresAt - STREAM_URL_MIN_REMAINING_MS)
            : startedAt + STREAM_FAILURE_BACKOFF_MS,
      )
      streams.set(key, stream)
    }
    return stream()
  }
}
