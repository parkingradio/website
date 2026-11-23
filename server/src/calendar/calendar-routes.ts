import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Day, addDays, dayStart, dayWith, daysBetween, quebecDay } from '../api/formats.js'
import { Timestamp, firstIssue, zodRoutes } from '../api/schemas.js'
import { Status, after, sessionTitle } from '../sessions/fields.js'
import { SessionBody, sessionBody } from '../sessions/routes.js'
import type { SessionWithoutSets, SessionsStore, StoredSession } from '../sessions/store.js'
import { compareStrings, conflicts, takesSomeOf, thingOrder } from './conflicts.js'
import type { CalendarSession, EventThing, Thing } from './conflicts.js'
import type { CalendarFeedsStore } from './feeds.js'
import type { CalendarReads } from './reads.js'
import { Feed, feedBody } from './routes.js'

// The studio's calendar: what takes it over a range of days, and what needs settling (see "The calendar" in
// docs/design/server/calendar.md).

// The days of the years 2000 to 2999, like the instants that requests send (see `EARLIEST_INSTANT` and `LATEST_INSTANT`
// in api/formats.ts).
const FIRST_DAY = '2000-01-01'
const LAST_DAY = '2999-12-31'
const MAX_DAYS = 400
// The conflicts are those of the days from today.
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
    to: calendarDay('to', 'The last day, in Québec, included, e.g. "2026-11-30"'),
  })
  .refine(({ from, to }) => to >= from, "`to` can't be before `from`")
  .refine(({ from, to }) => daysBetween(from, to) < MAX_DAYS, `The calendar has at most ${MAX_DAYS} days, \`from\` and \`to\` included`)

const EventFields = {
  feed: z.string().meta({ description: "The id of the feed it's read from" }),
  start: Timestamp,
  end: Timestamp,
  wholeDay: z.boolean().meta({ description: 'Whether it takes whole days' }),
}
const Occupation = z.object({ ...EventFields, title: z.string().meta({ description: 'Its title, or empty for none' }) }).meta({ id: 'CalendarOccupation' })
const QuietTime = z.object(EventFields).meta({ id: 'CalendarQuietTime' })

const Thing = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('session'), ...SessionBody.pick({ id: true, title: true }).shape, start: Timestamp, end: Timestamp, status: Status }),
    z.object({ kind: z.literal('occupation'), ...Occupation.shape }),
    z.object({ kind: z.literal('quiet-time'), ...QuietTime.shape }),
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
  today: Day.meta({ description: 'The day the conflicts are counted from: today, in Québec' }),
  feeds: z.array(Feed).meta({ description: 'Every feed, in the order they were added, with when each was last read, and why that failed' }),
  sessions: z.array(SessionBody).meta({ description: 'The sessions with a start that take some of the days, whatever their status, by start, then createdAt, then id' }),
  occupations: z.array(Occupation).meta({ description: 'The occupations that take some of the days, in the order of things' }),
  quietTimes: z.array(QuietTime).meta({ description: 'The quiet times that take some of the days, in the order of things' }),
  conflicts: z.array(Conflict).meta({ description: 'The conflicts of the next 365 days, from today, whatever the days asked for' }),
  undatedSessions: z
    .array(SessionBody)
    .meta({ description: "The sessions without a start that aren't cancelled, the most recently added first, then by id, whatever the days asked for" }),
})

const eventBody = ({ feed, start, end, wholeDay }: EventThing) => ({ feed, start: start.toISOString(), end: end.toISOString(), wholeDay })
const occupationBody = (event: EventThing) => ({ ...eventBody(event), title: event.title ?? '' })

function thingBody(thing: Thing): z.infer<typeof Thing> {
  if (thing.kind === 'session') {
    const { kind, id, title, start, end, status } = thing
    return { kind, id, title, start: start.toISOString(), end: end.toISOString(), status }
  }
  return thing.kind === 'occupation' ? { kind: thing.kind, ...occupationBody(thing) } : { kind: thing.kind, ...eventBody(thing) }
}

// A session, as the calendar counts it.
function calendarSession(row: StoredSession | SessionWithoutSets): CalendarSession {
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
          'What takes the studio over the days from `from` to `to`, both included, in Québec: sessions, occupations and quiet time, and the calendar feeds that occupations and quiet time are read from, with their status, and, whatever the days, the conflicts of the next 365 days and the sessions without a date',
        tags: ['Calendar'],
        querystring: CalendarQuery,
        response: { 200: CalendarResponse },
      },
    },
    async (request) => {
      const { from, to } = request.query
      const range = { from: dayStart(from), to: dayStart(addDays(to, 1)) }
      const today = quebecDay(new Date())
      const window = { from: dayStart(today), to: dayStart(addDays(today, CONFLICT_DAYS)) }

      const [listed, stored] = await Promise.all([feeds.list(), sessions.forCalendar(range, window)])
      const inRange = takesSomeOf(range)
      const inWindow = takesSomeOf(window)
      // What was read from each feed is taken once, so that its status and its events are from the same read. Only the
      // events of the days asked for, or of the 365 days, are needed: a read keeps three years.
      const withReads = listed.map((feed) => ({ feed, read: reads.of(feed.id) }))
      const events: EventThing[] = withReads.flatMap(({ feed, read }) =>
        (read?.events ?? [])
          .filter((event) => inRange(event) || inWindow(event))
          .map(({ start, end, wholeDay, title }) => ({ kind: feed.kind, feed: feed.id, start, end, wholeDay, title })),
      )
      const order = thingOrder(listed.map(({ id }) => id))
      const eventsInRange = events.filter(inRange).sort(order)

      // The sessions given in full, those of the days asked for and those without a start, are those with their sets.
      const given = stored.filter((row): row is StoredSession => row.sets !== null)
      const sessionsInRange = given
        .filter((row) => row.startAt !== null)
        .sort((a, b) => a.startAt!.getTime() - b.startAt!.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || compareStrings(a.id, b.id))
      const undated = given
        .filter((row) => row.startAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || compareStrings(a.id, b.id))
      const found = conflicts(stored.map(calendarSession), events, window, order)

      return {
        ok: true as const,
        today,
        feeds: withReads.map(({ feed, read }) => feedBody(feed, read)),
        sessions: sessionsInRange.map(sessionBody),
        occupations: eventsInRange.filter(({ kind }) => kind === 'occupation').map(occupationBody),
        quietTimes: eventsInRange.filter(({ kind }) => kind === 'quiet-time').map(eventBody),
        conflicts: found.map(({ start, end, things: [first, second] }) => ({
          start: start.toISOString(),
          end: end.toISOString(),
          things: [thingBody(first), thingBody(second)] as [z.infer<typeof Thing>, z.infer<typeof Thing>],
        })),
        undatedSessions: undated.map(sessionBody),
      }
    },
  )
}
