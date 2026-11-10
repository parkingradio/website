import { z } from 'zod'
import { errorMessage } from '../api/errors.js'
import { YOUTUBE_VIDEO_ID } from '../sessions/links.js'

// A minimal client for the YouTube Data API (https://developers.google.com/youtube/v3/docs), which reads a channel with an
// API key (see docs/design/server/video.md). Each request costs a unit of the key's daily quota.
//
// The key is sent in a header, which Google's APIs take in place of the `key` parameter, so that it's never in a URL,
// which errors and logs could include. YouTube's messages don't include it either, but it's taken out of them anyway.
//
// YouTube's answers are checked against these schemas rather than trusted, and anything unexpected fails the request with
// an error that says what was wrong.
const API = 'https://www.googleapis.com/youtube/v3'
const REQUEST_TIMEOUT_MS = 10_000

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
  let response: Response
  try {
    response = await fetch(`${API}/${resource}?${new URLSearchParams(query)}`, {
      headers: { 'X-Goog-Api-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`YouTube cannot be reached: ${errorMessage(error)}`, { cause: error })
  }
  if (!response.ok) {
    const answer = ErrorAnswer.safeParse(await response.json().catch(() => null))
    const reason = answer.data?.error.errors?.[0]?.reason
    const message = answer.data?.error.message?.replaceAll(apiKey, '[key]').slice(0, 500) || `${response.status}`
    if (reason && QUOTA_REASONS.has(reason)) throw new YouTubeStatusError(`YouTube refuses requests for now: ${message}`, reason)
    // What Google's APIs answer for a key that isn't valid, or can't be used for YouTube.
    if (response.status === 400 || response.status === 403) throw new YouTubeKeyRefused(`YouTube refused this key: ${message}`)
    throw new YouTubeStatusError(`YouTube responded to /${resource} with ${response.status}: ${message}`, reason)
  }
  const unexpected = (problem: string) => new Error(`Unexpected answer from YouTube to /${resource}: ${problem}`)
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
