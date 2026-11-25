import type { CalendarSession, Period } from './conflicts.js'
import { takesSomeOf } from './conflicts.js'

// The time that's protected for sessions, from the holds of the `holds` feeds, and the sessions outside it (see "Protected
// time" in docs/design/server/calendar.md).

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
