import type { Status } from '../sessions/fields.js'

// The calendar's conflicts: the things that take the studio, two by two, when they overlap (see "Conflicts" in
// docs/design/server/calendar.md).
//
// There's one conflict per pair of things that overlap, so a feed with many events that all overlap each other gives many
// conflicts, e.g. about 2 million for 2,000 events. No calendar the studio's feeds are read from is like that, so nothing
// keeps it from happening.
//
// Likewise, the calendar gives every conflict of the 365 days whatever the days asked for, so what `get_calendar` gives
// apps grows with them, e.g. with whole-day reminders in the team's calendar, even for a single day.

// A session, as the calendar counts it: one without a start, or that's cancelled, doesn't count.
export type CalendarSession = { id: string; title: string; start: Date | null; end: Date | null; status: Status }

// The things that take the studio, as conflicts give them. An occupation's title is null when its feed's titles are
// private.
export type SessionThing = { kind: 'session'; id: string; title: string; start: Date; end: Date; status: Status }
export type OccupationThing = { kind: 'occupation'; feedId: string; start: Date; end: Date; wholeDay: boolean; title: string | null }
export type Thing = SessionThing | OccupationThing

// Two things that overlap, from `start` to `end`, in their order.
export type Conflict = { start: Date; end: Date; things: [Thing, Thing] }

export type Period = { from: Date; to: Date }

export const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Whether something from `start` to `end` takes some of `period`: one without a start takes none.
export const takesSomeOf =
  ({ from, to }: Period) =>
  ({ start, end }: { start: Date | null; end: Date | null }) =>
    start !== null && end !== null && start < end && end > from && start < to

// The order of things: by start, then end, then sessions before occupations, and sessions by id. Occupations that are
// tied stay in the order they're given in, so that sorting them is stable as long as they're given in a stable order,
// e.g. by feed, then as they were read.
export function thingOrder(a: Thing, b: Thing): number {
  return (
    a.start.getTime() - b.start.getTime() ||
    a.end.getTime() - b.end.getTime() ||
    Number(a.kind === 'occupation') - Number(b.kind === 'occupation') ||
    (a.kind === 'session' && b.kind === 'session' ? compareStrings(a.id, b.id) : 0)
  )
}

// The conflicts of `sessions` and `occupations` whose overlap takes some of `window`: by start, then end, then the places
// of their two things in the order of things (see `thingOrder`), each conflict's things in that order too.
export function conflicts(sessions: CalendarSession[], occupations: OccupationThing[], window: Period): Conflict[] {
  const inWindow = takesSomeOf(window)
  const counted: Thing[] = sessions.flatMap(({ id, title, start, end, status }) =>
    start && end && status !== 'cancelled' ? [{ kind: 'session' as const, id, title, start, end, status }] : [],
  )
  // The overlap of two things takes some of the window exactly when they overlap, and each one takes some of it.
  const things = [...counted, ...occupations].filter(inWindow).sort(thingOrder)

  // Going through the things in order, each one overlaps the things before it that haven't ended yet, which started at
  // the same time as it, or before.
  const found: (Conflict & { places: [number, number] })[] = []
  let going: number[] = []
  things.forEach((thing, place) => {
    going = going.filter((before) => things[before].end > thing.start)
    for (const before of going) {
      const end = things[before].end < thing.end ? things[before].end : thing.end
      found.push({ start: thing.start, end, things: [things[before], thing], places: [before, place] })
    }
    going.push(place)
  })
  return found
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime() || a.places[0] - b.places[0] || a.places[1] - b.places[1])
    .map(({ start, end, things }) => ({ start, end, things }))
}
