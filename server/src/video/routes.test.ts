import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import fastifyCookie from '@fastify/cookie'

import { useZodSchemas } from '../api/schemas.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { inQuebecTime } from '../api/formats.js'
import type { YouTubeCredentials } from './credentials.js'
import { videoRoutes } from './routes.js'
import { YouTubeKeyRefused } from './youtube.js'
import type { YouTube } from './youtube.js'

const channel = vi.fn<YouTube['channel']>()
const newestUpload = vi.fn<YouTube['newestUpload']>()

// The credentials, as the database would keep them.
let entered: YouTubeCredentials | null = null
const load = vi.fn<() => Promise<YouTubeCredentials | null>>()
const save = vi.fn<(credentials: YouTubeCredentials) => Promise<void>>()

const NOW = new Date('2026-10-01T12:00:00Z').getTime()
const MINUTE = 60 * 1000

const CHANNEL_ID = 'UCvMw4qUIPPwkcZmBRRS0vNA'
const OTHER_CHANNEL_ID = 'UC_other-channel-0123456'
const ENTERED: YouTubeCredentials = {
  channelId: CHANNEL_ID,
  apiKey: 'the-key',
  uploadsPlaylistId: 'UUvMw4qUIPPwkcZmBRRS0vNA',
  updatedBy: 'someone@example.com',
  updatedAt: new Date(NOW - 48 * 60 * MINUTE),
}

const VIDEO = 'dQw4w9WgXcQ'
const OTHER_VIDEO = 'aBcDeFgHiJk'

async function buildApp(logs?: string[]) {
  const app = Fastify({ logger: logs ? { stream: { write: (line: string) => logs.push(line) } } : false })
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(videoRoutes, { youtube: { channel, newestUpload }, credentials: { load, save } })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function video(app: App) {
  const response = await app.inject({ method: 'GET', url: '/api/video' })
  return { status: response.statusCode, body: response.json() }
}

const URL = '/api/admin/video/credentials'

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

const put = (app: App, body: unknown) => send(app, 'PUT', URL, body)

describe('video routes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    process.env.JWT_SECRET = 'test-secret'
    channel.mockReset().mockResolvedValue({ uploadsPlaylistId: 'UU_other-channel-0123456' })
    newestUpload.mockReset().mockResolvedValue(VIDEO)
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

  describe('GET /api/video', () => {
    it("gives the channel's newest upload, read with the credentials that were entered", async () => {
      const app = await buildApp()

      expect(await video(app)).toEqual({ status: 200, body: { video: { id: VIDEO } } })
      expect(newestUpload).toHaveBeenCalledExactlyOnceWith('the-key', ENTERED.uploadsPlaylistId)
    })

    it('gives no video when the channel has no uploads', async () => {
      newestUpload.mockResolvedValue(null)
      const app = await buildApp()

      expect(await video(app)).toEqual({ status: 200, body: { video: null } })
    })

    it('responds 502 until the credentials have been entered, without asking YouTube', async () => {
      entered = null
      const app = await buildApp()

      expect(await video(app)).toEqual({ status: 502, body: { ok: false, error: 'The video is unavailable right now' } })
      expect(newestUpload).not.toHaveBeenCalled()
    })

    it("responds 502, without YouTube's error, until a read succeeds", async () => {
      newestUpload.mockRejectedValue(new YouTubeKeyRefused('YouTube refused this key: API key not valid.'))
      const app = await buildApp()

      expect(await video(app)).toEqual({ status: 502, body: { ok: false, error: 'The video is unavailable right now' } })

      newestUpload.mockResolvedValue(VIDEO)
      vi.advanceTimersByTime(MINUTE)
      expect(await video(app)).toEqual({ status: 200, body: { video: { id: VIDEO } } })
    })

    it('responds 502 when the database fails', async () => {
      load.mockRejectedValue(new Error('connection refused'))
      const app = await buildApp()

      expect((await video(app)).status).toBe(502)
    })

    it('reads YouTube at most once a minute, and only when the video is asked for', async () => {
      const app = await buildApp()

      await Promise.all([video(app), video(app), video(app)])
      vi.advanceTimersByTime(MINUTE - 1)
      await video(app)
      expect(newestUpload).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(10 * MINUTE)
      newestUpload.mockResolvedValue(OTHER_VIDEO)
      expect((await video(app)).body).toEqual({ video: { id: OTHER_VIDEO } })
      expect(newestUpload).toHaveBeenCalledTimes(2)
    })

    it.each([
      ["YouTube can't be reached", new Error('YouTube cannot be reached: fetch failed')],
      ['YouTube refuses the key, e.g. once it was revoked', new YouTubeKeyRefused('YouTube refused this key: API key expired.')],
      ['YouTube gives a video id that is not one', new Error('Unexpected answer from YouTube to /playlistItems: not a video id')],
    ])('goes on with the video it read before when %s, and tries again a minute later', async (_, error) => {
      const app = await buildApp()
      await video(app)

      vi.advanceTimersByTime(MINUTE)
      newestUpload.mockRejectedValue(error)
      expect((await video(app)).body).toEqual({ video: { id: VIDEO } })
      expect((await video(app)).body).toEqual({ video: { id: VIDEO } })
      expect(newestUpload).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(MINUTE)
      newestUpload.mockResolvedValue(OTHER_VIDEO)
      expect((await video(app)).body).toEqual({ video: { id: OTHER_VIDEO } })
    })

    it('goes on with the video it read before when the key changes elsewhere, until it reads one with the new key', async () => {
      const app = await buildApp()
      await video(app)

      entered = { ...ENTERED, apiKey: 'new-key', updatedAt: new Date(NOW) }
      newestUpload.mockRejectedValue(new Error('YouTube cannot be reached: fetch failed'))
      expect((await video(app)).body).toEqual({ video: { id: VIDEO } })
      // Right away, rather than a minute after the last read.
      expect(newestUpload).toHaveBeenLastCalledWith('new-key', ENTERED.uploadsPlaylistId)

      vi.advanceTimersByTime(MINUTE)
      newestUpload.mockResolvedValue(OTHER_VIDEO)
      expect((await video(app)).body).toEqual({ video: { id: OTHER_VIDEO } })
    })

    it('starts over when the channel changes elsewhere', async () => {
      const app = await buildApp()
      await video(app)

      entered = { ...ENTERED, channelId: OTHER_CHANNEL_ID, uploadsPlaylistId: 'UU_other-channel-0123456', updatedAt: new Date(NOW) }
      newestUpload.mockRejectedValue(new Error('YouTube cannot be reached: fetch failed'))

      expect((await video(app)).status).toBe(502)
      expect(newestUpload).toHaveBeenLastCalledWith('the-key', 'UU_other-channel-0123456')
    })
  })

  describe('/api/admin/video/credentials', () => {
    it.each([
      ['GET', URL],
      ['PUT', URL],
      ['POST', `${URL}/check`],
    ] as const)('%s %s requires a session', async (method, url) => {
      const app = await buildApp()

      const response = await app.inject({ method, url, payload: method === 'GET' ? undefined : { channelId: CHANNEL_ID, apiKey: 'key' } })

      expect(response.statusCode).toBe(401)
      expect(channel).not.toHaveBeenCalled()
    })

    it('returns null until the credentials have been entered', async () => {
      entered = null
      const app = await buildApp()

      expect(await credentials(app)).toEqual({ ok: true, credentials: null })
    })

    it('returns the channel, who entered the credentials and when, and that the last read succeeded, but never the key', async () => {
      const app = await buildApp()

      const response = await credentials(app)

      expect(response).toEqual({
        ok: true,
        credentials: { channelId: CHANNEL_ID, updatedBy: 'someone@example.com', updatedAt: inQuebecTime(ENTERED.updatedAt), error: null },
      })
      expect(JSON.stringify(response)).not.toContain('the-key')
    })

    it('reads YouTube too, sharing what GET /api/video reads, and says why the last read failed until one succeeds', async () => {
      const app = await buildApp()
      await video(app)
      await credentials(app)
      expect(newestUpload).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(MINUTE)
      newestUpload.mockRejectedValue(new YouTubeKeyRefused('YouTube refused this key: API key expired.'))
      expect((await credentials(app)).credentials.error).toBe('YouTube refused this key: API key expired.')
      expect((await video(app)).body).toEqual({ video: { id: VIDEO } })
      expect(newestUpload).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(MINUTE)
      newestUpload.mockResolvedValue(VIDEO)
      expect((await credentials(app)).credentials.error).toBeNull()
    })

    it('saves the credentials, trimmed, with the uploads of the channel, once YouTube accepts the key and finds the channel', async () => {
      entered = null
      const app = await buildApp()

      const response = await put(app, { channelId: ` ${OTHER_CHANNEL_ID} `, apiKey: ' new-key ' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ok: true,
        credentials: { channelId: OTHER_CHANNEL_ID, updatedBy: 'admin@example.com', updatedAt: '2026-10-01T08:00:00-04:00', error: null },
      })
      expect(channel).toHaveBeenCalledExactlyOnceWith('new-key', OTHER_CHANNEL_ID)
      expect(save).toHaveBeenCalledExactlyOnceWith({
        channelId: OTHER_CHANNEL_ID,
        apiKey: 'new-key',
        uploadsPlaylistId: 'UU_other-channel-0123456',
        updatedBy: 'admin@example.com',
        updatedAt: new Date(NOW),
      })
    })

    it("reads the video right away, and doesn't read it again within the minute", async () => {
      entered = null
      const app = await buildApp()
      expect((await video(app)).status).toBe(502)

      await put(app, { channelId: OTHER_CHANNEL_ID, apiKey: 'new-key' })
      expect(newestUpload).toHaveBeenCalledExactlyOnceWith('new-key', 'UU_other-channel-0123456')

      expect((await video(app)).body).toEqual({ video: { id: VIDEO } })
      expect(newestUpload).toHaveBeenCalledOnce()
    })

    it('says why the read it makes right away failed, though the credentials are saved', async () => {
      newestUpload.mockRejectedValue(new Error('YouTube cannot be reached: fetch failed'))
      const app = await buildApp()

      const response = await put(app, { channelId: OTHER_CHANNEL_ID, apiKey: 'new-key' })

      expect(response.statusCode).toBe(200)
      expect(response.json().credentials.error).toBe('YouTube cannot be reached: fetch failed')
      expect(save).toHaveBeenCalledOnce()
    })

    it('goes on with the video it read before with a new key for the same channel, and starts over with another channel', async () => {
      const app = await buildApp()
      await video(app)
      newestUpload.mockRejectedValue(new Error('YouTube cannot be reached: fetch failed'))

      await put(app, { channelId: CHANNEL_ID, apiKey: 'new-key' })
      expect((await video(app)).body).toEqual({ video: { id: VIDEO } })

      await put(app, { channelId: OTHER_CHANNEL_ID, apiKey: 'new-key' })
      expect((await video(app)).status).toBe(502)
    })

    it("doesn't show what an older read gives once another channel was saved, even if it ends after", async () => {
      const app = await buildApp()
      let endOldRead: ((id: string) => void) | undefined
      newestUpload.mockImplementationOnce(() => new Promise((resolve) => (endOldRead = resolve)))
      const old = video(app)
      await vi.waitFor(() => expect(endOldRead).toBeDefined())

      newestUpload.mockRejectedValue(new Error('YouTube cannot be reached: fetch failed'))
      await put(app, { channelId: OTHER_CHANNEL_ID, apiKey: 'new-key' })
      endOldRead!(VIDEO)
      // The request that started it gets it.
      expect((await old).body).toEqual({ video: { id: VIDEO } })

      expect((await video(app)).status).toBe(502)
      expect((await credentials(app)).credentials.error).toBe('YouTube cannot be reached: fetch failed')
    })

    it('ignores credentials that a request loaded before newer ones were saved', async () => {
      const app = await buildApp()
      await video(app)
      let resolveStale: ((credentials: YouTubeCredentials) => void) | undefined
      load.mockImplementationOnce(() => new Promise((resolve) => (resolveStale = resolve)))
      const stale = credentials(app)

      await put(app, { channelId: OTHER_CHANNEL_ID, apiKey: 'new-key' })
      await vi.waitFor(() => expect(resolveStale).toBeDefined())
      resolveStale!(ENTERED)

      expect((await stale).credentials.channelId).toBe(OTHER_CHANNEL_ID)
      await video(app)
      expect(newestUpload).toHaveBeenLastCalledWith('new-key', 'UU_other-channel-0123456')
      expect(newestUpload).toHaveBeenCalledTimes(2)
    })

    it('keeps the key out of the logs and the response when the database fails to save it', async () => {
      const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
      const query = 'insert into "youtube_credentials" ("id", "channel_id", "api_key") values (default, $1, $2)'
      save.mockRejectedValueOnce(new DrizzleQueryError(query, [CHANNEL_ID, 'new-key'], cause))
      const logs: string[] = []
      const app = await buildApp(logs)

      const response = await put(app, { channelId: CHANNEL_ID, apiKey: 'new-key' })

      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
      expect(logs.join('')).toContain('57P01')
      expect(logs.join('')).not.toContain('new-key')
    })

    it('checks credentials with YouTube without saving them', async () => {
      const app = await buildApp()
      await video(app)

      const response = await send(app, 'POST', `${URL}/check`, { channelId: ` ${OTHER_CHANNEL_ID} `, apiKey: ' new-key ' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(channel).toHaveBeenCalledExactlyOnceWith('new-key', OTHER_CHANNEL_ID)
      expect(save).not.toHaveBeenCalled()
      vi.advanceTimersByTime(MINUTE)
      await video(app)
      expect(newestUpload).toHaveBeenLastCalledWith('the-key', ENTERED.uploadsPlaylistId)
    })

    // Saving them checks them too, the same way.
    describe.each([
      ['PUT', URL],
      ['POST', `${URL}/check`],
    ] as const)('%s %s', (method, url) => {
      const sendTo = (app: App, body: unknown) => send(app, method, url, body)
      const NOT_A_CHANNEL = "`channelId`: Not a YouTube channel's id, which is UC then 22 letters, digits, - or _"

      it.each([
        ['the channel id is missing', { apiKey: 'key' }, '`channelId`: Invalid input: expected string, received undefined'],
        ['the key is missing', { channelId: CHANNEL_ID }, '`apiKey`: Invalid input: expected string, received undefined'],
        ['the channel id is blank', { channelId: '  ', apiKey: 'key' }, NOT_A_CHANNEL],
        ['the channel id is a handle', { channelId: '@parkingradio', apiKey: 'key' }, NOT_A_CHANNEL],
        ['the channel id is a link', { channelId: `https://www.youtube.com/channel/${CHANNEL_ID}`, apiKey: 'key' }, NOT_A_CHANNEL],
        ['the channel id names two channels', { channelId: `${CHANNEL_ID},${CHANNEL_ID}`, apiKey: 'key' }, NOT_A_CHANNEL],
        ['the key is blank', { channelId: CHANNEL_ID, apiKey: ' ' }, '`apiKey`: Too small: expected string to have >=1 characters'],
        ['the key is too long', { channelId: CHANNEL_ID, apiKey: 'x'.repeat(201) }, '`apiKey`: Too big: expected string to have <=200 characters'],
        ['the body is null', null, 'body: Invalid input: expected object, received null'],
      ])('responds 400 when %s, saying why, without asking YouTube', async (_, body, error) => {
        const app = await buildApp()

        const response = await sendTo(app, body)

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
        expect(channel).not.toHaveBeenCalled()
        expect(save).not.toHaveBeenCalled()
      })

      it('responds 400, saying why, and keeps the credentials it had, when YouTube refuses the key', async () => {
        channel.mockRejectedValue(new YouTubeKeyRefused('YouTube refused this key: API key not valid. Please pass a valid API key.'))
        const app = await buildApp()

        const response = await sendTo(app, { channelId: CHANNEL_ID, apiKey: 'wrong-key' })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'YouTube refused this key: API key not valid. Please pass a valid API key.' })
        expect(save).not.toHaveBeenCalled()
      })

      it('responds 400 when YouTube finds no such channel', async () => {
        channel.mockResolvedValue(null)
        const app = await buildApp()

        const response = await sendTo(app, { channelId: OTHER_CHANNEL_ID, apiKey: 'key' })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'YouTube finds no such channel' })
        expect(save).not.toHaveBeenCalled()
      })

      it("responds 502 when YouTube can't be reached, or refuses requests for now", async () => {
        channel.mockRejectedValue(new Error('YouTube refuses requests for now: Quota exceeded.'))
        const app = await buildApp()

        const response = await sendTo(app, { channelId: CHANNEL_ID, apiKey: 'key' })

        expect(response.statusCode).toBe(502)
        expect(response.json()).toEqual({ ok: false, error: 'The credentials cannot be checked with YouTube: YouTube refuses requests for now: Quota exceeded.' })
        expect(save).not.toHaveBeenCalled()
      })
    })
  })
})
