import type { Queryable } from '../db/connection.js'
import { soundcloudCredentials } from '../db/schema.js'
import type { SoundCloudCredentials } from './soundcloud.js'

// The credentials of the SoundCloud app the radio reads playlists through, as entered on the admin pages.
export type StoredSoundCloudCredentials = SoundCloudCredentials & {
  // The email of the admin who last changed them, and when.
  updatedBy: string
  updatedAt: Date
}

export type SoundCloudCredentialsStore = {
  // Null until the credentials have been entered.
  load(): Promise<StoredSoundCloudCredentials | null>
  save(credentials: StoredSoundCloudCredentials): Promise<void>
}

export function soundCloudCredentialsStore(db: Queryable): SoundCloudCredentialsStore {
  return {
    async load() {
      const [row] = await db.select().from(soundcloudCredentials)
      return row
        ? { clientId: row.clientId, clientSecret: row.clientSecret, updatedBy: row.updatedBy, updatedAt: row.updatedAt }
        : null
    },

    async save(credentials) {
      await db.insert(soundcloudCredentials).values(credentials).onConflictDoUpdate({ target: soundcloudCredentials.id, set: credentials })
    },
  }
}
