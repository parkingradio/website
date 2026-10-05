import { z } from 'zod'
import { cached } from './cache.js'

// A minimal client for SoundCloud's API (https://developers.soundcloud.com/docs/api/guide), authenticated
// as the SoundCloud app whose credentials it's given. It only reads public data, so it uses app-only
// tokens obtained with the app's own credentials (the "client credentials" grant), with no user attached.
//
// SoundCloud's responses are checked against these schemas rather than trusted, and anything unexpected
// fails the request with an error that says what was wrong. The exception is a track that's unexpected,
// which is only reported, so that the others can still be used.
//
// Private playlists can be read too, with the secret of their private link: that's all it takes, whichever
// account they belong to.
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
    // Whether apps can stream the track in full ("playable"), only a preview of it ("preview"), which is
    // 30 seconds long, or not at all ("blocked"). SoundCloud doesn't say why.
    access: z.enum(['playable', 'preview', 'blocked']),
    streamable: z.boolean(),
  })
  .transform((track) => ({
    id: TRACK_URN.exec(track.urn)![1],
    title: track.title,
    durationMs: track.duration,
    url: withoutParameters(track.permalink_url),
    // Why the track can't be streamed in full, or null if it can.
    unplayable: track.access !== 'playable' ? track.access : track.streamable ? null : ('not-streamable' as const),
  }))
export type SoundCloudTrack = z.output<typeof Track>

const Playlist = z
  .object({
    title: z.string(),
    // For a private playlist, that's its private link, with its secret.
    permalink_url: z.string().startsWith('https://soundcloud.com/'),
    sharing: z.string(),
    user: z.object({ username: z.string(), permalink_url: z.string().startsWith('https://soundcloud.com/') }),
  })
  .transform((playlist) => ({
    title: playlist.title,
    url: withoutParameters(playlist.permalink_url),
    private: playlist.sharing !== 'public',
    account: { name: playlist.user.username, url: withoutParameters(playlist.user.permalink_url) },
  }))
export type SoundCloudPlaylist = z.output<typeof Playlist>

// Where `/resolve` redirects for a playlist.
const PLAYLIST_PATH = /^\/playlists\/soundcloud:playlists:(\d+)$/

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

export type PlaylistTracks = {
  playlist: SoundCloudPlaylist
  // In the playlist's order, including the tracks that didn't match the schema.
  tracks: (SoundCloudTrack | InvalidTrack)[]
}

// A track that didn't match the schema, by title (or URN, without one), with what was wrong with it.
export type InvalidTrack = { invalid: true; name: string; problem: string }

// What `resolvePlaylist` finds at a link: the playlist, and the secret of its private link if it's private.
export type PlaylistLink = {
  id: string
  secretToken: string | null
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
      throw new SoundCloudStatusError(`SoundCloud responded to ${pathname} with ${response.status}`, response.status)
    }
    return parse(schema, await response.json(), pathname)
  }

  return {
    /**
     * The playlist a link to it on soundcloud.com leads to, e.g. "https://soundcloud.com/user/sets/name", or
     * "https://soundcloud.com/user/sets/name/s-secret" for a private one. Null when SoundCloud shows no
     * playlist there, e.g. because the link is to a user or a track, or the private link was reset.
     */
    async resolvePlaylist(link: string): Promise<PlaylistLink | null> {
      // SoundCloud redirects to what's at the link on the API, with the secret of a private playlist.
      // Following the redirect would download the playlist with every track in it.
      const response = await get(`${API_ORIGIN}/resolve?url=${encodeURIComponent(link)}`, 'manual')
      await response.body?.cancel()
      if (response.status === 404) return null
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !location) {
        throw new Error(`SoundCloud responded to /resolve with ${response.status}`)
      }
      const resolved = new URL(location, API_ORIGIN)
      const id = PLAYLIST_PATH.exec(resolved.pathname)?.[1]
      if (resolved.origin !== API_ORIGIN || !id) return null
      return { id, secretToken: resolved.searchParams.get('secret_token') }
    },

    /** A playlist, and the tracks in it that the app can see, in the playlist's order. */
    async playlist(id: string, secretToken: string | null): Promise<PlaylistTracks> {
      const urn = `soundcloud:playlists:${id}`
      const secret = secretToken ? `&secret_token=${encodeURIComponent(secretToken)}` : ''
      // The playlist and its first page of tracks are independent, so they're requested together.
      const [playlist, firstPage] = await Promise.all([
        getJson(`${API_ORIGIN}/playlists/${urn}?show_tracks=false${secret}`, Playlist),
        getJson(`${API_ORIGIN}/playlists/${urn}/tracks?linked_partitioning=true&limit=${PAGE_SIZE}${secret}`, TracksPage),
      ]).catch((error: unknown) => {
        if (error instanceof SoundCloudStatusError && error.status === 404) {
          throw new Error('SoundCloud shows no such playlist: it may have been deleted, made private, or had its private link reset')
        }
        throw error
      })
      const tracks: PlaylistTracks['tracks'] = []
      // The secret is carried over to the next pages by SoundCloud.
      for (let page: z.infer<typeof TracksPage> = firstPage, pages = 1; ; pages++) {
        for (const item of page.collection) {
          const parsed = Track.safeParse(item)
          tracks.push(parsed.success ? parsed.data : { invalid: true, name: trackName(item), problem: z.prettifyError(parsed.error) })
        }
        if (!page.next_href) break
        if (pages === MAX_PAGES) throw new Error(`SoundCloud returned more than ${MAX_PAGES} pages of tracks`)
        page = await getJson(page.next_href, TracksPage)
      }
      return { playlist, tracks }
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

// SoundCloud responded with an error status.
class SoundCloudStatusError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// What to call a track that may not have the expected shape.
function trackName(track: unknown): string {
  const { title, urn } = (track ?? {}) as { title?: unknown; urn?: unknown }
  if (typeof title === 'string') return title
  return typeof urn === 'string' ? urn : 'A track with no title'
}

// SoundCloud adds tracking parameters to the URLs of pages.
function withoutParameters(url: string): string {
  const parsed = new URL(url)
  parsed.search = ''
  return parsed.href
}

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Unexpected SoundCloud ${what}: ${z.prettifyError(parsed.error)}\n${JSON.stringify(value).slice(0, 500)}`)
  }
  return parsed.data
}
