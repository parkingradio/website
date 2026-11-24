import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import fastifyCookie from '@fastify/cookie'

import { useZodSchemas } from '../api/schemas.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { inQuebecTime } from '../api/formats.js'
import type { DiscordCredentials } from './credentials.js'
import { DiscordRefused } from './discord.js'
import type { Discord } from './discord.js'
import { chatRoutes } from './routes.js'

const check = vi.fn<Discord['check']>()

// The credentials, as the database would keep them.
let entered: DiscordCredentials | null = null
const load = vi.fn<() => Promise<DiscordCredentials | null>>()
const save = vi.fn<(credentials: DiscordCredentials) => Promise<void>>()

const NOW = new Date('2026-11-23T12:00:00Z').getTime()

const TOKEN = 'MTA5ODc2NTQzMjEwOTg3NjU0Mw.Gabc12.the-token'
const NEW_TOKEN = 'MTA5ODc2NTQzMjEwOTg3NjU0Mw.Gdef34.new-token'
const CHANNEL_ID = '1234567890123456789'
const OTHER_CHANNEL_ID = '9876543210987654321'
const ENTERED: DiscordCredentials = {
  botToken: TOKEN,
  channelId: CHANNEL_ID,
  botName: 'parking.radio',
  channelName: 'chat',
  updatedBy: 'someone@example.com',
  updatedAt: new Date('2026-11-20T15:00:00Z'),
}

async function buildApp(logs?: string[]) {
  const app = Fastify({ logger: logs ? { stream: { write: (line: string) => logs.push(line) } } : false })
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(chatRoutes, { discord: { check }, credentials: { load, save } })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

const URL = '/api/admin/chat/discord'
const CHECK_URL = `${URL}/check`

async function credentials(app: App) {
  return (await app.inject({ method: 'GET', url: URL, cookies: await sessionCookies() })).json()
}

async function send(app: App, method: 'PUT' | 'POST', url: string, body: unknown) {
  return app.inject({
    method,
    url,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
    cookies: await sessionCookies(),
  })
}

describe('chat routes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    process.env.JWT_SECRET = 'test-secret'
    check.mockReset().mockResolvedValue({ botName: 'parking.radio (test)', channelName: 'chat-test' })
    entered = ENTERED
    load.mockReset().mockImplementation(async () => entered)
    save.mockReset().mockImplementation(async (credentials) => {
      entered = credentials
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.JWT_SECRET
  })

  it.each([
    ['GET', URL],
    ['PUT', URL],
    ['POST', CHECK_URL],
  ] as const)('%s %s requires a session', async (method, url) => {
    const app = await buildApp()

    const response = await app.inject({ method, url, payload: method === 'GET' ? undefined : { botToken: TOKEN, channelId: CHANNEL_ID } })

    expect(response.statusCode).toBe(401)
    expect(check).not.toHaveBeenCalled()
  })

  it('gives null until the credentials have been entered', async () => {
    entered = null
    const app = await buildApp()

    expect(await credentials(app)).toEqual({ ok: true, credentials: null })
  })

  it('gives the channel, the names, who entered the credentials and when, but never the token', async () => {
    const app = await buildApp()

    const response = await credentials(app)

    expect(response).toEqual({
      ok: true,
      credentials: { channelId: CHANNEL_ID, botName: 'parking.radio', channelName: 'chat', updatedBy: 'someone@example.com', updatedAt: inQuebecTime(ENTERED.updatedAt) },
    })
    expect(JSON.stringify(response)).not.toContain(TOKEN)
    expect(check).not.toHaveBeenCalled()
  })

  it('saves the credentials, trimmed, with the names Discord gives, once they pass', async () => {
    entered = null
    const logs: string[] = []
    const app = await buildApp(logs)

    const response = await send(app, 'PUT', URL, { botToken: ` ${NEW_TOKEN} `, channelId: ` ${OTHER_CHANNEL_ID} ` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      credentials: {
        channelId: OTHER_CHANNEL_ID,
        botName: 'parking.radio (test)',
        channelName: 'chat-test',
        updatedBy: 'admin@example.com',
        updatedAt: '2026-11-23T07:00:00-05:00',
      },
    })
    expect(check).toHaveBeenCalledExactlyOnceWith(NEW_TOKEN, OTHER_CHANNEL_ID)
    expect(save).toHaveBeenCalledExactlyOnceWith({
      botToken: NEW_TOKEN,
      channelId: OTHER_CHANNEL_ID,
      botName: 'parking.radio (test)',
      channelName: 'chat-test',
      updatedBy: 'admin@example.com',
      updatedAt: new Date(NOW),
    })
    expect((await credentials(app)).credentials.channelId).toBe(OTHER_CHANNEL_ID)
    expect(response.body).not.toContain(NEW_TOKEN)
    expect(logs.join('')).toContain('Changed the Discord credentials of the chat')
    expect(logs.join('')).not.toContain(NEW_TOKEN)
  })

  it('checks credentials with Discord without saving them', async () => {
    const app = await buildApp()

    const response = await send(app, 'POST', CHECK_URL, { botToken: ` ${NEW_TOKEN} `, channelId: ` ${OTHER_CHANNEL_ID} ` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(check).toHaveBeenCalledExactlyOnceWith(NEW_TOKEN, OTHER_CHANNEL_ID)
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the token out of the logs and the response when the database fails to save it', async () => {
    const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
    const query = 'insert into "discord_credentials" ("id", "bot_token", "channel_id") values (default, $1, $2)'
    save.mockRejectedValueOnce(new DrizzleQueryError(query, [NEW_TOKEN, CHANNEL_ID], cause))
    const logs: string[] = []
    const app = await buildApp(logs)

    const response = await send(app, 'PUT', URL, { botToken: NEW_TOKEN, channelId: CHANNEL_ID })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
    expect(logs.join('')).toContain('57P01')
    expect(logs.join('')).not.toContain(NEW_TOKEN)
  })

  // Saving them checks them too, the same way.
  describe.each([
    ['PUT', URL],
    ['POST', CHECK_URL],
  ] as const)('%s %s', (method, url) => {
    const sendTo = (app: App, body: unknown) => send(app, method, url, body)
    const NOT_A_TOKEN = "`botToken`: Not a Discord bot's token, which only has letters, digits, '.', '_' and '-'"
    const NOT_A_CHANNEL = "`channelId`: Not a Discord channel's id, which is up to 20 digits"

    it.each([
      ['the token is missing', { channelId: CHANNEL_ID }, '`botToken`: Invalid input: expected string, received undefined'],
      ['the channel id is missing', { botToken: TOKEN }, '`channelId`: Invalid input: expected string, received undefined'],
      ['the token is blank', { botToken: ' ', channelId: CHANNEL_ID }, '`botToken`: Too small: expected string to have >=1 characters'],
      ['the token is too long', { botToken: 'x'.repeat(201), channelId: CHANNEL_ID }, '`botToken`: Too big: expected string to have <=200 characters'],
      ['the token starts with "Bot "', { botToken: `Bot ${TOKEN}`, channelId: CHANNEL_ID }, NOT_A_TOKEN],
      ['the token has a line break in it', { botToken: 'the-secret\nline', channelId: CHANNEL_ID }, NOT_A_TOKEN],
      ['the token has a letter past U+00FF', { botToken: 'the-secret-Ł', channelId: CHANNEL_ID }, NOT_A_TOKEN],
      ['the channel id is blank', { botToken: TOKEN, channelId: ' ' }, NOT_A_CHANNEL],
      ['the channel id is too long', { botToken: TOKEN, channelId: '1'.repeat(21) }, NOT_A_CHANNEL],
      ['the channel id is a link', { botToken: TOKEN, channelId: `https://discord.com/channels/111/${CHANNEL_ID}` }, NOT_A_CHANNEL],
      ['the channel id is a name', { botToken: TOKEN, channelId: '#chat' }, NOT_A_CHANNEL],
      ['the body is null', null, 'body: Invalid input: expected object, received null'],
    ])('responds 400 when %s, saying why, without asking Discord or quoting the token', async (_, body, error) => {
      const app = await buildApp()

      const response = await sendTo(app, body)

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error })
      expect(check).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
    })

    it('responds 400, saying why, and keeps the credentials it had, when Discord refuses them', async () => {
      check.mockRejectedValue(new DiscordRefused("The bot doesn't have these permissions in the channel: Manage Webhooks"))
      const app = await buildApp()

      const response = await sendTo(app, { botToken: NEW_TOKEN, channelId: OTHER_CHANNEL_ID })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: "The bot doesn't have these permissions in the channel: Manage Webhooks" })
      expect(save).not.toHaveBeenCalled()
      expect((await credentials(app)).credentials.channelId).toBe(CHANNEL_ID)
    })

    it.each([
      'Discord cannot be reached: The operation was aborted due to timeout',
      'Discord refuses requests for now: You are being rate limited.',
      'Unexpected answer from Discord to /applications/@me: ✖ Invalid input: expected object, received undefined\n  → at bot',
    ])('responds 502, and keeps the credentials it had, when the check fails with "%s"', async (message) => {
      check.mockRejectedValue(new Error(message))
      const app = await buildApp()

      const response = await sendTo(app, { botToken: NEW_TOKEN, channelId: OTHER_CHANNEL_ID })

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ ok: false, error: `The credentials cannot be checked with Discord: ${message}` })
      expect(save).not.toHaveBeenCalled()
    })
  })
})
