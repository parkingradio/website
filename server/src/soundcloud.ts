import { z } from 'zod'
import { cached } from './cache.js'

// A minimal client for SoundCloud's API (https://developers.soundcloud.com/docs/api/guide), authenticated
// as the SoundCloud app whose credentials it's given. It only reads public data, so it uses app-only
// tokens obtained with the app's own credentials (the "client credentials" grant), with no user attached.
//
// SoundCloud's responses are checked against these schemas rather than trusted, and anything unexpected
// fails the request with an error that says what was wrong. The exception is a track that's unexpected,
// which is only reported, so that the others can still be used.
const API_ORIGIN = 'https://api.soundcloud.com'
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token'
const REQUEST_TIMEOUT_MS = 10_000

// Tokens last an hour. They're renewed a little before they expire, so that one doesn't expire mid-request.
const TOKEN_RENEWAL_MARGIN_MS = 5 * 60 * 1000
// SoundCloud limits how many tokens an app can obtain, so a failure to get one is kept for this long
// rather than retried by every request, e.g. if the credentials are wrong.
const TOKEN_FAILURE_BACKOFF_MS = 60 * 1000
// For the same reason, a token SoundCloud rejects is only renewed if it's at least this old, so that requests
// that keep getting rejected, whatever the reason, don't each obtain a new token.
const REJECTED_TOKEN_MIN_AGE_MS = 60 * 1000

// The largest page SoundCloud serves. MAX_PAGES only guards against following `next_href` forever.
const PAGE_SIZE = 200
const MAX_PAGES = 25

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
})
// When it was obtained, in milliseconds since the epoch.
type Token = z.infer<typeof TokenResponse> & { obtainedAt: number }

// Tracks are turned into a simpler shape, so that SoundCloud's formats don't leak out of this file.
const TRACK_URN = /^soundcloud:tracks:(\d+)$/
const Track = z
  .object({
    urn: z.string().regex(TRACK_URN),
    title: z.string(),
    // In milliseconds.
    duration: z.number().int().positive(),
    permalink_url: z.string().startsWith('https://soundcloud.com/'),
    // Whether the track can be streamed in full ("playable"), or only a preview or not at all.
    access: z.string(),
    streamable: z.boolean(),
  })
  .transform((track) => {
    // SoundCloud adds tracking parameters to the URL.
    const url = new URL(track.permalink_url)
    url.search = ''
    return {
      id: TRACK_URN.exec(track.urn)![1],
      title: track.title,
      durationMs: track.duration,
      url: url.href,
      playable: track.streamable && track.access === 'playable',
    }
  })
export type SoundCloudTrack = z.output<typeof Track>

const TracksPage = z.object({
  // Each track is checked on its own, so that one SoundCloud describes unexpectedly (e.g. one it's still
  // processing) is left out rather than failing all the others.
  collection: z.array(z.unknown()),
  // Checked to be on the API, since the token gets sent along to it.
  next_href: z.string().startsWith(`${API_ORIGIN}/`).nullish(),
})

const Streams = z.object({
  // SoundCloud only serves full tracks as HLS, either as MP3 at 128 kbps or AAC at 160 kbps. AAC sounds
  // better at that rate, and every browser that plays HLS plays it.
  hls_aac_160_url: z.string().startsWith(`${API_ORIGIN}/`),
})

// https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-creating-signed-url-custom-policy.html
const CloudFrontPolicy = z.object({
  Statement: z
    .array(z.object({ Condition: z.object({ DateLessThan: z.object({ 'AWS:EpochTime': z.number() }) }) }))
    .min(1),
})

export type UserTracks = {
  tracks: SoundCloudTrack[]
  // The tracks that didn't match the schema, each with what was wrong with it.
  invalid: string[]
}

export type HlsStream = {
  url: string
  // When `url` stops working, in milliseconds since the epoch.
  expiresAt: number
}

export type SoundCloudCredentials = {
  clientId: string
  clientSecret: string
}

export function soundCloudClient({ clientId, clientSecret }: SoundCloudCredentials) {
  // The last token requested, successfully or not, until it has to be renewed.
  const token = cached(requestToken, (outcome) =>
    outcome.status === 'fulfilled'
      ? Date.now() + outcome.value.expires_in * 1000 - TOKEN_RENEWAL_MARGIN_MS
      : Date.now() + TOKEN_FAILURE_BACKOFF_MS,
  )

  async function requestToken(): Promise<Token> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json; charset=utf-8',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`SoundCloud refused to issue a token: ${response.status}`)
    }
    // Not parsed with `parse`, which would put the response, and so the token, in the error message.
    const parsed = TokenResponse.safeParse(await response.json())
    if (!parsed.success) throw new Error(`Unexpected SoundCloud token response: ${z.prettifyError(parsed.error)}`)
    return { ...parsed.data, obtainedAt: Date.now() }
  }

  async function get(url: string, redirect: 'follow' | 'manual' = 'follow'): Promise<Response> {
    const send = async (accessToken: Promise<Token>) =>
      fetch(url, {
        headers: { Authorization: `OAuth ${(await accessToken).access_token}`, Accept: 'application/json; charset=utf-8' },
        redirect,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

    // Tokens are renewed before they expire, so SoundCloud only rejects one if it revoked it early, e.g.
    // after the app's secret was changed. The request is then retried once, with a new token, unless the
    // token is too recent to be renewed already.
    const accessToken = token()
    const response = await send(accessToken)
    if (response.status !== 401 || Date.now() - (await accessToken).obtainedAt < REJECTED_TOKEN_MIN_AGE_MS) return response
    await response.body?.cancel()
    token.forget(accessToken)
    return send(token())
  }

  async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const response = await get(url)
    const { pathname } = new URL(url)
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`SoundCloud responded to ${pathname} with ${response.status}`)
    }
    return parse(schema, await response.json(), pathname)
  }

  return {
    /** All of a user's tracks that the app can see, i.e. their public ones, in the order SoundCloud lists them. */
    async userTracks(userId: string): Promise<UserTracks> {
      const tracks: SoundCloudTrack[] = []
      const invalid: string[] = []
      let url: string | null | undefined = `${API_ORIGIN}/users/soundcloud:users:${userId}/tracks?linked_partitioning=true&limit=${PAGE_SIZE}`
      for (let pages = 0; url; pages++) {
        if (pages === MAX_PAGES) throw new Error(`SoundCloud returned more than ${MAX_PAGES} pages of tracks`)
        const page: z.infer<typeof TracksPage> = await getJson(url, TracksPage)
        for (const item of page.collection) {
          const parsed = Track.safeParse(item)
          if (parsed.success) tracks.push(parsed.data)
          else invalid.push(`${trackName(item)}: ${z.prettifyError(parsed.error)}`)
        }
        url = page.next_href
      }
      return { tracks, invalid }
    },

    /** Where a track can be streamed from, without credentials. */
    async hlsStream(trackId: string): Promise<HlsStream> {
      const { hls_aac_160_url } = await getJson(`${API_ORIGIN}/tracks/soundcloud:tracks:${trackId}/streams`, Streams)
      // That URL is on the API, so it needs the token. It redirects to a signed URL on SoundCloud's CDN,
      // which doesn't, and that's what's handed out. Following the redirect would download the playlist.
      const response = await get(hls_aac_160_url, 'manual')
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location?.startsWith('https://')) {
        throw new Error(`SoundCloud did not redirect to a stream: ${response.status} ${location ?? '(no location)'}`)
      }
      return { url: location, expiresAt: signedUrlExpiry(location) }
    },
  }
}

export type SoundCloudClient = ReturnType<typeof soundCloudClient>

// Stream URLs are CloudFront signed URLs, whose `Policy` parameter is the policy CloudFront enforces, in a
// URL-safe variant of base64. For playlists, it allows about 2 minutes more than the length of the track.
// The URLs also have an `expires` parameter, about 2 hours later than that, but it isn't the signed limit.
function signedUrlExpiry(url: string): number {
  const encoded = new URL(url).searchParams.get('Policy')
  if (!encoded) throw new Error(`SoundCloud stream URL has no signed policy: ${url}`)
  const json = Buffer.from(encoded.replaceAll('-', '+').replaceAll('_', '=').replaceAll('~', '/'), 'base64').toString()
  const policy = parse(CloudFrontPolicy, JSON.parse(json), 'stream URL policy')
  return Math.min(...policy.Statement.map((statement) => statement.Condition.DateLessThan['AWS:EpochTime'])) * 1000
}

// What to call a track that may not have the expected shape.
function trackName(track: unknown): string {
  const { title, urn } = (track ?? {}) as { title?: unknown; urn?: unknown }
  if (typeof title === 'string') return JSON.stringify(title)
  return typeof urn === 'string' ? urn : 'A track with no title'
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Unexpected SoundCloud ${what}: ${z.prettifyError(parsed.error)}\n${JSON.stringify(value).slice(0, 500)}`)
  }
  return parsed.data
}
