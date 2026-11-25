import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { UNAUTHORIZED } from '../admins/auth.js'
import { ApiError, zodRoutes } from '../api/schemas.js'
import type { CalendarFeedsStore } from '../calendar/feeds.js'
import type { CalendarReads } from '../calendar/reads.js'
import { occupationsCalendar, sessionsCalendar } from './calendars.js'
import type { FeedWithRead } from './calendars.js'
import type { SubscriptionsStore } from './store.js'

// Admins' own calendar feeds, and the token in their links (see docs/design/server/subscriptions.md). The feeds aren't
// part of the API, since they aren't JSON: like /calendar.ics, their routes have no schema, so they aren't in
// openapi.json, nor tools of the MCP server. The token's endpoints are in openapi.json, but aren't tools either, since the
// token is a secret.

// Every response of the feeds, whether they succeed or fail, unexpectedly too, is never kept, since what they give is
// private, and a failure mustn't be kept in its place. In onSend, since the error handler removes the headers set before.
const noStore = async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.header('cache-control', 'no-store')
}

const NOT_AN_ADMINS_TOKEN: ApiError = { ok: false, error: "The link's token isn't an admin's" }
const NOT_READ_YET: ApiError = { ok: false, error: "The calendar feeds haven't all been read yet, with their links, since the server started" }
const SubscriptionToken = z
  .object({ ok: z.literal(true), token: z.string().meta({ description: "The token of the admin's calendar feeds' links" }) })
  .meta({ id: 'SubscriptionToken' })
// What the token's endpoints respond: also 401 when the admin is revoked after their session was checked, since their
// session has then ended.
const TOKEN_RESPONSE = { 200: SubscriptionToken, 401: ApiError }

type Options = {
  store: SubscriptionsStore
  feeds: CalendarFeedsStore
  reads: CalendarReads
  // Where the site is, which the feeds' events link to.
  siteOrigin: string
  // The server's environment, which the feeds' names have outside production.
  environment: string
}

export async function subscriptionsRoutes(app: FastifyInstance, { store, feeds, reads, siteOrigin, environment }: Options) {
  // Whether the request's `token` is an admin's, or else refuses it, before anything else is read. Its other query
  // parameters are ignored.
  async function authorized(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const { token } = request.query as Record<string, string | string[] | undefined>
    if (typeof token === 'string' && (await store.isToken(token))) return true
    await reply.code(403).send(NOT_AN_ADMINS_TOKEN)
    return false
  }

  const sendCalendar = (reply: FastifyReply, body: string) => reply.type('text/calendar; charset=utf-8').send(body)

  app.get('/sessions.ics', { onSend: noStore }, async (request, reply) => {
    if (!(await authorized(request, reply))) return reply
    const now = new Date()
    const rows = await store.sessions(now)
    return sendCalendar(reply, sessionsCalendar(rows, { siteOrigin, environment, now }))
  })

  app.get('/occupations.ics', { onSend: noStore }, async (request, reply) => {
    if (!(await authorized(request, reply))) return reply
    // What was read from each feed is taken once, as GET /api/admin/calendar does, so that whether it was read and what it
    // gives are from the same read. Until a read of each one, with the link it has, has ended since the server started,
    // whether it failed or not, the feed fails, so that calendar apps keep what they had rather than lose the occupations
    // of the feeds that haven't been read yet.
    const withReads: FeedWithRead[] = []
    for (const feed of await feeds.list()) {
      const read = reads.of(feed)
      if (!read) return reply.code(503).send(NOT_READ_YET)
      withReads.push({ feed, read })
    }
    return sendCalendar(reply, occupationsCalendar(withReads, { siteOrigin, environment, now: new Date() }))
  })

  const api = zodRoutes(app)

  api.get(
    '/api/admin/subscription-token',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "The token of the admin's own calendar feeds' links, which they get the first time they ask for it",
        tags: ['Subscriptions'],
        response: TOKEN_RESPONSE,
      },
    },
    async (request, reply) => {
      const token = await store.token(request.user!.id)
      return token === null ? reply.code(401).send(UNAUTHORIZED) : { ok: true as const, token }
    },
  )

  api.post(
    '/api/admin/subscription-token',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Replaces the token of the admin's own calendar feeds' links, which makes the previous links stop working",
        tags: ['Subscriptions'],
        response: TOKEN_RESPONSE,
      },
    },
    async (request, reply) => {
      const token = await store.replace(request.user!.id)
      if (token === null) return reply.code(401).send(UNAUTHORIZED)
      request.log.info({ by: request.user!.email }, "Replaced an admin's subscription token")
      return { ok: true as const, token }
    },
  )
}
