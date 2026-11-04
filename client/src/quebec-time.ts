// Times in Québec, where the studio is, whatever the time zone of the browser: the admin pages show and take every date
// and time in Québec time (see docs/design/client/admin/layout.md), e.g. those of sessions and sets (see
// docs/design/client/admin/sessions.md), and the public pages show events' in Québec time too (see
// docs/design/client/programmation.md). It imports nothing, so that the seed (e2e/seed.ts) can use it too.

export const QUEBEC_TIME_ZONE = 'America/Toronto'
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

// The en-CA locale writes days as YYYY-MM-DD.
const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: QUEBEC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// The day and time it is in Québec at `instant`, as "YYYY-MM-DD" and "HH:MM".
export function quebecDayAndTime(instant: Date): { day: string; time: string } {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const { type, value } of partsFormat.formatToParts(instant)) parts[type] = value
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// The admin lists' search relies on the day, the month written out and the year being next to each other, in that order
// (see search in pages/admin/list.ts).
const longDayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: QUEBEC_TIME_ZONE })

// E.g. "samedi 14 novembre 2026", the day of `instant` (ISO 8601) in Québec.
export function formatLongQuebecDay(instant: string): string {
  return longDayFormat.format(new Date(instant))
}

// How many minutes Québec's clocks are ahead of UTC at the instant `ms`, e.g. -300 in winter.
function offsetAt(ms: number): number {
  const { day, time } = quebecDayAndTime(new Date(ms))
  return Math.round((Date.parse(`${day}T${time}:00Z`) - ms) / MINUTE_MS)
}

// The instant it is `time` ("HH:MM") on `day` ("YYYY-MM-DD") in Québec. When clocks fall back, a time happens twice, and
// it's the first of the two. When they spring forward, a time doesn't happen at all, and it's null, as it is for a day or
// a time that doesn't exist.
export function quebecInstant(day: string, time: string): Date | null {
  const wall = Date.parse(`${day}T${time}:00Z`)
  if (Number.isNaN(wall)) return null
  // Québec's offset at that time is the one it has a day before, or a day after, since clocks change at most once in
  // between. Each one is right if it gives back that day and time.
  const found = [offsetAt(wall - DAY_MS), offsetAt(wall + DAY_MS)]
    .map((offset) => wall - offset * MINUTE_MS)
    .filter((ms) => {
      const parts = quebecDayAndTime(new Date(ms))
      return parts.day === day && parts.time === time
    })
  return found.length > 0 ? new Date(Math.min(...found)) : null
}

// Every instant it's `time` ("HH:MM") on `day` ("YYYY-MM-DD") in Québec: none when clocks skip it, two when they show it
// twice, as they fall back.
function occurrences(day: string, time: string): Date[] {
  const first = quebecInstant(day, time)
  if (!first) return []
  // When clocks fall back, they show a time again an hour after they first did.
  const again = new Date(first.getTime() + 60 * MINUTE_MS)
  const parts = quebecDayAndTime(again)
  return parts.day === day && parts.time === time ? [first, again] : [first]
}

// The first instant after `after` (or at it, when it's `inclusive`) when Québec's clocks show `time` ("HH:MM"), within
// the day `after` is on and the next. Null when they skip it before showing it, as they spring forward, or when it isn't
// a time.
export function quebecInstantFrom(after: Date, time: string, { inclusive = false } = {}): Date | null {
  const start = quebecDayAndTime(after)
  for (const day of [start.day, addDays(start.day, 1)]) {
    const all = occurrences(day, time)
    const found = all.filter((instant) => (inclusive ? instant >= after : instant > after))
    if (found.length > 0) return found[0]
    // Skipped on a day where it would come after `after`.
    const comesAfter = day !== start.day || (inclusive ? time >= start.time : time > start.time)
    if (comesAfter && all.length === 0) return null
  }
  return null
}

// `instant` as the day and time in Québec, with Québec's offset from UTC then, e.g. "2026-11-14T21:00-05:00", to the minute.
export function quebecDateTime(instant: Date): string {
  const { day, time } = quebecDayAndTime(instant)
  const offset = offsetAt(Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day}T${time}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

// The day that's `days` days after `day` ("YYYY-MM-DD"), or before if it's negative, as "YYYY-MM-DD".
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}
