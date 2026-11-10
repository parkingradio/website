import type { Queryable } from '../db/connection.js'
import { youtubeCredentials } from '../db/schema.js'

// The YouTube channel the server reads the site's video from, and the API key it reads it with, as entered on the admin
// pages.
export type YouTubeCredentials = {
  channelId: string
  apiKey: string
  // The channel's uploads, read with the channel when the credentials were checked.
  uploadsPlaylistId: string
  // The email of the admin who last changed them, and when.
  updatedBy: string
  updatedAt: Date
}

export type YouTubeCredentialsStore = {
  // Null until the credentials have been entered.
  load(): Promise<YouTubeCredentials | null>
  save(credentials: YouTubeCredentials): Promise<void>
}

export function youTubeCredentialsStore(db: Queryable): YouTubeCredentialsStore {
  return {
    async load() {
      const [row] = await db.select().from(youtubeCredentials)
      return row
        ? {
            channelId: row.channelId,
            apiKey: row.apiKey,
            uploadsPlaylistId: row.uploadsPlaylistId,
            updatedBy: row.updatedBy,
            updatedAt: row.updatedAt,
          }
        : null
    },

    async save(credentials) {
      await db.insert(youtubeCredentials).values(credentials).onConflictDoUpdate({ target: youtubeCredentials.id, set: credentials })
    },
  }
}
