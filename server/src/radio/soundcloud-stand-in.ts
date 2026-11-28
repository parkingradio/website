import { createHash } from 'node:crypto'
import type { SoundCloudClient, TrackRead } from './soundcloud.js'
import { PREVIEW_SUFFIX, STAND_IN_TRACKS } from './stand-in-tracks.js'

// What the server uses in place of SoundCloud with SOUNDCLOUD_STAND_IN, e.g. in development and in tests, so that nothing
// reaches SoundCloud (see "SoundCloud" in the README). It accepts any credentials, and shows a track at any link to one:
// the tracks of STAND_IN_TRACKS as they are on SoundCloud, and any other with an id and a length made up from its link,
// the same for its private link. Of a made-up one whose name ends with PREVIEW_SUFFIX, only a preview can be played. It
// shows no playlist, and gives no streams, so nothing can be played.

// The lengths made up for tracks, in whole seconds, from 40 minutes up to 90.
const SHORTEST_S = 40 * 60
const LENGTHS_S = 50 * 60

const known = new Map(STAND_IN_TRACKS.map((track) => [track.link, track]))

// The track at `link`, as sets keep it: its id, its length, and whether only a preview can be played.
function trackAt(link: string): { id: string; durationMs: number; preview: boolean } {
  const track = link.replace(/\/s-[^/]+$/, '')
  const found = known.get(track)
  if (found) return { id: found.id, durationMs: found.durationMs, preview: false }
  const hash = createHash('sha256').update(track).digest()
  return { id: String(hash.readUIntBE(0, 6)), durationMs: (SHORTEST_S + (hash.readUInt32BE(6) % LENGTHS_S)) * 1000, preview: track.endsWith(PREVIEW_SUFFIX) }
}

export const soundCloudStandIn: SoundCloudClient = {
  async checkCredentials() {
    return true
  },

  async resolvePlaylist() {
    return null
  },

  async resolveTrack(link) {
    return trackAt(link).id
  },

  async readTrack(link, trackId): Promise<TrackRead> {
    const { id, durationMs, preview } = trackAt(link)
    // As SoundCloud, a link that leads to another track is as if the set's track were gone.
    if (id !== trackId) return { state: 'missing', durationMs: null, secretToken: null }
    return { state: preview ? 'preview' : 'playable', durationMs, secretToken: null }
  },

  async playlist() {
    throw new Error('The stand-in for SoundCloud shows no playlist')
  },

  async hlsStream() {
    throw new Error('The stand-in for SoundCloud gives no streams')
  },
}
