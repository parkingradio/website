import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscordRefused, discord } from './discord.js'

const TOKEN = 'MTA5ODc2NTQzMjEwOTg3NjU0Mw.Gabc12.the-secret_part'
const CHANNEL_ID = '1234567890123456789'
const BOT_ID = '1098765432109876543'

const VIEW_CHANNEL = 1n << 10n
const READ_MESSAGE_HISTORY = 1n << 16n
const MANAGE_WEBHOOKS = 1n << 29n
const SEND_MESSAGES = 1n << 11n
const ALL_NEEDED = VIEW_CHANNEL | READ_MESSAGE_HISTORY | MANAGE_WEBHOOKS

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()

const APPLICATION = { id: BOT_ID, name: 'parking.radio', flags: 1 << 19, flags_new: String(1 << 19), bot: { id: BOT_ID, username: 'parking.radio' } }
const CHANNEL = { id: CHANNEL_ID, type: 0, name: 'chat', guild_id: '111' }
const permissions = (bits: bigint) => () => Response.json({ permissions: String(bits) })

// Answers each of the check's requests, by its path, with what's given, or else as a bot that can follow the channel.
function discordAnswers({
  application = () => Response.json(APPLICATION),
  channel = () => Response.json(CHANNEL),
  memberPermissions = permissions(ALL_NEEDED),
}: { application?: () => Response; channel?: () => Response; memberPermissions?: () => Response } = {}) {
  fetchMock.mockImplementation(async (url) => {
    const path = new URL(url).pathname
    if (path === '/api/v10/applications/@me') return application()
    if (path === `/api/v10/channels/${CHANNEL_ID}`) return channel()
    if (path === `/api/v10/channels/${CHANNEL_ID}/permissions/member/${BOT_ID}`) return memberPermissions()
    throw new Error(`Unexpected request to ${url}`)
  })
}

// An error as Discord answers them.
const failure = (status: number, code: number, message: string) => () => Response.json({ message, code }, { status })

const check = () => discord.check(TOKEN, CHANNEL_ID)

describe('discord', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("gives the bot's and the channel's names when the bot can follow the channel", async () => {
    discordAnswers()

    expect(await check()).toEqual({ botName: 'parking.radio', channelName: 'chat' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://discord.com/api/v10/applications/@me',
      `https://discord.com/api/v10/channels/${CHANNEL_ID}`,
      `https://discord.com/api/v10/channels/${CHANNEL_ID}/permissions/member/${BOT_ID}`,
    ])
  })

  it('sends the token in a header as a bot, never in a URL, with the user agent Discord requires', async () => {
    discordAnswers()

    await check()

    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).not.toContain(TOKEN)
      expect(new Headers(init.headers).get('authorization')).toBe(`Bot ${TOKEN}`)
      expect(new Headers(init.headers).get('user-agent')).toMatch(/^DiscordBot \(https:\/\/parking\.radio, 1\)$/)
    }
  })

  it('says that Discord refused the token when it answers 401', async () => {
    discordAnswers({ application: failure(401, 0, '401: Unauthorized') })

    const failed = check()

    await expect(failed).rejects.toBeInstanceOf(DiscordRefused)
    await expect(failed).rejects.toThrow('Discord refused this token: 401: Unauthorized')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    ['flags', { flags: 1 << 19, flags_new: undefined }],
    ['flags_new', { flags: undefined, flags_new: String(1 << 19) }],
    ['flags, for a bot on 100 servers or more', { flags: 1 << 18, flags_new: undefined }],
    ['flags_new, along with other flags', { flags: undefined, flags_new: String((1n << 40n) | (1n << 18n)) }],
  ])('takes the Message Content intent from %s', async (_, flags) => {
    discordAnswers({ application: () => Response.json({ ...APPLICATION, ...flags }) })

    expect(await check()).toEqual({ botName: 'parking.radio', channelName: 'chat' })
  })

  it.each([
    ['its flags say so', { flags: 1 << 15, flags_new: String(1 << 15) }],
    ['it has no flags', { flags: undefined, flags_new: undefined }],
  ])("says that the bot doesn't have the Message Content intent when %s", async (_, flags) => {
    discordAnswers({ application: () => Response.json({ ...APPLICATION, ...flags }) })

    await expect(check()).rejects.toThrow(new DiscordRefused('The bot doesn\'t have the Message Content intent: turn it on in its "Bot" page on Discord\'s developer portal'))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('fails as an unexpected answer when the application has no bot', async () => {
    discordAnswers({ application: () => Response.json({ ...APPLICATION, bot: undefined }) })

    const failed = check()

    await expect(failed).rejects.not.toBeInstanceOf(DiscordRefused)
    await expect(failed).rejects.toThrow(/^Unexpected answer from Discord to \/applications\/@me: /)
  })

  it.each([
    ['there is no such channel', failure(404, 10003, 'Unknown Channel')],
    ["the bot can't see it, or isn't on its server", failure(403, 50001, 'Missing Access')],
  ])('says that Discord finds no channel the bot can see when %s', async (_, answer) => {
    discordAnswers({ channel: answer })

    const failed = check()

    await expect(failed).rejects.toBeInstanceOf(DiscordRefused)
    await expect(failed).rejects.toThrow(/^Discord finds no channel with this id that the bot can see: /)
  })

  it("says that the bot can't see the channel when Discord refuses to give its permissions", async () => {
    discordAnswers({ memberPermissions: failure(403, 50001, 'Missing Access') })

    await expect(check()).rejects.toThrow(/^Discord finds no channel with this id that the bot can see: /)
  })

  it.each([
    ['a voice channel', 2],
    ['an announcement channel', 5],
    ['a thread', 11],
    ['a forum', 15],
  ])("says that the channel isn't a text channel when it's %s", async (_, type) => {
    discordAnswers({ channel: () => Response.json({ ...CHANNEL, type }) })

    await expect(check()).rejects.toThrow(new DiscordRefused("This channel isn't a text channel"))
  })

  it.each([
    ['only one', VIEW_CHANNEL | MANAGE_WEBHOOKS | SEND_MESSAGES, 'Read Message History'],
    ['several', VIEW_CHANNEL, 'Read Message History, Manage Webhooks'],
    ['all', SEND_MESSAGES, 'View Channel, Read Message History, Manage Webhooks'],
  ])('names the permissions the bot is missing in the channel, when it misses %s', async (_, bits, missing) => {
    discordAnswers({ memberPermissions: permissions(bits) })

    await expect(check()).rejects.toThrow(new DiscordRefused(`The bot doesn't have these permissions in the channel: ${missing}`))
  })

  it('takes Administrator for every permission', async () => {
    discordAnswers({ memberPermissions: permissions(1n << 3n) })

    expect(await check()).toEqual({ botName: 'parking.radio', channelName: 'chat' })
  })

  it('fails right away, rather than waiting, when Discord refuses requests for now', async () => {
    discordAnswers({ channel: () => Response.json({ message: 'You are being rate limited.', retry_after: 64.57, global: false }, { status: 429, headers: { 'Retry-After': '65' } }) })

    const failed = check()

    await expect(failed).rejects.not.toBeInstanceOf(DiscordRefused)
    await expect(failed).rejects.toThrow('Discord refuses requests for now: You are being rate limited.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['answers with another error', failure(500, 0, '500: Internal Server Error'), 'Discord responded to /channels/{channel.id} with 500: 500: Internal Server Error'],
    ["answers with an error that isn't JSON", () => new Response('Bad gateway', { status: 502 }), 'Discord responded to /channels/{channel.id} with 502: 502'],
    ["answers with something that isn't JSON", () => new Response('<html>', { status: 200 }), /^Unexpected answer from Discord to \/channels\/\{channel\.id\}: /],
  ])("fails, without saying that Discord refused the credentials, or the request's ids, when Discord %s", async (_, answer, message) => {
    discordAnswers({ channel: answer })

    const failed = check()

    await expect(failed).rejects.not.toBeInstanceOf(DiscordRefused)
    await expect(failed).rejects.toThrow(message)
    await expect(failed).rejects.not.toThrow(CHANNEL_ID)
  })

  it("doesn't take a 404 that isn't about the channel for a channel the bot can't see, e.g. a path Discord doesn't know", async () => {
    discordAnswers({ memberPermissions: failure(404, 0, '404: Not Found') })

    const failed = check()

    await expect(failed).rejects.not.toBeInstanceOf(DiscordRefused)
    await expect(failed).rejects.toThrow('Discord responded to /channels/{channel.id}/permissions/member/{user.id} with 404: 404: Not Found')
  })

  it("fails when Discord doesn't answer in time", async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

    await expect(check()).rejects.toThrow('Discord cannot be reached: The operation was aborted due to timeout')
  })

  it("says why Discord can't be reached, which fetch gives as its error's cause, without keeping that error", async () => {
    const cause = Object.assign(new Error(`getaddrinfo ENOTFOUND discord.com (${TOKEN})`), { code: 'ENOTFOUND' })
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause }))

    const failed = check()

    await expect(failed).rejects.toThrow(new Error('Discord cannot be reached: getaddrinfo ENOTFOUND discord.com ([token])'))
    await expect(failed).rejects.not.toHaveProperty('cause')
  })

  it("gives the code of fetch's cause when its message is blank, e.g. when none of Discord's addresses can be reached", async () => {
    const cause = Object.assign(new AggregateError([new Error('connect ECONNREFUSED 162.159.0.1:443')], ''), { code: 'ECONNREFUSED' })
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause }))

    await expect(check()).rejects.toThrow(new Error('Discord cannot be reached: ECONNREFUSED'))
  })

  it("keeps the token out of its errors, even when Discord's message has it", async () => {
    discordAnswers({ application: failure(401, 0, `Bad token ${TOKEN}`) })

    const failed = check()

    await expect(failed).rejects.toThrow('Discord refused this token: Bad token [token]')
  })

  it.each([
    ['with a line break, which fetch would refuse with an error that quotes the header', 'the-secret\nline'],
    ['with a letter past U+00FF', 'the-secret-Ł'],
    ['with a space', 'Bot the-secret'],
    ['that is blank', ''],
  ])('refuses a token %s before sending any request, without quoting it', async (_, token) => {
    discordAnswers()

    const failed = discord.check(token, CHANNEL_ID)

    await expect(failed).rejects.toThrow(new DiscordRefused("Not a Discord bot's token, which only has letters, digits, '.', '_' and '-'"))
    await expect(failed).rejects.not.toThrow('the-secret')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
