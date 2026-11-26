import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { UNAUTHORIZED } from '../admins/auth.js'
import { ApiError, zodRoutes } from '../api/schemas.js'
import type { CalendarFeedsStore } from '../calendar/feeds.js'
import { calendarInputs } from '../calendar/inputs.js'
import type { CalendarReads, FeedRead } from '../calendar/reads.js'
import type { SessionsStore } from '../sessions/store.js'
import { availabilityCalendar, occupationsCalendar, sessionsCalendar } from './calendars.js'
import type { AdminCalendarsStore } from './store.js'

// Admins' calendars, and the token in their links (see docs/design/server/admin-calendars.md). The calendars aren't
// part of the API, since they aren't JSON: like /calendar.ics, their routes have no schema, so they aren't in
// openapi.json, nor tools of the MCP server. The token's endpoints are in openapi.json, but aren't tools either, since the
// token is a secret.

// Every response of the calendars, whether they succeed or fail, unexpectedly too, is never kept, since what they give is
// private, and a failure mustn't be kept in its place. In onSend, since the error handler removes the headers set before.
const noStore = async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.header('cache-control', 'no-store')
}

const NOT_AN_ADMINS_TOKEN: ApiError = { ok: false, error: "The link's token isn't an admin's" }
const NOT_READ_YET: ApiError = { ok: false, error: "The calendar feeds of occupations haven't all been read yet, with their links, since the server started" }
const FEEDS_NOT_READ_YET: ApiError = { ok: false, error: "The calendar feeds haven't all been read yet, with their links, since the server started" }
// Whether something was read from the feed since the server started, with the link it has (see `CalendarReads.of`).
const isRead = <Feed>(withRead: { feed: Feed; read: FeedRead | undefined }): withRead is { feed: Feed; read: FeedRead } => withRead.read !== undefined

const IcsSubscriptionToken = z
  .object({ ok: z.literal(true), token: z.string().meta({ description: "The token of the links of the admin's calendars" }) })
  .meta({ id: 'IcsSubscriptionToken' })
// What the token's endpoints respond: also 401 when the admin is revoked after their session was checked, since their
// session has then ended.
const TOKEN_RESPONSE = { 200: IcsSubscriptionToken, 401: ApiError }

type Options = {
  store: AdminCalendarsStore
  feeds: CalendarFeedsStore
  reads: CalendarReads
  sessions: Pick<SessionsStore, 'forCalendar'>
  // Where the site is, which the calendars' events link to.
  siteOrigin: string
  // The server's environment, which the calendars' names have outside production.
  environment: string
}

export async function adminCalendarsRoutes(app: FastifyInstance, { store, feeds, reads, sessions, siteOrigin, environment }: Options) {
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
    // What was read from each `occupations` feed is taken once, as GET /api/admin/calendar does, so that whether it was
    // read and what it gives are from the same read. Until a read of each one, with the link it has, has ended since the
    // server started, whether it failed or not, the calendar fails, so that calendar apps keep what they had rather than
    // lose the occupations of the feeds that haven't been read yet. `holds` feeds don't count.
    const withReads = (await feeds.list()).filter(({ kind }) => kind === 'occupations').map((feed) => ({ feed, read: reads.of(feed) }))
    if (!withReads.every(isRead)) return reply.code(503).send(NOT_READ_YET)
    return sendCalendar(reply, occupationsCalendar(withReads, { siteOrigin, environment, now: new Date() }))
  })

  app.get('/availability.ics', { onSend: noStore }, async (request, reply) => {
    if (!(await authorized(request, reply))) return reply
    // The available time, and every feed with what was read from it, as GET /api/admin/calendar has them for the days of
    // the year ahead. Without a `holds` feed, there's none, whatever was read. Otherwise, until a read of every feed, of
    // either kind, with the link it has, has ended since the server started, the calendar fails, like /occupations.ics.
    const now = new Date()
    const { withReads, holds, available } = await calendarInputs({ feeds, reads, sessions }, { now })
    if (holds === null) return sendCalendar(reply, availabilityCalendar([], [], { siteOrigin, environment, now }))
    if (!withReads.every(isRead)) return reply.code(503).send(FEEDS_NOT_READ_YET)
    return sendCalendar(reply, availabilityCalendar(available, withReads, { siteOrigin, environment, now }))
  })

  const api = zodRoutes(app)

  api.get(
    '/api/admin/ics-subscription-token',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "The token of the links of the admin's calendars, which they get the first time they ask for it",
        tags: ["Admins' calendars"],
        response: TOKEN_RESPONSE,
      },
    },
    async (request, reply) => {
      const token = await store.token(request.user!.id)
      return token === null ? reply.code(401).send(UNAUTHORIZED) : { ok: true as const, token }
    },
  )

  api.post(
    '/api/admin/ics-subscription-token',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Replaces the token of the links of the admin's calendars, which makes the previous links stop working",
        tags: ["Admins' calendars"],
        response: TOKEN_RESPONSE,
      },
    },
    async (request, reply) => {
      const token = await store.replace(request.user!.id)
      if (token === null) return reply.code(401).send(UNAUTHORIZED)
      request.log.info({ by: request.user!.email }, "Replaced an admin's ICS subscription token")
      return { ok: true as const, token }
    },
  )
}
