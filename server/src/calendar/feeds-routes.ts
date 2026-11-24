import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ApiError, ById, Ok, Timestamp, Total, changesTo, objectError, zodRoutes } from '../api/schemas.js'
import type { CalendarFeedsStore, StoredFeed } from './feeds.js'
import { LinkTaken } from './feeds.js'
import { FeedReadError, ReadAborted } from './fetch.js'
import { FeedName, Link } from './fields.js'
import type { CalendarReads, FeedRead, FeedToRead, SuccessfulRead } from './reads.js'

// The calendar feeds that the studio's occupations are read from (see docs/design/server/calendar.md). Their links are
// secrets, which only the admin pages get: they're never logged, since requests' bodies never are, and the errors of
// reading a link are the server's own (see fetch.ts), and the MCP server's tools never give them (see mcp/tools.ts).

export const Feed = z
  .object({
    id: z.string(),
    name: z.string(),
    link: z.string().meta({ description: 'Its link, as the server keeps it' }),
    createdBy: z.string().meta({ description: 'The email of the admin who added it' }),
    createdAt: Timestamp,
    updatedBy: z.string().nullable().meta({ description: 'The email of the admin who last changed it, or null until it is changed' }),
    updatedAt: Timestamp.nullable().meta({ description: 'When it was last changed, or null until it is' }),
    readAt: Timestamp.nullable().meta({ description: 'When it was last read successfully, or null until then' }),
    error: z.string().nullable().meta({ description: 'Why its last read failed, or null when it succeeded, or until it is read' }),
  })
  .meta({ id: 'CalendarFeed' })

const FEED_FIELDS = { name: FeedName, link: Link }
const NewFeed = z.strictObject(FEED_FIELDS, { error: objectError('The feed must be an object with its name and link') })
const FeedChanges = changesTo(FEED_FIELDS)

const NO_SUCH_FEED: ApiError = { ok: false, error: 'No such feed' }

const linkTaken = (feed: Pick<StoredFeed, 'name'> | null): ApiError => ({
  ok: false,
  error: feed ? `The feed "${feed.name}" already has this link` : 'Another feed already has this link',
})

// A feed, as the endpoints give it, with `read`, what was read from it as it is now, if anything (see `CalendarReads.of`).
export function feedBody(
  { id, name, link, createdBy, createdAt, updatedBy, updatedAt }: StoredFeed,
  read: FeedRead | undefined,
): z.infer<typeof Feed> {
  return {
    id,
    name,
    link,
    createdBy,
    createdAt: createdAt.toISOString(),
    updatedBy,
    updatedAt: updatedAt?.toISOString() ?? null,
    readAt: read?.readAt?.toISOString() ?? null,
    error: read?.error ?? null,
  }
}

type Options = { feeds: CalendarFeedsStore; reads: CalendarReads }

export async function calendarFeedsRoutes(app: FastifyInstance, { feeds, reads }: Options) {
  const api = zodRoutes(app)
  const feed = (stored: StoredFeed) => feedBody(stored, reads.of(stored))

  // Reads the link of a feed that's added or changed, or says why it can't be read.
  async function readFeed(toRead: FeedToRead): Promise<SuccessfulRead | { status: 400 | 502; error: ApiError }> {
    try {
      return await reads.read(toRead)
    } catch (error) {
      if (error instanceof FeedReadError) return { status: error.status, error: { ok: false, error: error.message } }
      if (error instanceof ReadAborted) return { status: 502, error: { ok: false, error: 'The server is shutting down' } }
      throw error
    }
  }

  api.get(
    '/api/admin/calendar/feeds',
    {
      config: { admin: true, tool: { title: 'Voir les calendriers externes' } },
      schema: {
        operationId: 'list_calendar_feeds',
        summary: "Every calendar feed that the studio's occupations are read from, in the order they were added",
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
      const { name, link } = request.body
      const taken = await feeds.withLink(link)
      if (taken) return reply.status(409).send(linkTaken(taken))
      const read = await readFeed({ name, link })
      if ('status' in read) return reply.status(read.status).send(read.error)
      let added: StoredFeed
      try {
        added = await feeds.add({ name, link, createdBy: request.user!.email })
      } catch (error) {
        if (error instanceof LinkTaken) return reply.status(409).send(linkTaken(error.feed))
        throw error
      }
      reads.added(added.id, read)
      request.log.info({ feed: added.id, name, by: added.createdBy }, 'Added a calendar feed')
      return { ok: true as const, feed: feed(added) }
    },
  )

  api.patch(
    '/api/admin/calendar/feeds/:id',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Changes a calendar feed's name or link, once a new link gives a calendar",
        tags: ['Calendar'],
        // Any id, so that one that isn't a feed's gets a 404.
        params: ById,
        body: FeedChanges,
        response: { 200: z.object({ ok: z.literal(true), feed: Feed }), 400: ApiError, 404: ApiError, 409: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const changes = request.body
      const current = await feeds.get(request.params.id)
      if (!current) return reply.status(404).send(NO_SUCH_FEED)
      // Only a new link is read, and can be another feed's: the feed's own, e.g. as a webcal link, isn't new.
      const newLink = changes.link !== undefined && changes.link !== current.link ? changes.link : null
      let read: SuccessfulRead | undefined
      if (newLink !== null) {
        const taken = await feeds.withLink(newLink)
        if (taken) return reply.status(409).send(linkTaken(taken))
        const result = await readFeed({ id: current.id, name: changes.name ?? current.name, link: newLink })
        if ('status' in result) return reply.status(result.status).send(result.error)
        read = result
      }
      let updated: StoredFeed | null
      try {
        updated = await feeds.update(current.id, changes, request.user!.email)
      } catch (error) {
        if (error instanceof LinkTaken) return reply.status(409).send(linkTaken(error.feed))
        throw error
      }
      // Removed while its link was read.
      if (!updated) return reply.status(404).send(NO_SUCH_FEED)
      reads.changed(updated.id, updated.link, read)
      request.log.info({ feed: updated.id, name: updated.name, newLink: newLink !== null, by: updated.updatedBy }, 'Changed a calendar feed')
      return { ok: true as const, feed: feed(updated) }
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
