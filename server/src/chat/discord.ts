import { z } from 'zod'
import { errorMessage } from '../api/errors.js'

// A minimal client for Discord's HTTP API (https://discord.com/developers/docs/reference), which checks that a bot can
// follow a channel (see "The Discord credentials" in docs/design/server/chat.md).
//
// The token is only ever sent in the `Authorization` header, never in a URL, which errors and logs could include. Discord's
// messages don't include it either, but it's taken out of every message anyway, and its format is checked before it's sent
// (see `BOT_TOKEN`).
//
// Discord's answers are checked against these schemas rather than trusted, and anything unexpected fails the check with an
// error that says what was wrong.
const API = 'https://discord.com/api/v10'
// Each request's: a check makes three, one after the other.
const REQUEST_TIMEOUT_MS = 10_000
// The form Discord requires for bots' requests: https://discord.com/developers/docs/reference#user-agent.
const USER_AGENT = 'DiscordBot (https://parking.radio, 1)'

// The characters Discord's tokens are made of, and the only ones a token is sent with: Node's fetch refuses a header with a
// line break in it, with an error that quotes the header, token included, and fails on characters past U+00FF too. It
// matches a blank token, so that the routes only say it's too short, but `get` refuses that too.
export const BOT_TOKEN = /^[A-Za-z0-9._-]*$/
export const NOT_A_BOT_TOKEN = "Not a Discord bot's token, which only has letters, digits, '.', '_' and '-'"

// Discord gives the application's flags as a number, `flags`, and as a string, `flags_new`, which can grow past 31 bits.
const Application = z.object({
  flags: z.number().int().nonnegative().optional(),
  flags_new: z.string().regex(/^\d+$/).optional(),
  bot: z.object({ id: z.string().regex(/^\d+$/), username: z.string().min(1) }),
})

const Channel = z.object({ type: z.number().int(), name: z.string().nullish() })

const Permissions = z.object({ permissions: z.string().regex(/^\d+$/) })

// What Discord answers when a request fails: https://discord.com/developers/docs/topics/opcodes-and-status-codes#json.
const ErrorAnswer = z.object({ message: z.string(), code: z.number().optional() })

// The Message Content intent, which lets the bot read messages' text, as an application flag: GATEWAY_MESSAGE_CONTENT, for
// bots on 100 servers or more, which Discord has to approve, or GATEWAY_MESSAGE_CONTENT_LIMITED, which the "Bot" page of
// Discord's developer portal turns on for the others.
const MESSAGE_CONTENT = (1n << 18n) | (1n << 19n)

// A text channel, rather than e.g. a voice channel, a thread or an announcement channel.
const GUILD_TEXT = 0

// Which gives every other permission, whatever the channel's overwrites.
const ADMINISTRATOR = 1n << 3n
// The permissions the bot needs in the channel, by their names on Discord.
const REQUIRED_PERMISSIONS: [string, bigint][] = [
  ['View Channel', 1n << 10n],
  ['Read Message History', 1n << 16n],
  ['Manage Webhooks', 1n << 29n],
]

// For Discord's errors Unknown Channel (10003), when there's no such channel, and Missing Access (50001), when the bot can't
// see it, but also either one when the bot isn't on the channel's server: https://discord.com/developers/docs/topics/opcodes-and-status-codes#json-json-error-codes.
const CHANNEL_NOT_FOUND_CODES = new Set([10003, 50001])
const CHANNEL_NOT_FOUND =
  'Discord finds no channel with this id that the bot can see: check the id, that the bot is on the server of the channel, ' +
  'and that it has View Channel in it'

// The credentials were refused: by Discord, e.g. the token, or the bot can't read the channel, or before asking Discord,
// because the token isn't in the format of Discord's tokens (see `BOT_TOKEN`). The message says why, for admins.
export class DiscordRefused extends Error {}

// The bot's and the channel's names on Discord.
export type DiscordNames = { botName: string; channelName: string }

export type Discord = {
  // Checks that Discord accepts the token, that the bot has the Message Content intent, and that the channel is a text
  // channel where the bot has the permissions it needs, giving their names. Throws a DiscordRefused when one of them isn't
  // so, or another error, e.g. when Discord can't be reached, or refuses requests for now.
  check(botToken: string, channelId: string): Promise<DiscordNames>
}

// Gets `path`, which errors call `resource`, e.g. "/channels/{channel.id}", so that they don't have the request's values. With
// `channelNotFound`, fails with a DiscordRefused when Discord says there's no channel the bot can see.
async function get<T>(botToken: string, path: string, resource: string, schema: z.ZodType<T>, channelNotFound = false): Promise<T> {
  if (!botToken || !BOT_TOKEN.test(botToken)) throw new DiscordRefused(NOT_A_BOT_TOKEN)
  const redact = (message: string) => message.replaceAll(botToken, '[token]')
  // Fetch says why it failed in its error's cause, e.g. that discord.com can't be found, or only with its code, e.g.
  // ECONNREFUSED when none of its addresses accept connections. Fetch's error isn't kept as the cause of this one, since
  // the logs would include it, unredacted.
  const unreachable = (error: unknown) => {
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : error
    const code = cause instanceof Error && 'code' in cause ? String(cause.code) : ''
    return new Error(`Discord cannot be reached: ${redact(errorMessage(cause) || code || errorMessage(error))}`)
  }
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bot ${botToken}`, 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw unreachable(error)
  }
  if (!response.ok) {
    const answer = ErrorAnswer.safeParse(await response.json().catch(() => null))
    const message = redact(answer.data?.message ?? '').slice(0, 500) || `${response.status}`
    if (response.status === 401) throw new DiscordRefused(`Discord refused this token: ${message}`)
    // Rather than waiting until Discord takes requests again, which it says in `Retry-After`.
    if (response.status === 429) throw new Error(`Discord refuses requests for now: ${message}`)
    if (channelNotFound && CHANNEL_NOT_FOUND_CODES.has(answer.data?.code ?? -1)) throw new DiscordRefused(CHANNEL_NOT_FOUND)
    throw new Error(`Discord responded to ${resource} with ${response.status}: ${message}`)
  }
  const unexpected = (problem: string) => new Error(`Unexpected answer from Discord to ${resource}: ${redact(problem)}`)
  let answer: unknown
  try {
    answer = await response.json()
  } catch (error) {
    // E.g. it isn't JSON, or the time to answer ran out while it was being read.
    throw unexpected(errorMessage(error))
  }
  const parsed = schema.safeParse(answer)
  if (!parsed.success) throw unexpected(z.prettifyError(parsed.error))
  return parsed.data
}

export const discord: Discord = {
  async check(botToken, channelId) {
    const application = await get(botToken, '/applications/@me', '/applications/@me', Application)
    const flags = BigInt(application.flags ?? 0) | BigInt(application.flags_new ?? 0)
    if ((flags & MESSAGE_CONTENT) === 0n) {
      throw new DiscordRefused('The bot doesn\'t have the Message Content intent: turn it on in its "Bot" page on Discord\'s developer portal')
    }

    const channel = await get(botToken, `/channels/${channelId}`, '/channels/{channel.id}', Channel, true)
    if (channel.type !== GUILD_TEXT || !channel.name) throw new DiscordRefused('This channel isn\'t a text channel')

    // The bot's permissions in the channel, with its roles and the channel's overwrites, as Discord works them out.
    const path = `/channels/${channelId}/permissions/member/${application.bot.id}`
    const { permissions: bits } = await get(botToken, path, '/channels/{channel.id}/permissions/member/{user.id}', Permissions, true)
    const permissions = BigInt(bits)
    const missing = (permissions & ADMINISTRATOR) !== 0n ? [] : REQUIRED_PERMISSIONS.filter(([, bit]) => (permissions & bit) === 0n)
    if (missing.length > 0) {
      throw new DiscordRefused(`The bot doesn't have these permissions in the channel: ${missing.map(([name]) => name).join(', ')}`)
    }

    return { botName: application.bot.username, channelName: channel.name }
  },
}
