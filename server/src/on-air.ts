import type { db as Database } from './db.js'
import { radioOnAir } from './schema.js'

// The track on air on the radio, and when it started, in milliseconds since the epoch.
export type OnAir = {
  // The playlist the rotation was read from: a track on air from another playlist is taken off air.
  playlistId: string
  trackId: string
  startedAt: number
  // The tracks that come after it in the rotation, in order, so that the radio can go on with the first
  // of them that's still in the rotation if the track leaves it.
  nextTrackIds: string[]
}

// Where the track on air is kept, so that the radio picks up where it was after the server restarts.
export type OnAirStore = {
  // Null until the radio has been on air.
  load(): Promise<OnAir | null>
  save(onAir: OnAir): Promise<void>
}

export function onAirStore(db: typeof Database): OnAirStore {
  return {
    async load() {
      const [row] = await db.select().from(radioOnAir)
      return row
        ? { playlistId: row.playlistId, trackId: row.trackId, startedAt: row.startedAt.getTime(), nextTrackIds: row.nextTrackIds }
        : null
    },

    async save({ playlistId, trackId, startedAt, nextTrackIds }) {
      const values = { playlistId, trackId, startedAt: new Date(startedAt), nextTrackIds }
      await db.insert(radioOnAir).values(values).onConflictDoUpdate({ target: radioOnAir.id, set: values })
    },
  }
}
