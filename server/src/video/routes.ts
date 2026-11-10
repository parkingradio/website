import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { errorMessage } from '../api/errors.js'
import { ApiError, Credential, Ok, Timestamp, zodRoutes } from '../api/schemas.js'
import { cached } from '../core/cache.js'
import { YOUTUBE_VIDEO_ID } from '../sessions/links.js'
import type { YouTubeCredentials, YouTubeCredentialsStore } from './credentials.js'
import { YouTubeKeyRefused } from './youtube.js'
import type { YouTube } from './youtube.js'

// The video the site shows, read from YouTube (see docs/design/server/video.md).

// What `GET /api/video` responds. Like `GET /api/radio`, it has no `ok`.
const Video = z
  .object({
    video: z.object({ id: z.string().regex(YOUTUBE_VIDEO_ID).meta({ description: "The video's id on YouTube" }) }).nullable(),
  })
  .meta({ id: 'Video' })
// The video shown, or null when there's none.
type ShownVideo = z.infer<typeof Video>['video']

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const CredentialsRequest = z.object({
  channelId: z
    .string()
    .trim()
    .regex(CHANNEL_ID, "Not a YouTube channel's id, which is UC then 22 letters, digits, - or _")
    .meta({ description: "The channel's id, trimmed: UC then 22 letters, digits, - or _" }),
  apiKey: Credential,
})

// What `GET` and `PUT /api/admin/video/credentials` respond. The key is never sent back.
const VideoCredentials = z
  .object({
    ok: z.literal(true),
    credentials: z
      .object({
        channelId: z.string(),
        updatedBy: z.string(),
        updatedAt: Timestamp,
        error: z.string().nullable().meta({ description: 'Why the last read of YouTube failed, or null' }),
      })
      .nullable(),
  })
  .meta({ id: 'VideoCredentials' })
type VideoCredentials = z.infer<typeof VideoCredentials>

// YouTube is read at most this often, whether the last read succeeded or not, and only when the video is asked for.
const READ_INTERVAL_MS = 60 * 1000
const VIDEO_UNAVAILABLE: ApiError = { ok: false, error: 'The video is unavailable right now' }

// What was read from YouTube through a set of credentials: the video as last read successfully, undefined until one is,
// and why the last read failed, if it did.
type Read = { video: ShownVideo | undefined; error: string | null }

// Reads the video through `credentials`, keeping what it read.
type Reader = {
  credentials: YouTubeCredentials
  last(): Read
  read(): Promise<Read>
}

type VideoOptions = {
  youtube: YouTube
  credentials: YouTubeCredentialsStore
}

function sameCredentials(a: YouTubeCredentials, b: YouTubeCredentials): boolean {
  return a.channelId === b.channelId && a.apiKey === b.apiKey
}

function credentialsResponse(credentials: YouTubeCredentials | null, error: string | null): VideoCredentials {
  return {
    ok: true,
    credentials: credentials && {
      channelId: credentials.channelId,
      updatedBy: credentials.updatedBy,
      updatedAt: credentials.updatedAt.toISOString(),
      error,
    },
  }
}

export async function videoRoutes(app: FastifyInstance, { youtube, credentials: store }: VideoOptions) {
  // The key is a value of the query that saves it, which the app's error handler keeps out of the logs and responses (see
  // `useApiErrors`).
  const api = zodRoutes(app)

  // Starts with `video`, as if it had been read, until it reads one itself.
  function readerFor(credentials: YouTubeCredentials, video: ShownVideo | undefined): Reader {
    const refresh = cached(
      async () => {
        try {
          return await youtube.newestUpload(credentials.apiKey, credentials.uploadsPlaylistId)
        } catch (error) {
          app.log.error(error, 'Failed to read the video from YouTube')
          throw error
        }
      },
      (_, startedAt) => startedAt + READ_INTERVAL_MS,
    )
    let last: Read = { video, error: null }
    return {
      credentials,
      last: () => last,
      async read() {
        try {
          const id = await refresh()
          last = { video: id === null ? null : { id }, error: null }
        } catch (reason) {
          last = { ...last, error: errorMessage(reason) }
        }
        return last
      },
    }
  }

  // The reader for the credentials that were entered last, replaced whenever they change. With another key for the same
  // channel, the video goes on until the new one reads it, while with another channel, it starts over.
  let reader: Reader | null = null

  function readerAfter(credentials: YouTubeCredentials): Reader {
    const carried = reader?.credentials.channelId === credentials.channelId ? reader.last().video : undefined
    return readerFor(credentials, carried)
  }

  // The credentials that were entered, or null until they are, and what was read through them, read again unless it was
  // in the last minute. They're loaded every time, so that every server picks up a change. Credentials loaded before newer
  // ones were saved, by a request that was already under way, are ignored.
  async function current(): Promise<{ credentials: YouTubeCredentials; read: Read } | null> {
    const loaded = await store.load()
    if (!loaded) return null
    if (!reader || (!sameCredentials(reader.credentials, loaded) && reader.credentials.updatedAt <= loaded.updatedAt)) {
      reader = readerAfter(loaded)
    }
    const credentials = reader.credentials.updatedAt > loaded.updatedAt ? reader.credentials : loaded
    return { credentials, read: await reader.read() }
  }

  api.get(
    '/api/video',
    {
      schema: {
        summary: 'The video the site shows now',
        tags: ['Video'],
        response: { 200: Video, 502: ApiError },
      },
    },
    async (request, reply) => {
      let video: ShownVideo | undefined
      try {
        video = (await current())?.read.video
      } catch (error) {
        request.log.error(error, 'Failed to load the YouTube credentials from the database')
        return reply.status(502).send(VIDEO_UNAVAILABLE)
      }
      if (video === undefined) return reply.status(502).send(VIDEO_UNAVAILABLE)
      return { video }
    },
  )

  api.get(
    '/api/admin/video/credentials',
    {
      config: { admin: true, tool: { title: 'Voir la connexion YouTube' } },
      schema: {
        operationId: 'get_youtube_credentials',
        summary: 'The YouTube channel the site reads its video from, and why the last read failed, if it did',
        tags: ['Video'],
        response: { 200: VideoCredentials },
      },
    },
    async () => {
      const entered = await current()
      return credentialsResponse(entered?.credentials ?? null, entered?.read.error ?? null)
    },
  )

  // The uploads of the channel, once YouTube accepts the key and finds the channel, or the error to respond with.
  async function checked({ channelId, apiKey }: z.infer<typeof CredentialsRequest>): Promise<{ uploadsPlaylistId: string } | { status: 400 | 502; error: string }> {
    try {
      const channel = await youtube.channel(apiKey, channelId)
      return channel ?? { status: 400, error: 'YouTube finds no such channel' }
    } catch (error) {
      if (error instanceof YouTubeKeyRefused) return { status: 400, error: error.message }
      app.log.error(error, 'Failed to check YouTube credentials')
      return { status: 502, error: `The credentials cannot be checked with YouTube: ${errorMessage(error)}` }
    }
  }

  api.post(
    '/api/admin/video/credentials/check',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Whether YouTube accepts a key and finds a channel, without saving them',
        tags: ['Video'],
        body: CredentialsRequest,
        response: { 200: Ok, 400: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const channel = await checked(request.body)
      if ('error' in channel) return reply.status(channel.status).send({ ok: false, error: channel.error })
      return { ok: true as const }
    },
  )

  api.put(
    '/api/admin/video/credentials',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Entering the YouTube channel and the key it is read with',
        tags: ['Video'],
        body: CredentialsRequest,
        response: { 200: VideoCredentials, 400: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      // They're checked again, even if they were just checked, so that a typo can't leave the site without a video.
      const channel = await checked(request.body)
      if ('error' in channel) return reply.status(channel.status).send({ ok: false, error: channel.error })

      const saved: YouTubeCredentials = { ...request.body, ...channel, updatedBy: request.user!.email, updatedAt: new Date() }
      await store.save(saved)
      request.log.info({ channelId: saved.channelId, by: saved.updatedBy }, 'Changed the YouTube credentials of the video')
      reader = readerAfter(saved)
      const { error } = await reader.read()
      return credentialsResponse(saved, error)
    },
  )
}
