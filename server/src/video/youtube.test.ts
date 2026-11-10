import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { YouTubeKeyRefused, youtube } from './youtube.js'

const KEY = 'AIza-the-key'
const CHANNEL_ID = 'UCvMw4qUIPPwkcZmBRRS0vNA'
const UPLOADS = 'UUvMw4qUIPPwkcZmBRRS0vNA'

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()

// Answers every request with `answer`.
function youtubeAnswers(answer: () => Response) {
  fetchMock.mockImplementation(async () => answer())
}

// An error as Google's APIs answer them.
function failure(status: number, reason: string, message: string) {
  return () => Response.json({ error: { code: status, message, errors: [{ message, domain: 'global', reason }] } }, { status })
}

const lastUrl = () => new URL(fetchMock.mock.calls.at(-1)![0])

describe('youtube', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('channel', () => {
    it("reads the channel's uploads, sending the key in a header rather than in the URL", async () => {
      youtubeAnswers(() => Response.json({ items: [{ id: CHANNEL_ID, contentDetails: { relatedPlaylists: { uploads: UPLOADS, likes: '' } } }] }))

      expect(await youtube.channel(KEY, CHANNEL_ID)).toEqual({ uploadsPlaylistId: UPLOADS })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${CHANNEL_ID}`)
      expect(new Headers(init.headers).get('x-goog-api-key')).toBe(KEY)
      expect(url).not.toContain(KEY)
    })

    it('encodes the channel id in the query', async () => {
      youtubeAnswers(() => Response.json({}))

      await youtube.channel(KEY, 'UC&part=snippet')

      expect(lastUrl().searchParams.getAll('id')).toEqual(['UC&part=snippet'])
      expect(lastUrl().searchParams.getAll('part')).toEqual(['contentDetails'])
    })

    it('is null when YouTube finds no such channel', async () => {
      youtubeAnswers(() => Response.json({ kind: 'youtube#channelListResponse', pageInfo: { totalResults: 0 } }))

      expect(await youtube.channel(KEY, CHANNEL_ID)).toBeNull()
    })

    it('fails when YouTube answers with more than one channel', async () => {
      const channel = { contentDetails: { relatedPlaylists: { uploads: UPLOADS } } }
      youtubeAnswers(() => Response.json({ items: [channel, channel] }))

      await expect(youtube.channel(KEY, CHANNEL_ID)).rejects.toThrow(/^Unexpected answer from YouTube to \/channels: /)
    })

    it.each([
      [400, 'badRequest', 'API key not valid. Please pass a valid API key.'],
      [403, 'accessNotConfigured', 'YouTube Data API v3 has not been used in project 123 before or it is disabled.'],
      [403, 'forbidden', 'Requests to this API youtube method youtube.api.v3.V3DataChannelService.List are blocked.'],
    ])('says that YouTube refused the key, and why, when it answers %i %s', async (status, reason, message) => {
      youtubeAnswers(failure(status, reason, message))

      const failed = youtube.channel(KEY, CHANNEL_ID)

      await expect(failed).rejects.toBeInstanceOf(YouTubeKeyRefused)
      await expect(failed).rejects.toThrow(`YouTube refused this key: ${message}`)
    })

    it.each(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'])(
      "doesn't take YouTube refusing requests for now (%s) for a refused key",
      async (reason) => {
        youtubeAnswers(failure(403, reason, 'The request cannot be completed because you have exceeded your quota.'))

        const failed = youtube.channel(KEY, CHANNEL_ID)

        await expect(failed).rejects.not.toBeInstanceOf(YouTubeKeyRefused)
        await expect(failed).rejects.toThrow('YouTube refuses requests for now: The request cannot be completed because you have exceeded your quota.')
      },
    )

    it('keeps the key out of what YouTube says', async () => {
      youtubeAnswers(failure(400, 'badRequest', `API key ${KEY} not valid.`))

      await expect(youtube.channel(KEY, CHANNEL_ID)).rejects.toThrow('YouTube refused this key: API key [key] not valid.')
    })

    it("says when YouTube can't be reached, or answers unexpectedly", async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      await expect(youtube.channel(KEY, CHANNEL_ID)).rejects.toThrow('YouTube cannot be reached: fetch failed')

      youtubeAnswers(() => new Response('<html>Bad gateway</html>', { status: 502 }))
      await expect(youtube.channel(KEY, CHANNEL_ID)).rejects.toThrow('YouTube responded to /channels with 502: 502')

      youtubeAnswers(failure(500, 'backendError', 'Backend Error'))
      await expect(youtube.channel(KEY, CHANNEL_ID)).rejects.toThrow('YouTube responded to /channels with 500: Backend Error')
    })
  })

  describe('newestUpload', () => {
    const upload = (videoId: unknown) => ({ kind: 'youtube#playlistItem', contentDetails: { videoId, videoPublishedAt: '2026-10-01T12:00:00Z' } })

    it('reads the newest video of the uploads, with one request', async () => {
      youtubeAnswers(() => Response.json({ items: [upload('dQw4w9WgXcQ')] }))

      expect(await youtube.newestUpload(KEY, UPLOADS)).toBe('dQw4w9WgXcQ')

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(lastUrl().pathname).toBe('/youtube/v3/playlistItems')
      expect(Object.fromEntries(lastUrl().searchParams)).toEqual({ part: 'contentDetails', playlistId: UPLOADS, maxResults: '1' })
      expect(new Headers(fetchMock.mock.calls[0][1].headers).get('x-goog-api-key')).toBe(KEY)
    })

    it('is null when the channel has no uploads, whether YouTube answers with none or with a 404', async () => {
      youtubeAnswers(() => Response.json({ items: [] }))
      expect(await youtube.newestUpload(KEY, UPLOADS)).toBeNull()

      youtubeAnswers(failure(404, 'playlistNotFound', 'The playlist identified with the request\'s <code>playlistId</code> parameter cannot be found.'))
      expect(await youtube.newestUpload(KEY, UPLOADS)).toBeNull()
    })

    it('fails, saying so, for any other 404', async () => {
      youtubeAnswers(failure(404, 'notFound', 'Not Found'))

      await expect(youtube.newestUpload(KEY, UPLOADS)).rejects.toThrow('YouTube responded to /playlistItems with 404: Not Found')
    })

    it("fails, saying so, when YouTube's answer isn't JSON", async () => {
      youtubeAnswers(() => new Response('<html>Hello</html>', { status: 200 }))

      await expect(youtube.newestUpload(KEY, UPLOADS)).rejects.toThrow(/^Unexpected answer from YouTube to \/playlistItems: .*JSON/)
    })

    it.each([['too short', 'abc'], ['with characters ids do not have', 'dQw4w9WgX"Q'], ['not a string', 42]])(
      'fails when the video id is %s',
      async (_, videoId) => {
        youtubeAnswers(() => Response.json({ items: [upload(videoId)] }))

        await expect(youtube.newestUpload(KEY, UPLOADS)).rejects.toThrow(/^Unexpected answer from YouTube to \/playlistItems: /)
      },
    )

    it('fails like `channel` when YouTube refuses the key, or requests for now', async () => {
      youtubeAnswers(failure(400, 'badRequest', 'API key expired. Please renew the API key.'))
      await expect(youtube.newestUpload(KEY, UPLOADS)).rejects.toBeInstanceOf(YouTubeKeyRefused)

      youtubeAnswers(failure(403, 'quotaExceeded', 'Quota exceeded.'))
      await expect(youtube.newestUpload(KEY, UPLOADS)).rejects.toThrow('YouTube refuses requests for now: Quota exceeded.')
    })
  })
})
