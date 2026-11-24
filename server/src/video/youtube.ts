import { z } from 'zod'
import { errorMessage } from '../api/errors.js'
import { YOUTUBE_VIDEO_ID } from '../sessions/links.js'

// A minimal client for the YouTube Data API (https://developers.google.com/youtube/v3/docs), which reads a channel with an
// API key (see docs/design/server/video.md). Each request costs a unit of the key's daily quota.
//
// The key is sent in a header, which Google's APIs take in place of the `key` parameter, so that it's never in a URL,
// which errors and logs could include. YouTube's messages don't include it either, but it's taken out of every message
// anyway, and its format is checked before it's sent (see `API_KEY`).
//
// YouTube's answers are checked against these schemas rather than trusted, and anything unexpected fails the request with
// an error that says what was wrong.
const API = 'https://www.googleapis.com/youtube/v3'
const REQUEST_TIMEOUT_MS = 10_000

// The characters Google's API keys are made of, which a key has to be made of to be sent at all: Node's fetch refuses a
// header with a line break in it, with an error that quotes the header, key included, and characters past U+00FF fail
// too. With only these, a request can't fail because of its header, so that its errors never have the key. It allows a
// blank key, which the routes refuse as too short, and `get` refuses too.
export const API_KEY = /^[A-Za-z0-9_-]*$/
export const NOT_AN_API_KEY = 'Not a YouTube API key, which only has letters, digits, - or _'

const Channels = z.object({
  // Without any, when there's no such channel. There can only be one, since the request names one.
  items: z.array(z.object({ contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().min(1) }) }) })).max(1).optional(),
})

const PlaylistItems = z.object({
  items: z.array(z.object({ contentDetails: z.object({ videoId: z.string().regex(YOUTUBE_VIDEO_ID, 'not a video id') }) })).optional(),
})

// What Google's APIs answer when they fail: https://cloud.google.com/apis/design/errors.
const ErrorAnswer = z.object({
  error: z.object({ message: z.string().optional(), errors: z.array(z.object({ reason: z.string().optional() })).optional() }),
})

// The reasons YouTube gives for refusing requests for now, rather than refusing the key.
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'])

// YouTube refused the key, e.g. because it isn't valid, or the YouTube Data API isn't enabled for its project.
export class YouTubeKeyRefused extends Error {}

// YouTube answered with an error status, giving `reason` for it, if any, e.g. "playlistNotFound".
class YouTubeStatusError extends Error {
  constructor(
    message: string,
    readonly reason: string | undefined,
  ) {
    super(message)
  }
}

export type YouTube = {
  // The id of the channel's uploads playlist, or null when YouTube finds no such channel. Throws a YouTubeKeyRefused when
  // YouTube refuses the key, or another error, e.g. when YouTube can't be reached, or refuses requests for now.
  channel(apiKey: string, channelId: string): Promise<{ uploadsPlaylistId: string } | null>
  // The id of the newest video of an uploads playlist, or null when it has none. Throws like `channel`, and when the video's
  // id isn't one.
  newestUpload(apiKey: string, uploadsPlaylistId: string): Promise<string | null>
}

async function get<T>(apiKey: string, resource: string, query: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  if (!apiKey || !API_KEY.test(apiKey)) throw new YouTubeKeyRefused(NOT_AN_API_KEY)
  const redact = (message: string) => message.replaceAll(apiKey, '[key]')
  let response: Response
  try {
    response = await fetch(`${API}/${resource}?${new URLSearchParams(query)}`, {
      headers: { 'X-Goog-Api-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // Fetch says why in its error's cause, e.g. that www.googleapis.com can't be found.
    const reason = error instanceof Error && error.cause !== undefined ? error.cause : error
    // eslint-disable-next-line preserve-caught-error -- the logs would include the cause, whose messages aren't redacted.
    throw new Error(`YouTube cannot be reached: ${redact(errorMessage(reason))}`)
  }
  if (!response.ok) {
    const answer = ErrorAnswer.safeParse(await response.json().catch(() => null))
    const reason = answer.data?.error.errors?.[0]?.reason
    const message = redact(answer.data?.error.message ?? '').slice(0, 500) || `${response.status}`
    if (reason && QUOTA_REASONS.has(reason)) throw new YouTubeStatusError(`YouTube refuses requests for now: ${message}`, reason)
    // What Google's APIs answer for a key that isn't valid, or can't be used for YouTube.
    if (response.status === 400 || response.status === 403) throw new YouTubeKeyRefused(`YouTube refused this key: ${message}`)
    throw new YouTubeStatusError(`YouTube responded to /${resource} with ${response.status}: ${message}`, reason)
  }
  const unexpected = (problem: string) => new Error(`Unexpected answer from YouTube to /${resource}: ${redact(problem)}`)
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

export const youtube: YouTube = {
  async channel(apiKey, channelId) {
    const { items } = await get(apiKey, 'channels', { part: 'contentDetails', id: channelId }, Channels)
    const channel = items?.[0]
    return channel ? { uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads } : null
  },

  async newestUpload(apiKey, uploadsPlaylistId) {
    try {
      // Newest first.
      const { items } = await get(apiKey, 'playlistItems', { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: '1' }, PlaylistItems)
      return items?.[0]?.contentDetails.videoId ?? null
    } catch (error) {
      // What YouTube answers for the uploads of a channel that has none.
      if (error instanceof YouTubeStatusError && error.reason === 'playlistNotFound') return null
      throw error
    }
  },
}
