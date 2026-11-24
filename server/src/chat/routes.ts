import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { errorMessage } from '../api/errors.js'
import { ApiError, Credential, Ok, Timestamp, zodRoutes } from '../api/schemas.js'
import type { DiscordCredentials, DiscordCredentialsStore } from './credentials.js'
import { BOT_TOKEN, DiscordRefused, NOT_A_BOT_TOKEN } from './discord.js'
import type { Discord, DiscordNames } from './discord.js'

// The chat, which the server reaches through a Discord bot (see docs/design/server/chat.md).

const CredentialsRequest = z.object({
  // Checked here too, though Discord's client refuses a token in another format itself (see `BOT_TOKEN`), so that it fails
  // like the other fields.
  botToken: Credential.regex(BOT_TOKEN, NOT_A_BOT_TOKEN).meta({
    description: `The bot's token, only letters, digits, '.', '_' or '-'. ${Credential.description}`,
  }),
  channelId: z
    .string()
    .trim()
    .regex(/^[0-9]{1,20}$/, "Not a Discord channel's id, which is up to 20 digits")
    .meta({ description: "The channel's id on Discord, trimmed: up to 20 digits" }),
})

// What `GET` and `PUT /api/admin/chat/discord` respond. The token is never sent back.
const ChatDiscord = z
  .object({
    ok: z.literal(true),
    credentials: z
      .object({
        channelId: z.string(),
        botName: z.string().meta({ description: "The bot's name on Discord, when the credentials were checked" }),
        channelName: z.string().meta({ description: "The channel's name on Discord, without #, when the credentials were checked" }),
        updatedBy: z.string(),
        updatedAt: Timestamp,
      })
      .nullable(),
  })
  .meta({ id: 'ChatDiscord' })
type ChatDiscord = z.infer<typeof ChatDiscord>

// Field by field, so that the token can't end up in it, even before the response's schema leaves it out.
function credentialsResponse(credentials: DiscordCredentials | null): ChatDiscord {
  return {
    ok: true,
    credentials: credentials && {
      channelId: credentials.channelId,
      botName: credentials.botName,
      channelName: credentials.channelName,
      updatedBy: credentials.updatedBy,
      updatedAt: credentials.updatedAt.toISOString(),
    },
  }
}

type ChatOptions = {
  discord: Discord
  credentials: DiscordCredentialsStore
}

export async function chatRoutes(app: FastifyInstance, { discord, credentials: store }: ChatOptions) {
  // The token is a value of the query that saves it, which the app's error handler keeps out of the logs and responses
  // (see `useApiErrors`).
  const api = zodRoutes(app)

  api.get(
    '/api/admin/chat/discord',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'The Discord bot the server reaches the chat through, and its channel',
        tags: ['Chat'],
        response: { 200: ChatDiscord },
      },
    },
    async () => credentialsResponse(await store.load()),
  )

  // The bot's and the channel's names, once the credentials pass, or the error to respond with.
  async function checked({ botToken, channelId }: z.infer<typeof CredentialsRequest>): Promise<DiscordNames | { status: 400 | 502; error: string }> {
    try {
      return await discord.check(botToken, channelId)
    } catch (error) {
      if (error instanceof DiscordRefused) return { status: 400, error: error.message }
      app.log.error(error, 'Failed to check Discord credentials')
      return { status: 502, error: `The credentials cannot be checked with Discord: ${errorMessage(error)}` }
    }
  }

  api.post(
    '/api/admin/chat/discord/check',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Whether a bot's token and a channel pass the check with Discord, without saving them",
        tags: ['Chat'],
        body: CredentialsRequest,
        response: { 200: Ok, 400: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const names = await checked(request.body)
      if ('error' in names) return reply.status(names.status).send({ ok: false, error: names.error })
      return { ok: true as const }
    },
  )

  api.put(
    '/api/admin/chat/discord',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Entering the Discord bot's token and the channel it reaches",
        tags: ['Chat'],
        body: CredentialsRequest,
        response: { 200: ChatDiscord, 400: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      // They're checked again, even if they were just checked, since what they let the bot do may have changed since.
      const names = await checked(request.body)
      if ('error' in names) return reply.status(names.status).send({ ok: false, error: names.error })

      const saved: DiscordCredentials = { ...request.body, ...names, updatedBy: request.user!.email, updatedAt: new Date() }
      await store.save(saved)
      request.log.info({ channelId: saved.channelId, by: saved.updatedBy }, 'Changed the Discord credentials of the chat')
      return credentialsResponse(saved)
    },
  )
}
