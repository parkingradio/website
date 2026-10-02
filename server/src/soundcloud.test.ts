import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { soundCloudClient } from './soundcloud.js'

const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token'
const TRACKS_URL = 'https://api.soundcloud.com/users/soundcloud:users:1/tracks'
const STREAMS_URL = 'https://api.soundcloud.com/tracks/soundcloud:tracks:42/streams'
const HLS_URL = 'https://api.soundcloud.com/tracks/soundcloud:tracks:42/streams/abc/hls'

const track = {
  urn: 'soundcloud:tracks:42',
  title: '3TONS | parking.radio | 2026.09.27',
  duration: 3_874_581,
  permalink_url: 'https://soundcloud.com/parkingdotradio/3tons?utm_medium=api',
  created_at: '2026/09/27 19:31:03 +0000',
  access: 'playable',
  streamable: true,
  playback_count: 12,
}

// A CloudFront signed URL as SoundCloud hands them out, with the policy in CloudFront's URL-safe base64.
function signedUrl(policyExpiresAt: Date) {
  const policy = { Statement: [{ Resource: 'https://cdn.test/*', Condition: { DateLessThan: { 'AWS:EpochTime': policyExpiresAt.getTime() / 1000 } } }] }
  const encoded = Buffer.from(JSON.stringify(policy)).toString('base64').replaceAll('+', '-').replaceAll('=', '_').replaceAll('/', '~')
  const expires = policyExpiresAt.getTime() / 1000 + 2 * 60 * 60
  return `https://cdn.test/aac_160k/playlist.m3u8?expires=${expires}&Policy=${encoded}&Signature=sig&Key-Pair-Id=K1`
}

type Route = (init: RequestInit) => Response | Promise<Response>

const fetchMock = vi.fn()
let tokensIssued = 0

// Fakes SoundCloud: each URL gets the response of the longest route it starts with.
function fakeSoundCloud(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    [TOKEN_URL]: () => Response.json({ access_token: `token-${++tokensIssued}`, expires_in: 3599, refresh_token: 'r', scope: '' }),
    [TRACKS_URL]: () => Response.json({ collection: [track], next_href: null }),
    [STREAMS_URL]: () => Response.json({ hls_aac_160_url: `${HLS_URL}?x=1`, hls_mp3_128_url: `${HLS_URL}?y=1` }),
    [HLS_URL]: () => new Response(null, { status: 302, headers: { location: signedUrl(new Date('2026-10-01T13:07:00Z')) } }),
    ...overrides,
  }
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const route = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => url.startsWith(prefix))
    if (!route) throw new Error(`Unexpected fetch: ${url}`)
    return routes[route](init)
  })
}

const client = () => soundCloudClient({ clientId: 'client-id', clientSecret: 'client-secret' })
const tokenRequests = () => fetchMock.mock.calls.filter(([url]) => url === TOKEN_URL).length
// Of the last request, by default.
const authorization = (call = -1) => new Headers(fetchMock.mock.calls.at(call)![1].headers).get('authorization')

describe('soundCloudClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
    fetchMock.mockReset()
    tokensIssued = 0
    fakeSoundCloud()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('authentication', () => {
    it("authenticates with an app-only token obtained with the app's credentials", async () => {
      await client().userTracks('1')

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(TOKEN_URL)
      expect(init.method).toBe('POST')
      expect(authorization(0)).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`)
      expect(new URLSearchParams(init.body).get('grant_type')).toBe('client_credentials')
      expect(authorization(1)).toBe('OAuth token-1')
    })

    it('reuses the token until shortly before it expires', async () => {
      const soundcloud = client()
      await soundcloud.userTracks('1')
      vi.advanceTimersByTime(54 * 60 * 1000)
      await soundcloud.userTracks('1')
      expect(tokenRequests()).toBe(1)

      vi.advanceTimersByTime(2 * 60 * 1000)
      await soundcloud.userTracks('1')
      expect(tokenRequests()).toBe(2)
      expect(authorization()).toBe('OAuth token-2')
    })

    it('shares a token request that is in flight', async () => {
      const soundcloud = client()

      await Promise.all([1, 2, 3].map(() => soundcloud.userTracks('1')))

      expect(tokenRequests()).toBe(1)
    })

    it('retries with a new token when SoundCloud rejects the current one', async () => {
      const soundcloud = client()
      await soundcloud.userTracks('1')
      vi.advanceTimersByTime(60 * 1000)
      fakeSoundCloud({
        [TRACKS_URL]: (init) =>
          new Headers(init.headers).get('authorization') === 'OAuth token-1'
            ? new Response('', { status: 401 })
            : Response.json({ collection: [track], next_href: null }),
      })

      const { tracks } = await soundcloud.userTracks('1')

      expect(tracks).toHaveLength(1)
      expect(tokenRequests()).toBe(2)
      expect(authorization()).toBe('OAuth token-2')
    })

    it('renews a rejected token once for the requests that were using it', async () => {
      const soundcloud = client()
      await soundcloud.userTracks('1')
      vi.advanceTimersByTime(60 * 1000)
      fakeSoundCloud({
        [TRACKS_URL]: (init) =>
          new Headers(init.headers).get('authorization') === 'OAuth token-1'
            ? new Response('', { status: 401 })
            : Response.json({ collection: [track], next_href: null }),
      })

      await Promise.all([1, 2, 3].map(() => soundcloud.userTracks('1')))

      expect(tokenRequests()).toBe(2)
    })

    it('fails when SoundCloud also rejects the new token', async () => {
      const soundcloud = client()
      await soundcloud.userTracks('1')
      vi.advanceTimersByTime(60 * 1000)
      fakeSoundCloud({ [TRACKS_URL]: () => new Response('', { status: 401 }) })

      await expect(soundcloud.userTracks('1')).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(2)
    })

    it('waits until a rejected token is a minute old before renewing it', async () => {
      const soundcloud = client()
      fakeSoundCloud({ [TRACKS_URL]: () => new Response('', { status: 401 }) })
      await expect(soundcloud.userTracks('1')).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(1)

      vi.advanceTimersByTime(50 * 1000)
      await expect(soundcloud.userTracks('1')).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(1)

      vi.advanceTimersByTime(10 * 1000)
      await expect(soundcloud.userTracks('1')).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(2)

      // The new token is rejected too, and is just as recent.
      await expect(soundcloud.userTracks('1')).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(2)
    })

    it('waits a minute before asking for a token again after failing to get one', async () => {
      const soundcloud = client()
      fakeSoundCloud({ [TOKEN_URL]: () => new Response('', { status: 401 }) })
      await expect(soundcloud.userTracks('1')).rejects.toThrow('SoundCloud refused to issue a token: 401')

      fakeSoundCloud()
      vi.advanceTimersByTime(50 * 1000)
      await expect(soundcloud.userTracks('1')).rejects.toThrow('SoundCloud refused to issue a token: 401')
      expect(tokenRequests()).toBe(1)

      vi.advanceTimersByTime(20 * 1000)
      await soundcloud.userTracks('1')
      expect(tokenRequests()).toBe(2)
    })

    it('keeps the token out of errors about an unexpected token response', async () => {
      fakeSoundCloud({ [TOKEN_URL]: () => Response.json({ access_token: 'secret-token', expires_in: 'soon' }) })

      const error = await client()
        .userTracks('1')
        .catch((error: Error) => error)

      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain('Unexpected SoundCloud token response')
      expect(String(error)).not.toContain('secret-token')
    })
  })

  describe('userTracks', () => {
    it("returns the user's tracks, in a simpler shape", async () => {
      const result = await client().userTracks('1')

      expect(result).toEqual({
        tracks: [
          {
            id: '42',
            title: '3TONS | parking.radio | 2026.09.27',
            durationMs: 3_874_581,
            url: 'https://soundcloud.com/parkingdotradio/3tons',
            playable: true,
          },
        ],
        invalid: [],
      })
    })

    it.each([
      ['only a preview of it can be played', { access: 'preview' }],
      ['it is not streamable', { streamable: false }],
    ])('marks a track as not playable when %s', async (_, overrides) => {
      fakeSoundCloud({ [TRACKS_URL]: () => Response.json({ collection: [{ ...track, ...overrides }] }) })

      const {
        tracks: [{ playable }],
      } = await client().userTracks('1')

      expect(playable).toBe(false)
    })

    it("returns the user's tracks across pages", async () => {
      const second = { ...track, urn: 'soundcloud:tracks:43' }
      fakeSoundCloud({
        [`${TRACKS_URL}?linked_partitioning=true&limit=200`]: () =>
          Response.json({ collection: [track], next_href: `${TRACKS_URL}?cursor=2` }),
        [`${TRACKS_URL}?cursor=2`]: () => Response.json({ collection: [second], next_href: null }),
      })

      const { tracks } = await client().userTracks('1')

      expect(tracks.map((t) => t.id)).toEqual(['42', '43'])
    })

    it.each([
      ['is missing its duration', { duration: null }, '"3TONS | parking.radio | 2026.09.27"', 'duration'],
      ['links outside of SoundCloud', { permalink_url: 'https://example.com' }, '"3TONS | parking.radio | 2026.09.27"', 'permalink_url'],
      ['has no title', { urn: 'soundcloud:tracks:43', title: undefined }, 'soundcloud:tracks:43', 'title'],
    ])('leaves out a track that %s, and says what was wrong with it', async (_, overrides, name, field) => {
      fakeSoundCloud({ [TRACKS_URL]: () => Response.json({ collection: [{ ...track, ...overrides }, { ...track, urn: 'soundcloud:tracks:44' }] }) })

      const { tracks, invalid } = await client().userTracks('1')

      expect(tracks.map((t) => t.id)).toEqual(['44'])
      expect(invalid).toHaveLength(1)
      expect(invalid[0].slice(0, name.length + 2)).toBe(`${name}: `)
      expect(invalid[0]).toContain(field)
    })

    it.each([
      ['SoundCloud responds with an error status', () => new Response('nope', { status: 500 })],
      ['the page has no list of tracks', () => Response.json({ tracks: [track] })],
      ['the next page is outside the API', () => Response.json({ collection: [track], next_href: 'https://example.com/next' })],
    ])('fails when %s', async (_, reply) => {
      fakeSoundCloud({ [TRACKS_URL]: reply })

      await expect(client().userTracks('1')).rejects.toThrow()
    })

    it('stops following pages after 25 of them', async () => {
      fakeSoundCloud({ [TRACKS_URL]: () => Response.json({ collection: [track], next_href: `${TRACKS_URL}?again` }) })

      await expect(client().userTracks('1')).rejects.toThrow('more than 25 pages')
    })
  })

  describe('hlsStream', () => {
    it("returns the signed CDN URL of the track's AAC stream, which expires as its policy says", async () => {
      const stream = await client().hlsStream('42')

      expect(stream).toEqual({
        url: signedUrl(new Date('2026-10-01T13:07:00Z')),
        expiresAt: new Date('2026-10-01T13:07:00Z').getTime(),
      })
      const [url, init] = fetchMock.mock.calls.at(-1)!
      expect(url).toBe(`${HLS_URL}?x=1`)
      expect(init.redirect).toBe('manual')
      expect(authorization()).toBe('OAuth token-1')
    })

    it.each([
      ['SoundCloud has no AAC stream for the track', { [STREAMS_URL]: () => Response.json({ hls_mp3_128_url: `${HLS_URL}?y=1` }) }],
      ['the stream does not redirect', { [HLS_URL]: () => new Response('#EXTM3U') }],
      [
        'the stream URL has no signed policy',
        { [HLS_URL]: () => new Response(null, { status: 302, headers: { location: 'https://cdn.test/playlist.m3u8?expires=1' } }) },
      ],
    ])('fails when %s', async (_, overrides) => {
      fakeSoundCloud(overrides)

      await expect(client().hlsStream('42')).rejects.toThrow()
    })
  })
})
