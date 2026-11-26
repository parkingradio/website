import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Day, addDays, dayStart, dayWith, daysBetween, quebecDay } from '../api/formats.js'
import { Timestamp, firstIssue, zodRoutes } from '../api/schemas.js'
import { Status, after, sessionTitle } from '../sessions/fields.js'
import { SessionBody, sessionBody } from '../sessions/routes.js'
import type { SessionWithoutSets, SessionsStore } from '../sessions/store.js'
import { byStartThenEnd, compareStrings, conflicts, takesSomeOf, takingThings, thingOrder } from './conflicts.js'
import type { CalendarSession, OccupationThing, Thing } from './conflicts.js'
import type { CalendarEvent } from './events.js'
import type { CalendarFeedsStore } from './feeds.js'
import type { FeedKind } from './fields.js'
import type { CalendarReads } from './reads.js'
import { Feed, feedBody } from './feeds-routes.js'
import { freeTime, unprotectedSessions } from './protected-time.js'

// The studio's calendar: what takes it over a range of days, and what needs settling (see "The calendar" in
// docs/design/server/calendar.md).

// The days of the years 2000 to 2999, like the instants that requests send (see `EARLIEST_INSTANT` and `LATEST_INSTANT`
// in api/formats.ts).
const FIRST_DAY = '2000-01-01'
const LAST_DAY = '2999-12-31'
const MAX_DAYS = 400
// The conflicts, the sessions outside protected time and the free time are those of the days from today.
const CONFLICT_DAYS = 365

// A day of the calendar, `from` or `to`, which are days, unlike the instants of the lists of sessions and of events.
function calendarDay(name: 'from' | 'to', description: string) {
  const message = `\`${name}\` must be a single day, YYYY-MM-DD, without a time, from ${FIRST_DAY} to ${LAST_DAY}`
  return dayWith(message)
    .refine((day) => day >= FIRST_DAY && day <= LAST_DAY, message)
    .meta({ description })
}

const CalendarQuery = z
  .object({
    from: calendarDay('from', 'The first day, in Québec, e.g. "2026-11-01"'),
    to: calendarDay('to', `The last day, in Québec, included, e.g. "2026-11-30": at most ${MAX_DAYS} days from \`from\`, both included`),
  })
  .refine(({ from, to }) => to >= from, "`to` can't be before `from`")
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

// Holds have no title (see "Feeds" in docs/design/server/calendar.md).
const Hold = Occupation.omit({ title: true }).meta({ id: 'CalendarHold' })

const FreeStretch = z.object({ start: Timestamp, end: Timestamp }).meta({ id: 'CalendarFreeStretch' })

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
  today: Day.meta({ description: 'The day the conflicts and the sessions outside protected time are counted from: today, in Québec' }),
  feeds: z.array(Feed).meta({ description: 'Every feed, in the order they were added, with when each was last read, and why that failed' }),
  sessions: z.array(SessionBody).meta({ description: 'The sessions with a start that take some of the days, whatever their status, by start' }),
  occupations: z.array(Occupation).meta({ description: 'The occupations that take some of the days, by start, then end' }),
  holds: z.array(Hold).meta({ description: 'The holds that take some of the days, by start, then end' }),
  freeTime: z.array(FreeStretch).meta({
    description:
      "The free time that takes some of the days, stretch by stretch, by start: the protected time of the next 365 days, from 00:00 today, that no session that isn't cancelled, nor occupation, takes",
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
const holdBody = ({ feedId, start, end, wholeDay }: Omit<OccupationThing, 'kind'>) => ({ feedId, ...timesBody({ start, end }), wholeDay })
const occupationBody = (occupation: OccupationThing) => ({ ...holdBody(occupation), title: occupation.title })

function thingBody(thing: Thing): z.infer<typeof Thing> {
  if (thing.kind === 'occupation') return { kind: thing.kind, ...occupationBody(thing) }
  const { kind, id, title, start, end, status } = thing
  return { kind, id, title, start: start.toISOString(), end: end.toISOString(), status }
}

// A session, as the calendar counts it.
function calendarSession(row: SessionWithoutSets): CalendarSession {
  const { id, startAt: start, durationMinutes, status } = row
  return { id, title: sessionTitle(row), start, end: start && after(start, durationMinutes), status }
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
          'What takes the studio over the days from `from` to `to`, both included, in Québec: sessions and occupations, the holds that protect its time for sessions, its free time, and the calendar feeds that occupations and holds are read from, with their status, and, whatever the days, the conflicts and the sessions outside protected time of the next 365 days, and the sessions without a date',
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
      const today = quebecDay(now)
      const window = { from: dayStart(today), to: dayStart(addDays(today, CONFLICT_DAYS)) }

      const [listed, { given, others }] = await Promise.all([feeds.list(), sessions.forCalendar(range, window)])
      const inRange = takesSomeOf(range)
      // What was read from each feed is taken once, so that its status and its events are from the same read, that of the
      // feed as it is now, whose kind says what its events are. The events are in the order of the feeds, then as they
      // were read, which ties keep (see `thingOrder`).
      const withReads = listed.map((feed) => ({ feed, read: reads.of(feed) }))
      const eventsOf = <Item>(kind: FeedKind, item: (feedId: string, event: CalendarEvent) => Item) =>
        withReads.filter(({ feed }) => feed.kind === kind).flatMap(({ feed, read }) => (read?.events ?? []).map((event) => item(feed.id, event)))
      const occupations: OccupationThing[] = eventsOf('occupations', (feedId, event) => ({ kind: 'occupation' as const, feedId, ...event }))
      const holds = eventsOf('holds', (feedId, event) => ({ feedId, ...event }))

      const sessionsInRange = given
        .filter((row) => row.startAt !== null)
        .sort((a, b) => a.startAt!.getTime() - b.startAt!.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || compareStrings(a.id, b.id))
      const undated = given
        .filter((row) => row.startAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || compareStrings(a.id, b.id))
      const counted = [...given, ...others].map(calendarSession)
      const found = conflicts(counted, occupations, window)
      // Without a `holds` feed, nothing is known to be protected or not.
      const unprotected = unprotectedSessions(counted, listed.some((feed) => feed.kind === 'holds') ? holds : null, { window, now })

      return {
        ok: true as const,
        today,
        feeds: withReads.map(({ feed, read }) => feedBody(feed, read)),
        sessions: sessionsInRange.map(sessionBody),
        occupations: occupations.filter(inRange).sort(thingOrder).map(occupationBody),
        holds: holds.filter(inRange).sort(byStartThenEnd).map(holdBody),
        freeTime: freeTime(holds, takingThings(counted, occupations), window).filter(inRange).map(timesBody),
        conflicts: found.map(({ start, end, things: [first, second] }) => ({
          start: start.toISOString(),
          end: end.toISOString(),
          things: [thingBody(first), thingBody(second)] as [z.infer<typeof Thing>, z.infer<typeof Thing>],
        })),
        unprotectedSessions: unprotected.map(({ id, title, start, end }) => ({ id, title, ...timesBody({ start, end }) })),
        undatedSessions: undated.map(sessionBody),
      }
    },
  )
}
