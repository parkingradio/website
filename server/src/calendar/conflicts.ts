import type { Status } from '../sessions/fields.js'
import type { FeedKind } from './fields.js'

// The calendar's conflicts: the things that take the studio, two by two, when they overlap (see "Conflicts" in
// docs/design/server/calendar.md).
//
// There's one conflict per pair of things that overlap, so a feed with many events that all overlap each other gives many
// conflicts, e.g. about 2 million for 2,000 events. No calendar the studio's feeds are read from is like that, so nothing
// keeps it from happening.

// A session, as the calendar counts it: one without a start, or that's cancelled, doesn't count.
export type CalendarSession = { id: string; title: string; start: Date | null; end: Date | null; status: Status }

// The things that take the studio, as conflicts give them. Quiet time's title is always null, and never given.
export type SessionThing = { kind: 'session'; id: string; title: string; start: Date; end: Date; status: Status }
export type EventThing = { kind: FeedKind; feed: string; start: Date; end: Date; wholeDay: boolean; title: string | null }
export type Thing = SessionThing | EventThing

// Two things that overlap, from `start` to `end`, in their order.
export type Conflict = { start: Date; end: Date; things: [Thing, Thing] }

export type Period = { from: Date; to: Date }

const KINDS: Thing['kind'][] = ['session', 'occupation', 'quiet-time']

export const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Whether something from `start` to `end` takes some of `period`: one without a start takes none.
export const takesSomeOf =
  ({ from, to }: Period) =>
  ({ start, end }: { start: Date | null; end: Date | null }) =>
    start !== null && end !== null && start < end && end > from && start < to

// The order of things, whose events are those of `feeds`, the feeds' ids in the order they were added: by start, end,
// kind, then a session's id, or an event's feed's place, title, and timed before whole-day. Two things in the same place
// are the same in all that the calendar gives of them.
export function thingOrder(feeds: string[]): (a: Thing, b: Thing) => number {
  const place = new Map(feeds.map((id, index) => [id, index]))
  return (a, b) => {
    const order = a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime() || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    if (order !== 0) return order
    // Both are of the same kind.
    if (a.kind === 'session') return compareStrings(a.id, (b as SessionThing).id)
    const other = b as EventThing
    return place.get(a.feed)! - place.get(other.feed)! || compareStrings(a.title ?? '', other.title ?? '') || Number(a.wholeDay) - Number(other.wholeDay)
  }
}

// The conflicts of `sessions` and `events` whose overlap takes some of `window`, in order: by start, end, first thing,
// then second thing, where things are in `order` (see `thingOrder`).
export function conflicts(sessions: CalendarSession[], events: EventThing[], window: Period, order: (a: Thing, b: Thing) => number): Conflict[] {
  const inWindow = takesSomeOf(window)
  const counted: Thing[] = sessions.flatMap(({ id, title, start, end, status }) =>
    start && end && status !== 'cancelled' ? [{ kind: 'session' as const, id, title, start, end, status }] : [],
  )
  // The overlap of two things takes some of the window exactly when they overlap, and each one takes some of it.
  const things = [...counted, ...events].filter(inWindow).sort(order)

  // Going through the things by start, each one overlaps the things before it that haven't ended yet, which started at
  // the same time as it, or before.
  const found: Conflict[] = []
  let going: Thing[] = []
  for (const thing of things) {
    going = going.filter(({ end }) => end > thing.start)
    for (const before of going) found.push({ start: thing.start, end: before.end < thing.end ? before.end : thing.end, things: [before, thing] })
    going.push(thing)
  }
  return found.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime() || order(a.things[0], b.things[0]) || order(a.things[1], b.things[1]),
  )
}
