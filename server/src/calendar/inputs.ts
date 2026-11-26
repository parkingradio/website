import { addDays, dayStart, quebecDay } from '../api/formats.js'
import { after, sessionTitle } from '../sessions/fields.js'
import type { SessionWithoutSets, SessionsStore } from '../sessions/store.js'
import { takingThings } from './conflicts.js'
import type { CalendarSession, OccupationThing, Period } from './conflicts.js'
import type { CalendarEvent } from './events.js'
import type { CalendarFeedsStore, StoredFeed } from './feeds.js'
import type { FeedKind } from './fields.js'
import type { CalendarReads, FeedRead } from './reads.js'
import { availableTime } from './protected-time.js'

// What the studio's calendar is worked out from (see "The calendar" in docs/design/server/calendar.md), which both
// GET /api/admin/calendar and the admins' calendar of available time take from here, so that they agree.

// The year ahead's days, from today, which the conflicts, the sessions outside protected time and the available time are
// those of.
const YEAR_AHEAD_DAYS = 365

// A session, as the calendar counts it.
function calendarSession(row: SessionWithoutSets): CalendarSession {
  const { id, startAt: start, durationMinutes, status } = row
  return { id, title: sessionTitle(row), start, end: start && after(start, durationMinutes), status }
}

type Sources = { feeds: CalendarFeedsStore; reads: CalendarReads; sessions: Pick<SessionsStore, 'forCalendar'> }

// What the calendar of the time from `range.from` to `range.to`, or of the year ahead without `range`, is worked out from
// at `now`:
// - `today`, in Québec, and `window`, the year ahead, from 00:00 on it;
// - every feed, with what was read from it, if anything (see `CalendarReads.of`), taken once, so that its status and its
//   events are from the same read, that of the feed as it is now, whose kind says what its events are;
// - the occupations and the holds that those reads give, in the order of the feeds, then as they were read, which
//   ties keep (see `thingOrder` in conflicts.ts), the holds being null without a `holds` feed, when nothing is known to
//   be protected or not;
// - the sessions `forCalendar` gives: `given`, and every one the calendar counts, as it counts them (`counted`);
// - and `available`, the available time of the year ahead, from all of these.
// Without `range`, `forCalendar` gives the year ahead's sessions with their sets, which only `given` has and its callers
// then don't need: loading them costs little, as /sessions.ics loads more.
export async function calendarInputs({ feeds, reads, sessions }: Sources, { now, range }: { now: Date; range?: Period }) {
  const today = quebecDay(now)
  const window: Period = { from: dayStart(today), to: dayStart(addDays(today, YEAR_AHEAD_DAYS)) }
  const [listed, { given, others }] = await Promise.all([feeds.list(), sessions.forCalendar(range ?? window, window)])
  const withReads: { feed: StoredFeed; read: FeedRead | undefined }[] = listed.map((feed) => ({ feed, read: reads.of(feed) }))
  const eventsOf = <Item>(kind: FeedKind, item: (feedId: string, event: CalendarEvent) => Item) =>
    withReads.filter(({ feed }) => feed.kind === kind).flatMap(({ feed, read }) => (read?.events ?? []).map((event) => item(feed.id, event)))
  const occupations: OccupationThing[] = eventsOf('occupations', (feedId, event) => ({ kind: 'occupation' as const, feedId, ...event }))
  const holds = withReads.some(({ feed }) => feed.kind === 'holds') ? eventsOf('holds', (_feedId, event) => event) : null
  const counted = [...given, ...others].map(calendarSession)
  const available = availableTime(holds ?? [], takingThings(counted, occupations), window)
  return { today, window, withReads, occupations, holds, given, counted, available }
}
