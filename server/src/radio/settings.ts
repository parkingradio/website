import type { db as Database } from '../db/connection.js'
import { radioSettings } from '../db/schema.js'

// The playlist the radio's rotation is read from, as chosen on the admin pages.
export type RadioSettings = {
  playlistId: string
  // What gives access to the playlist when it's private, null otherwise. It must not be handed out to
  // anyone but admins.
  secretToken: string | null
  // The playlist's link and title, as they were when it was chosen.
  url: string
  title: string
  // The email of the admin who chose it, and when, in milliseconds since the epoch.
  updatedBy: string
  updatedAt: number
}

export type RadioSettingsStore = {
  // Null until a playlist has been chosen.
  load(): Promise<RadioSettings | null>
  save(settings: RadioSettings): Promise<void>
}

export function radioSettingsStore(db: typeof Database): RadioSettingsStore {
  return {
    async load() {
      const [row] = await db.select().from(radioSettings)
      return row
        ? {
            playlistId: row.playlistId,
            secretToken: row.playlistSecretToken,
            url: row.playlistUrl,
            title: row.playlistTitle,
            updatedBy: row.updatedBy,
            updatedAt: row.updatedAt.getTime(),
          }
        : null
    },

    async save({ playlistId, secretToken, url, title, updatedBy, updatedAt }) {
      const values = {
        playlistId,
        playlistSecretToken: secretToken,
        playlistUrl: url,
        playlistTitle: title,
        updatedBy,
        updatedAt: new Date(updatedAt),
      }
      await db.insert(radioSettings).values(values).onConflictDoUpdate({ target: radioSettings.id, set: values })
    },
  }
}
