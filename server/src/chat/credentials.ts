import type { Queryable } from '../db/connection.js'
import { discordCredentials } from '../db/schema.js'

// The token of the Discord bot the server reaches the chat through, and the channel it reaches, as entered on the admin
// pages (see docs/design/server/chat.md).
export type DiscordCredentials = {
  botToken: string
  channelId: string
  // The bot's and the channel's names on Discord, as they were when the credentials were checked.
  botName: string
  channelName: string
  // The email of the admin who last changed them, and when.
  updatedBy: string
  updatedAt: Date
}

export type DiscordCredentialsStore = {
  // Null until the credentials have been entered.
  load(): Promise<DiscordCredentials | null>
  save(credentials: DiscordCredentials): Promise<void>
}

export function discordCredentialsStore(db: Queryable): DiscordCredentialsStore {
  return {
    async load() {
      const [row] = await db.select().from(discordCredentials)
      return row
        ? {
            botToken: row.botToken,
            channelId: row.channelId,
            botName: row.botName,
            channelName: row.channelName,
            updatedBy: row.updatedBy,
            updatedAt: row.updatedAt,
          }
        : null
    },

    async save(credentials) {
      await db.insert(discordCredentials).values(credentials).onConflictDoUpdate({ target: discordCredentials.id, set: credentials })
    },
  }
}
