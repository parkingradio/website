import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ApiError, ById, Ok, Timestamp, Total, objectError, zodRoutes } from '../api/schemas.js'
import type { CalendarFeedsStore, StoredFeed } from './feeds.js'
import { LinkTaken } from './feeds.js'
import { FeedReadError, ReadAborted } from './fetch.js'
import { FeedKind, FeedName, Link } from './fields.js'
import type { CalendarReads } from './reads.js'

// The calendar feeds that the studio's occupations and quiet time are read from (see docs/design/server/calendar.md).
// Their links are secrets, which no response has, and which aren't logged: requests' bodies never are, and the errors
// of reading a link are the server's own (see fetch.ts).

const Feed = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: FeedKind,
    createdBy: z.string().meta({ description: 'The email of the admin who added it' }),
    createdAt: Timestamp,
    readAt: Timestamp.nullable().meta({ description: 'When it was last read successfully, or null until then' }),
    error: z.string().nullable().meta({ description: 'Why its last read failed, or null when it succeeded, or until it is read' }),
  })
  .meta({ id: 'CalendarFeed' })

const NewFeed = z.strictObject({ name: FeedName, kind: FeedKind, link: Link }, { error: objectError('The feed must be an object with its name, kind and link') })

const NO_SUCH_FEED: ApiError = { ok: false, error: 'No such feed' }

const linkTaken = (feed: Pick<StoredFeed, 'name'> | null): ApiError => ({
  ok: false,
  error: feed ? `The feed "${feed.name}" already has this link` : 'Another feed already has this link',
})

type Options = { feeds: CalendarFeedsStore; reads: CalendarReads }

export async function calendarFeedsRoutes(app: FastifyInstance, { feeds, reads }: Options) {
  const api = zodRoutes(app)

  function feed({ id, name, kind, createdBy, createdAt }: StoredFeed): z.infer<typeof Feed> {
    const read = reads.of(id)
    return { id, name, kind, createdBy, createdAt: createdAt.toISOString(), readAt: read?.readAt?.toISOString() ?? null, error: read?.error ?? null }
  }

  api.get(
    '/api/admin/calendar/feeds',
    {
      config: { admin: true, tool: { title: 'Voir les calendriers externes' } },
      schema: {
        operationId: 'list_calendar_feeds',
        summary: "Every calendar feed that the studio's occupations and quiet time are read from, in the order they were added, without their links",
        tags: ['Calendar'],
        response: { 200: z.object({ ok: z.literal(true), total: Total, feeds: z.array(Feed) }) },
      },
    },
    async () => {
      const listed = (await feeds.list()).map(feed)
      return { ok: true as const, total: listed.length, feeds: listed }
    },
  )

  api.post(
    '/api/admin/calendar/feeds',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Adds a calendar feed, once its link gives a calendar',
        tags: ['Calendar'],
        body: NewFeed,
        response: { 200: z.object({ ok: z.literal(true), feed: Feed }), 400: ApiError, 409: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const { name, kind, link } = request.body
      const taken = await feeds.withLink(link)
      if (taken) return reply.status(409).send(linkTaken(taken))
      let read
      try {
        read = await reads.read({ name, kind, link })
      } catch (error) {
        if (error instanceof FeedReadError) return reply.status(error.status).send({ ok: false, error: error.message })
        if (error instanceof ReadAborted) return reply.status(502).send({ ok: false, error: 'The server is shutting down' })
        throw error
      }
      let added: StoredFeed
      try {
        added = await feeds.add({ name, kind, link, createdBy: request.user!.email })
      } catch (error) {
        if (error instanceof LinkTaken) return reply.status(409).send(linkTaken(error.feed))
        throw error
      }
      reads.added(added.id, read)
      request.log.info({ feed: added.id, name, kind, by: added.createdBy }, 'Added a calendar feed')
      return { ok: true as const, feed: feed(added) }
    },
  )

  api.delete(
    '/api/admin/calendar/feeds/:id',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Removes a calendar feed, and forgets what was read from it',
        tags: ['Calendar'],
        // Any id, so that one that isn't a feed's gets a 404.
        params: ById,
        response: { 200: Ok, 404: ApiError },
      },
    },
    async (request, reply) => {
      const removed = await feeds.remove(request.params.id)
      if (!removed) return reply.status(404).send(NO_SUCH_FEED)
      reads.removed(removed)
      request.log.info({ feed: removed, by: request.user!.email }, 'Removed a calendar feed')
      return { ok: true as const }
    },
  )
}
