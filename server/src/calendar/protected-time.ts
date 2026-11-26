import type { CalendarSession, Period } from './conflicts.js'
import { takesSomeOf } from './conflicts.js'

// The time that's protected for sessions, from the holds of the `holds` feeds, the sessions outside it, and the
// available time (see "Protected time" and "Availability" in docs/design/server/calendar.md).

type Span = { start: Date; end: Date }

// The time that `holds` take, of any feeds, as periods that don't overlap or follow each other, by start: holds that
// overlap or follow each other are one.
export function protectedTime(holds: Span[]): Span[] {
  const merged: Span[] = []
  for (const { start, end } of [...holds].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const last = merged.at(-1)
    if (last && start <= last.end) {
      if (end > last.end) last.end = end
    } else {
      merged.push({ start, end })
    }
  }
  return merged
}

// The sessions outside protected time, among `sessions`, with `holds` the holds of every `holds` feed, or null without a
// `holds` feed, when there are none: those that take some of `window`, the 365 days from today, that are planned, have a
// start, haven't ended at `now`, and aren't within protected time from their start, or from `now` if that's later, to
// their end. By start, which is enough, since planned sessions don't overlap.
export function unprotectedSessions<Session extends CalendarSession>(
  sessions: Session[],
  holds: Span[] | null,
  { window, now }: { window: Period; now: Date },
): (Session & Span)[] {
  if (holds === null) return []
  const inWindow = takesSomeOf(window)
  const judged = sessions.filter(
    (session): session is Session & Span =>
      session.status === 'planned' && session.start !== null && session.end !== null && session.end > now && inWindow(session),
  )
  if (judged.length === 0) return []
  // Only the holds that can protect some of them: reads keep holds from a year before them to two years after them.
  const last = Math.max(...judged.map(({ end }) => end.getTime()))
  const periods = protectedTime(holds.filter(({ start, end }) => end > now && start.getTime() < last))
  // Since the periods don't overlap or follow each other, what's protected is within a single one of them.
  const isProtected = (start: Date, end: Date) => periods.some((period) => period.start <= start && end <= period.end)
  return judged.filter(({ start, end }) => !isProtected(start > now ? start : now, end)).sort((a, b) => a.start.getTime() - b.start.getTime())
}

// The available time of `window`, the 365 days from today: the time `holds` protect, of any feeds, that nothing of
// `taking` takes, as stretches that don't overlap or follow each other, by start, cut only at the window's edges.
// `taking` is what takes the studio: the sessions that aren't cancelled, with a start, and the occupations.
export function availableTime(holds: Span[], taking: Span[], window: Period): Span[] {
  const { from, to } = window
  // Only what takes some of the window, rather than all that reads keep, from a year before them to two years after.
  const inWindow = takesSomeOf(window)
  const taken = taking.filter(inWindow).sort((a, b) => a.start.getTime() - b.start.getTime())
  const stretches: Span[] = []
  for (const period of protectedTime(holds.filter(inWindow))) {
    const end = period.end < to ? period.end : to
    // From when the period is available, as far as what's taken so far goes.
    let availableFrom = period.start > from ? period.start : from
    for (const { start, end: takenUntil } of taken) {
      if (availableFrom >= end || start >= end) break
      if (start > availableFrom) stretches.push({ start: availableFrom, end: start })
      if (takenUntil > availableFrom) availableFrom = takenUntil
    }
    if (availableFrom < end) stretches.push({ start: availableFrom, end })
  }
  return stretches
}
