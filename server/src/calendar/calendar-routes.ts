import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Day, addDays, dayStart, daysBetween, queryDay, toNotBeforeFrom } from '../api/formats.js'
import { Timestamp, firstIssue, zodRoutes } from '../api/schemas.js'
import { Status } from '../sessions/fields.js'
import { SessionBody, sessionBody } from '../sessions/routes.js'
import type { SessionsStore } from '../sessions/store.js'
import { compareStrings, conflicts, takesSomeOf, thingOrder } from './conflicts.js'
import type { OccupationThing, Thing } from './conflicts.js'
import type { CalendarFeedsStore } from './feeds.js'
import type { CalendarReads } from './reads.js'
import { Feed, feedBody } from './feeds-routes.js'
import { calendarInputs } from './inputs.js'
import { unprotectedSessions } from './protected-time.js'

// The studio's calendar: what takes it over a range of days, and what needs settling (see "The calendar" in
// docs/design/server/calendar.md).

const MAX_DAYS = 400

const CalendarQuery = z
  .object({
    from: queryDay('from', 'The first day, in Québec, e.g. "2026-11-01"'),
    to: queryDay('to', `The last day, in Québec, included, e.g. "2026-11-30": at most ${MAX_DAYS} days from \`from\`, both included`),
  })
  .refine(...toNotBeforeFrom)
  .refine(({ from, to }) => daysBetween(from, to) < MAX_DAYS, `The calendar has at most ${MAX_DAYS} days, \`from\` and \`to\` included`)

const Occupation = z
  .object({
    feedId: z.string().meta({ description: "The id of the feed it's read from, one of `feeds`" }),
    start: Timestamp,
    end: Timestamp,
    wholeDay: z.boolean().meta({ description: 'Whether it takes whole days' }),
    title: z.string().meta({ description: 'Its title, empty when it has none' }),
  })
  .meta({ id: 'CalendarOccupation' })

const AvailableStretch = z.object({ start: Timestamp, end: Timestamp }).meta({ id: 'CalendarAvailableStretch' })

const UnprotectedSession = z
  .object({ ...SessionBody.pick({ id: true, title: true }).shape, start: Timestamp, end: Timestamp })
  .meta({ id: 'CalendarUnprotectedSession' })

const Thing = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('session'), ...SessionBody.pick({ id: true, title: true }).shape, start: Timestamp, end: Timestamp, status: Status }),
    z.object({ kind: z.literal('occupation'), ...Occupation.shape }),
  ])
  .meta({ id: 'CalendarThing' })

const Conflict = z
  .object({
    start: Timestamp.meta({ description: 'When its two things start to overlap' }),
    end: Timestamp.meta({ description: 'When its two things stop overlapping' }),
    things: z.tuple([Thing, Thing]).meta({ description: 'The two things that overlap, in their order' }),
  })
  .meta({ id: 'CalendarConflict' })

const CalendarResponse = z.object({
  ok: z.literal(true),
  today: Day.meta({ description: 'The day the conflicts, the sessions outside protected time and the available time are counted from: today, in Québec' }),
  feeds: z.array(Feed).meta({ description: 'Every feed, in the order they were added, with when each was last read, and why that failed' }),
  sessions: z.array(SessionBody).meta({ description: 'The sessions with a start that take some of the days, whatever their status, by start' }),
  occupations: z.array(Occupation).meta({ description: 'The occupations that take some of the days, by start, then end' }),
  availability: z.array(AvailableStretch).meta({
    description:
      "The available time that takes some of the days, stretch by stretch, by start: the protected time of the next 365 days, from 00:00 today, that no session that isn't cancelled, nor occupation, takes",
  }),
  conflicts: z.array(Conflict).meta({ description: 'The conflicts of the next 365 days, from today, whatever the days asked for' }),
  unprotectedSessions: z
    .array(UnprotectedSession)
    .meta({ description: 'The sessions outside protected time, of the next 365 days, from today, by start, whatever the days asked for' }),
  undatedSessions: z
    .array(SessionBody)
    .meta({ description: "The sessions without a start that aren't cancelled, the most recently added first, whatever the days asked for" }),
})

const timesBody = ({ start, end }: { start: Date; end: Date }) => ({ start: start.toISOString(), end: end.toISOString() })
const occupationBody = ({ feedId, start, end, wholeDay, title }: OccupationThing) => ({ feedId, ...timesBody({ start, end }), wholeDay, title })

function thingBody(thing: Thing): z.infer<typeof Thing> {
  if (thing.kind === 'occupation') return { kind: thing.kind, ...occupationBody(thing) }
  const { kind, id, title, start, end, status } = thing
  return { kind, id, title, start: start.toISOString(), end: end.toISOString(), status }
}

type Options = { feeds: CalendarFeedsStore; reads: CalendarReads; sessions: SessionsStore }

export async function adminCalendarRoutes(app: FastifyInstance, { feeds, reads, sessions }: Options) {
  const api = zodRoutes(app)
  // The messages of its query's schema are whole sentences, which are sent as they are.
  app.setSchemaErrorFormatter(firstIssue)

  api.get(
    '/api/admin/calendar',
    {
      config: { admin: true, tool: { title: 'Voir le calendrier' } },
      schema: {
        operationId: 'get_calendar',
        summary:
          'What takes the studio over the days from `from` to `to`, both included, in Québec: sessions and occupations, its available time, and the calendar feeds that occupations and holds are read from, with their status, and, whatever the days, the conflicts and the sessions outside protected time of the next 365 days, and the sessions without a date',
        tags: ['Calendar'],
        querystring: CalendarQuery,
        response: { 200: CalendarResponse },
      },
    },
    async (request) => {
      const { from, to } = request.query
      const range = { from: dayStart(from), to: dayStart(addDays(to, 1)) }
      // The same instant for today and for whether sessions have ended, so that they can't disagree around midnight.
      const now = new Date()
      const { today, window, withReads, occupations, holds, given, counted, available } = await calendarInputs({ feeds, reads, sessions }, { now, range })
      const inRange = takesSomeOf(range)

      const sessionsInRange = given
        .filter((row) => row.startAt !== null)
        .sort((a, b) => a.startAt!.getTime() - b.startAt!.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || compareStrings(a.id, b.id))
      const undated = given
        .filter((row) => row.startAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || compareStrings(a.id, b.id))
      const found = conflicts(counted, occupations, window)
      const unprotected = unprotectedSessions(counted, holds, { window, now })

      return {
        ok: true as const,
        today,
        feeds: withReads.map(({ feed, read }) => feedBody(feed, read)),
        sessions: sessionsInRange.map(sessionBody),
        occupations: occupations.filter(inRange).sort(thingOrder).map(occupationBody),
        availability: available.filter(inRange).map(timesBody),
        conflicts: found.map(({ start, end, things: [first, second] }) => ({
          ...timesBody({ start, end }),
          things: [thingBody(first), thingBody(second)] as [z.infer<typeof Thing>, z.infer<typeof Thing>],
        })),
        unprotectedSessions: unprotected.map(({ id, title, start, end }) => ({ id, title, ...timesBody({ start, end }) })),
        undatedSessions: undated.map(sessionBody),
      }
    },
  )
}
