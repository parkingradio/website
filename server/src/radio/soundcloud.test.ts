import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { soundCloudClient } from './soundcloud.js'

const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token'
const RESOLVE_URL = 'https://api.soundcloud.com/resolve'
const PLAYLIST_URL = 'https://api.soundcloud.com/playlists/soundcloud:playlists:1'
const TRACKS_URL = `${PLAYLIST_URL}/tracks`
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
  sharing: 'public',
  secret_uri: null,
  playback_count: 12,
}

// A private track, as SoundCloud describes it in a playlist's tracks.
const privateTrack = {
  ...track,
  sharing: 'private',
  secret_uri: 'https://api.soundcloud.com/tracks/soundcloud:tracks:42?secret_token=s-XyZ789',
}

const playlist = {
  urn: 'soundcloud:playlists:1',
  title: 'Rotation',
  permalink_url: 'https://soundcloud.com/parkingdotradio/sets/rotation?utm_medium=api',
  sharing: 'public',
  duration: 3_874_581,
  user: { username: 'parking.radio', permalink_url: 'https://soundcloud.com/parkingdotradio?utm_medium=api', followers_count: 3 },
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
    [PLAYLIST_URL]: () => Response.json(playlist),
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
      await client().playlist('1', null)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(TOKEN_URL)
      expect(init.method).toBe('POST')
      expect(authorization(0)).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`)
      expect(new URLSearchParams(init.body).get('grant_type')).toBe('client_credentials')
      expect(authorization(1)).toBe('OAuth token-1')
    })

    it('reuses the token until shortly before it expires', async () => {
      const soundcloud = client()
      await soundcloud.playlist('1', null)
      vi.advanceTimersByTime(54 * 60 * 1000)
      await soundcloud.playlist('1', null)
      expect(tokenRequests()).toBe(1)

      vi.advanceTimersByTime(2 * 60 * 1000)
      await soundcloud.playlist('1', null)
      expect(tokenRequests()).toBe(2)
      expect(authorization()).toBe('OAuth token-2')
    })

    it('shares a token request that is in flight', async () => {
      const soundcloud = client()

      await Promise.all([1, 2, 3].map(() => soundcloud.playlist('1', null)))

      expect(tokenRequests()).toBe(1)
    })

    it('retries with a new token when SoundCloud rejects the current one', async () => {
      const soundcloud = client()
      await soundcloud.playlist('1', null)
      vi.advanceTimersByTime(60 * 1000)
      fakeSoundCloud({
        [TRACKS_URL]: (init) =>
          new Headers(init.headers).get('authorization') === 'OAuth token-1'
            ? new Response('', { status: 401 })
            : Response.json({ collection: [track], next_href: null }),
      })

      const { tracks } = await soundcloud.playlist('1', null)

      expect(tracks).toHaveLength(1)
      expect(tokenRequests()).toBe(2)
      expect(authorization()).toBe('OAuth token-2')
    })

    it('renews a rejected token once for the requests that were using it', async () => {
      const soundcloud = client()
      await soundcloud.playlist('1', null)
      vi.advanceTimersByTime(60 * 1000)
      fakeSoundCloud({
        [TRACKS_URL]: (init) =>
          new Headers(init.headers).get('authorization') === 'OAuth token-1'
            ? new Response('', { status: 401 })
            : Response.json({ collection: [track], next_href: null }),
      })

      await Promise.all([1, 2, 3].map(() => soundcloud.playlist('1', null)))

      expect(tokenRequests()).toBe(2)
    })

    it('fails when SoundCloud also rejects the new token', async () => {
      const soundcloud = client()
      await soundcloud.playlist('1', null)
      vi.advanceTimersByTime(60 * 1000)
      fakeSoundCloud({ [TRACKS_URL]: () => new Response('', { status: 401 }) })

      await expect(soundcloud.playlist('1', null)).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(2)
    })

    it('waits until a rejected token is a minute old before renewing it', async () => {
      const soundcloud = client()
      fakeSoundCloud({ [TRACKS_URL]: () => new Response('', { status: 401 }) })
      await expect(soundcloud.playlist('1', null)).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(1)

      vi.advanceTimersByTime(50 * 1000)
      await expect(soundcloud.playlist('1', null)).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(1)

      vi.advanceTimersByTime(10 * 1000)
      await expect(soundcloud.playlist('1', null)).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(2)

      // The new token is rejected too, and is just as recent.
      await expect(soundcloud.playlist('1', null)).rejects.toThrow('with 401')
      expect(tokenRequests()).toBe(2)
    })

    it('waits a minute before asking for a token again after failing to get one', async () => {
      const soundcloud = client()
      fakeSoundCloud({ [TOKEN_URL]: () => new Response('', { status: 401 }) })
      await expect(soundcloud.playlist('1', null)).rejects.toThrow('SoundCloud refused to issue a token: 401')

      fakeSoundCloud()
      vi.advanceTimersByTime(50 * 1000)
      await expect(soundcloud.playlist('1', null)).rejects.toThrow('SoundCloud refused to issue a token: 401')
      expect(tokenRequests()).toBe(1)

      vi.advanceTimersByTime(20 * 1000)
      await soundcloud.playlist('1', null)
      expect(tokenRequests()).toBe(2)
    })

    it('keeps the token out of errors about an unexpected token response', async () => {
      fakeSoundCloud({ [TOKEN_URL]: () => Response.json({ access_token: 'secret-token', expires_in: 'soon' }) })

      const error = await client()
        .playlist('1', null)
        .catch((error: Error) => error)

      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain('Unexpected SoundCloud token response')
      expect(String(error)).not.toContain('secret-token')
    })
  })

  describe('checkCredentials', () => {
    it('says SoundCloud accepts the credentials when it gives a token for them, which the requests that follow use', async () => {
      const soundcloud = client()

      expect(await soundcloud.checkCredentials()).toBe(true)
      await soundcloud.playlist('1', null)

      expect(tokenRequests()).toBe(1)
      expect(authorization()).toBe('OAuth token-1')
    })

    it.each([400, 401])('says SoundCloud refuses the credentials when it answers %i for a token', async (status) => {
      fakeSoundCloud({ [TOKEN_URL]: () => new Response('', { status }) })

      expect(await client().checkCredentials()).toBe(false)
    })

    it('fails when SoundCloud fails otherwise', async () => {
      fakeSoundCloud({ [TOKEN_URL]: () => new Response('', { status: 503 }) })

      await expect(client().checkCredentials()).rejects.toThrow('SoundCloud refused to issue a token: 503')
    })
  })

  describe('resolvePlaylist', () => {
    const resolve = (location: string | null, status = 302) =>
      fakeSoundCloud({ [RESOLVE_URL]: () => new Response(null, { status, headers: location ? { location } : {} }) })

    it('returns the playlist a link leads to, without downloading it', async () => {
      resolve(PLAYLIST_URL)

      const link = await client().resolvePlaylist('https://soundcloud.com/parkingdotradio/sets/rotation')

      expect(link).toEqual({ id: '1', secretToken: null })
      const [url, init] = fetchMock.mock.calls.at(-1)!
      expect(url).toBe(`${RESOLVE_URL}?url=${encodeURIComponent('https://soundcloud.com/parkingdotradio/sets/rotation')}`)
      expect(init.redirect).toBe('manual')
      expect(authorization()).toBe('OAuth token-1')
    })

    it('returns the secret of a private playlist', async () => {
      resolve(`${PLAYLIST_URL}?secret_token=s-AbC123`)

      const link = await client().resolvePlaylist('https://soundcloud.com/parkingdotradio/sets/rotation/s-AbC123')

      expect(link).toEqual({ id: '1', secretToken: 's-AbC123' })
    })

    it.each([
      ['SoundCloud shows nothing at the link', null, 404],
      ['the link is to a user', 'https://api.soundcloud.com/users/soundcloud:users:1', 302],
      ['the link is to a track', 'https://api.soundcloud.com/tracks/soundcloud:tracks:42', 302],
      ['SoundCloud redirects outside of the API', 'https://example.com/playlists/soundcloud:playlists:1', 302],
    ])('returns null when %s', async (_, location, status) => {
      resolve(location, status)

      expect(await client().resolvePlaylist('https://soundcloud.com/parkingdotradio')).toBeNull()
    })

    it.each([
      ['SoundCloud responds with an error status', null, 500],
      ['SoundCloud does not redirect', null, 200],
    ])('fails when %s', async (_, location, status) => {
      resolve(location, status)

      await expect(client().resolvePlaylist('https://soundcloud.com/parkingdotradio/sets/rotation')).rejects.toThrow('/resolve')
    })
  })

  describe('resolveTrack', () => {
    const resolve = (location: string | null, status = 302) =>
      fakeSoundCloud({ [RESOLVE_URL]: () => new Response(null, { status, headers: location ? { location } : {} }) })

    it('returns the id of the track a link leads to, without downloading it', async () => {
      resolve('https://api.soundcloud.com/tracks/soundcloud:tracks:42')

      expect(await client().resolveTrack('https://soundcloud.com/parkingdotradio/3tons')).toBe('42')
      const [url, init] = fetchMock.mock.calls.at(-1)!
      expect(url).toBe(`${RESOLVE_URL}?url=${encodeURIComponent('https://soundcloud.com/parkingdotradio/3tons')}`)
      expect(init.redirect).toBe('manual')
      expect(authorization()).toBe('OAuth token-1')
    })

    it('returns the id of a private track', async () => {
      resolve('https://api.soundcloud.com/tracks/soundcloud:tracks:42?secret_token=s-AbC123')

      expect(await client().resolveTrack('https://soundcloud.com/parkingdotradio/3tons/s-AbC123')).toBe('42')
    })

    it.each([
      ['SoundCloud shows nothing at the link', null, 404],
      ['the link is to a user', 'https://api.soundcloud.com/users/soundcloud:users:1', 302],
      ['the link is to a playlist', PLAYLIST_URL, 302],
      ['SoundCloud redirects outside of the API', 'https://example.com/tracks/soundcloud:tracks:42', 302],
    ])('returns null when %s', async (_, location, status) => {
      resolve(location, status)

      expect(await client().resolveTrack('https://soundcloud.com/parkingdotradio/3tons')).toBeNull()
    })

    it('fails when SoundCloud responds with an error status', async () => {
      resolve(null, 500)

      await expect(client().resolveTrack('https://soundcloud.com/parkingdotradio/3tons')).rejects.toThrow('/resolve')
    })
  })

  describe('playlist', () => {
    it('returns the playlist and its tracks, in a simpler shape', async () => {
      const result = await client().playlist('1', null)

      expect(result).toEqual({
        playlist: {
          title: 'Rotation',
          url: 'https://soundcloud.com/parkingdotradio/sets/rotation',
          private: false,
          account: { name: 'parking.radio', url: 'https://soundcloud.com/parkingdotradio' },
        },
        tracks: [
          {
            id: '42',
            title: '3TONS | parking.radio | 2026.09.27',
            durationMs: 3_874_581,
            unplayable: null,
            secretToken: null,
          },
        ],
      })
      expect(fetchMock.mock.calls.map(([url]) => url).slice(1)).toEqual([
        `${PLAYLIST_URL}?show_tracks=false`,
        `${TRACKS_URL}?linked_partitioning=true&limit=200`,
      ])
    })

    it('reads a private playlist with its secret', async () => {
      fakeSoundCloud({
        [PLAYLIST_URL]: () =>
          Response.json({ ...playlist, sharing: 'private', permalink_url: 'https://soundcloud.com/parkingdotradio/sets/rotation/s-AbC123?utm_medium=api' }),
      })

      const result = await client().playlist('1', 's-AbC123')

      expect(result.playlist).toMatchObject({ private: true, url: 'https://soundcloud.com/parkingdotradio/sets/rotation/s-AbC123' })
      expect(fetchMock.mock.calls.map(([url]) => url).slice(1)).toEqual([
        `${PLAYLIST_URL}?show_tracks=false&secret_token=s-AbC123`,
        `${TRACKS_URL}?linked_partitioning=true&limit=200&secret_token=s-AbC123`,
      ])
    })

    it("keeps a private track's secret", async () => {
      fakeSoundCloud({ [TRACKS_URL]: () => Response.json({ collection: [privateTrack] }) })

      const { tracks } = await client().playlist('1', null)

      expect(tracks).toMatchObject([{ id: '42', unplayable: null, secretToken: 's-XyZ789' }])
    })

    it('says so when SoundCloud shows no such playlist', async () => {
      fakeSoundCloud({ [PLAYLIST_URL]: () => new Response('', { status: 404 }) })

      await expect(client().playlist('1', 's-reset')).rejects.toThrow('SoundCloud shows no such playlist')
    })

    it.each([
      ['only a preview of it can be played', { access: 'preview' }, 'preview'],
      ['it cannot be played at all', { access: 'blocked' }, 'blocked'],
      ['it is not streamable', { streamable: false }, 'not-streamable'],
    ])('says why a track cannot be played in full when %s', async (_, overrides, unplayable) => {
      fakeSoundCloud({ [TRACKS_URL]: () => Response.json({ collection: [{ ...track, ...overrides }] }) })

      const { tracks } = await client().playlist('1', null)

      expect(tracks).toMatchObject([{ unplayable }])
    })

    it("returns the playlist's tracks across pages", async () => {
      const second = { ...track, urn: 'soundcloud:tracks:43' }
      fakeSoundCloud({
        [`${TRACKS_URL}?linked_partitioning=true&limit=200`]: () =>
          Response.json({ collection: [track], next_href: `${TRACKS_URL}?cursor=2` }),
        [`${TRACKS_URL}?cursor=2`]: () => Response.json({ collection: [second], next_href: null }),
      })

      const { tracks } = await client().playlist('1', null)

      expect(tracks).toMatchObject([{ id: '42' }, { id: '43' }])
    })

    it.each([
      ['is missing its duration', { duration: null }, '3TONS | parking.radio | 2026.09.27', 'duration'],
      ['is private without its secret', { sharing: 'private' }, '3TONS | parking.radio | 2026.09.27', 'secret_uri'],
      [
        'is private with an empty secret',
        { sharing: 'private', secret_uri: 'https://api.soundcloud.com/tracks/soundcloud:tracks:42?secret_token=' },
        '3TONS | parking.radio | 2026.09.27',
        'secret_uri',
      ],
      [
        'is private with a secret outside the API',
        { sharing: 'private', secret_uri: 'https://example.com/?secret_token=s-XyZ789' },
        '3TONS | parking.radio | 2026.09.27',
        'secret_uri',
      ],
      ['has no title', { urn: 'soundcloud:tracks:43', title: undefined }, 'soundcloud:tracks:43', 'title'],
      ['has an unknown access', { access: 'members-only' }, '3TONS | parking.radio | 2026.09.27', 'access'],
    ])('keeps a track that %s in its place, and says what was wrong with it', async (_, overrides, name, field) => {
      fakeSoundCloud({ [TRACKS_URL]: () => Response.json({ collection: [{ ...track, ...overrides }, { ...track, urn: 'soundcloud:tracks:44' }] }) })

      const { tracks } = await client().playlist('1', null)

      expect(tracks).toEqual([{ invalid: true, name, problem: expect.stringContaining(field) }, expect.objectContaining({ id: '44' })])
    })

    it.each([
      ['SoundCloud responds with an error status', { [TRACKS_URL]: () => new Response('nope', { status: 500 }) }],
      ['the page has no list of tracks', { [TRACKS_URL]: () => Response.json({ tracks: [track] }) }],
      ['the next page is outside the API', { [TRACKS_URL]: () => Response.json({ collection: [track], next_href: 'https://example.com/next' }) }],
      ['the playlist is described unexpectedly', { [PLAYLIST_URL]: () => Response.json({ ...playlist, title: null }) }],
    ])('fails when %s', async (_, overrides) => {
      fakeSoundCloud(overrides)

      await expect(client().playlist('1', null)).rejects.toThrow()
    })

    it('stops following pages after 25 of them', async () => {
      fakeSoundCloud({ [TRACKS_URL]: () => Response.json({ collection: [track], next_href: `${TRACKS_URL}?again` }) })

      await expect(client().playlist('1', null)).rejects.toThrow('more than 25 pages')
    })
  })

  describe('hlsStream', () => {
    it("returns the signed CDN URL of the track's AAC stream, which expires as its policy says", async () => {
      const stream = await client().hlsStream('42', null)

      expect(fetchMock.mock.calls.map(([url]) => url)).toContain(STREAMS_URL)
      expect(stream).toEqual({
        url: signedUrl(new Date('2026-10-01T13:07:00Z')),
        expiresAt: new Date('2026-10-01T13:07:00Z').getTime(),
      })
      const [url, init] = fetchMock.mock.calls.at(-1)!
      expect(url).toBe(`${HLS_URL}?x=1`)
      expect(init.redirect).toBe('manual')
      expect(authorization()).toBe('OAuth token-1')
    })

    it("asks for a private track's streams with its secret", async () => {
      await client().hlsStream('42', 's-XyZ789')

      expect(fetchMock.mock.calls.map(([url]) => url)).toContain(`${STREAMS_URL}?secret_token=s-XyZ789`)
    })

    it.each([
      ['SoundCloud has no AAC stream for the track', { [STREAMS_URL]: () => Response.json({ hls_mp3_128_url: `${HLS_URL}?y=1` }) }],
      ['the stream does not redirect', { [HLS_URL]: () => new Response('#EXTM3U') }],
      [
        'the stream URL has no signed policy',
        { [HLS_URL]: () => new Response(null, { status: 302, headers: { location: 'https://cdn.test/playlist.m3u8?expires=1' } }) },
      ],
      [
        'the stream URL expires after the year 9999',
        { [HLS_URL]: () => new Response(null, { status: 302, headers: { location: signedUrl(new Date('+010000-01-01T00:00:00Z')) } }) },
      ],
    ])('fails when %s', async (_, overrides) => {
      fakeSoundCloud(overrides)

      await expect(client().hlsStream('42', null)).rejects.toThrow()
    })
  })
})
