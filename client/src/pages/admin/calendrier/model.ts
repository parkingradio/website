import type { Data, Schema } from '../../../api/client'
import { isDay } from '../../../application-fields'
import { addDays, daysBetween, quebecDayAndTime, quebecInstant } from '../../../quebec-time'
import type { Session } from '../../../session-fields'
import { endsByItsTime, formatDayInYear, formatQuebecDayInYear, formatTime, shortTimes } from '../describe'

// What the Calendrier page shows of the calendar, worked out from what the server gives (see
// docs/design/client/admin/calendrier.md), without React. Days are "YYYY-MM-DD" in Québec, and months "YYYY-MM", which
// are only ever reckoned with as such, or as midnight UTC, never in the browser's time zone.

export type Calendar = Data<'get', '/api/admin/calendar'> & { ok: true }
export type Conflict = Calendar['conflicts'][number]
export type ConflictThing = Conflict['things'][number]
export type Feed = Calendar['feeds'][number]

// Something that takes the studio: a session, with a start, an occupation or quiet time.
export type Thing =
  | ({ kind: 'session' } & Omit<Session, 'start' | 'end'> & { start: string; end: string })
  | ({ kind: 'occupation' } & Schema<'CalendarOccupation'>)
  | ({ kind: 'quiet-time' } & Schema<'CalendarQuietTime'>)

// The days the server takes (see docs/design/server/calendar.md).
const FIRST_DAY = '2000-01-01'
const LAST_DAY = '2999-12-31'
export const FIRST_MONTH = FIRST_DAY.slice(0, 7)
export const LAST_MONTH = LAST_DAY.slice(0, 7)

// How many days from today conflicts are found in, and free time shown in.
const HORIZON_DAYS = 365

// `value` if it's a month the page shows, from 2000-01 to 2999-12, or else null.
export function readMonth(value: string | null): string | null {
  return value !== null && /^\d{4}-\d{2}$/.test(value) && isDay(`${value}-01`) && value >= FIRST_MONTH && value <= LAST_MONTH ? value : null
}

// `value` if it's a day of the months the page shows, or else null.
export function readDay(value: string | null): string | null {
  return value !== null && isDay(value) && value >= FIRST_DAY && value <= LAST_DAY ? value : null
}

export const monthOf = (day: string) => day.slice(0, 7)

// The month `months` months after `month`, or before if it's negative.
export function addMonths(month: string, months: number): string {
  const [year, number] = month.split('-').map(Number)
  const index = year * 12 + number - 1 + months
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

// 0 for Sunday, up to 6 for Saturday.
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay()

// The days the grid of `month` shows: from the Sunday of its first week to the Saturday of its last.
export function gridDays(month: string): string[] {
  const first = `${month}-01`
  const last = addDays(`${addMonths(month, 1)}-01`, -1)
  const from = addDays(first, -weekday(first))
  const to = addDays(last, 6 - weekday(last))
  return Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i))
}

// The days the page asks the server for, for the grid of `month`: all of them, within the days the server takes.
export function gridRange(month: string): { from: string; to: string } {
  const days = gridDays(month)
  return { from: days[0] < FIRST_DAY ? FIRST_DAY : days[0], to: days.at(-1)! > LAST_DAY ? LAST_DAY : days.at(-1)! }
}

// When `day` starts in Québec, at 00:00, which is never skipped, in milliseconds: the days the clocks change on are 23 or
// 25 hours long.
const dayStarts = new Map<string, number>()
function dayStart(day: string): number {
  let start = dayStarts.get(day)
  if (start === undefined) dayStarts.set(day, (start = quebecInstant(day, '00:00')!.getTime()))
  return start
}

const dayOf = (instant: number) => quebecDayAndTime(new Date(instant)).day
// E.g. "21 h", the time it is in Québec at `instant`.
const timeOf = (instant: number) => formatTime(quebecDayAndTime(new Date(instant)).time)

type Times = { start: string; end: string }

// The days something takes some of, from the day it starts to the day it ends, unless it ends at 00:00 on it, or only
// those from `from` to `to`.
export function daysOf({ start, end }: Times, [from, to] = [FIRST_DAY, LAST_DAY]): string[] {
  const first = [dayOf(Date.parse(start)), from].sort().at(-1)!
  const last = [dayOf(Date.parse(end) - 1), to].sort()[0]
  return first > last ? [] : Array.from({ length: daysBetween(first, last) + 1 }, (_, i) => addDays(first, i))
}

// Whether something takes some of `day`.
function takesSomeOf({ start, end }: Times, day: string): boolean {
  return Date.parse(start) < dayStart(addDays(day, 1)) && Date.parse(end) > dayStart(day)
}

// What a thing takes of a day when that's all of it, and what free time a day has when nothing takes it.
export const WHOLE_DAY = 'toute la journée'

// The part of `day` something takes, as the month writes it, e.g. "21 h – 23 h", "dès 18 h", "jusqu'à 1 h" or "toute la
// journée" (see "What's shown" in docs/design/client/admin/calendrier.md).
export function partOfDay({ start, end }: Times, day: string): string {
  const [from, to] = [Date.parse(start), Date.parse(end)]
  const [dayFrom, dayTo] = [dayStart(day), dayStart(addDays(day, 1))]
  if (from <= dayFrom && to >= dayTo) return WHOLE_DAY
  if (from < dayFrom) return `jusqu'à ${timeOf(to)}`
  if (to <= dayTo || endsByItsTime(start, end)) return `${timeOf(from)} – ${timeOf(to)}`
  return `dès ${timeOf(from)}`
}

// Something's times in full, on `day`, e.g. "21 h – 1 h", "toute la journée", "du ven. 13 nov. au dim. 15 nov." or "ven.
// 13 nov., 21 h – 1 h" (see "What's shown" in docs/design/client/admin/calendrier.md).
export function fullTimes(times: Times, day: string): string {
  const from = quebecDayAndTime(new Date(times.start))
  const to = quebecDayAndTime(new Date(times.end))
  if (from.time === '00:00' && to.time === '00:00') {
    const last = addDays(to.day, -1)
    return from.day === last ? WHOLE_DAY : `du ${formatDayInYear(from.day)} au ${formatDayInYear(last)}`
  }
  return from.day === day ? shortTimes(times) : `${formatQuebecDayInYear(times.start)}, ${shortTimes(times)}`
}

// The free time of `day` outside what takes some of it, `busy`, as parts of the day: `WHOLE_DAY` when that's nothing, or
// else each stretch, e.g. "jusqu'à 15 h", "dès 11 h" or "11 h – 15 h", or nothing when it's all taken.
export function freeTime(day: string, busy: Times[]): string[] {
  const [dayFrom, dayTo] = [dayStart(day), dayStart(addDays(day, 1))]
  const taken = busy
    .map(({ start, end }) => [Math.max(Date.parse(start), dayFrom), Math.min(Date.parse(end), dayTo)])
    .filter(([from, to]) => from < to)
    .sort(([a], [b]) => a - b)
  const stretches: [number, number][] = []
  let free = dayFrom
  for (const [from, to] of taken) {
    if (from > free) stretches.push([free, from])
    free = Math.max(free, to)
  }
  if (free < dayTo) stretches.push([free, dayTo])
  return stretches.map(([from, to]) => {
    if (from === dayFrom && to === dayTo) return WHOLE_DAY
    if (from === dayFrom) return `jusqu'à ${timeOf(to)}`
    if (to === dayTo) return `dès ${timeOf(from)}`
    return `${timeOf(from)} – ${timeOf(to)}`
  })
}

// What tells things apart, the way the server does: a session by its id, and an occupation or quiet time by all it's
// given with (see "The calendar" in docs/design/server/calendar.md).
export function thingKey(thing: Thing | ConflictThing): string {
  if (thing.kind === 'session') return `session ${thing.id}`
  return JSON.stringify([thing.kind, thing.feed, Date.parse(thing.start), Date.parse(thing.end), thing.wholeDay, 'title' in thing ? thing.title : ''])
}

// The calendar an occupation or quiet time is changed in, by its feed's name, e.g. « calendrier « Équipe » ».
export function calendarOf(feeds: Feed[], feed: string): string {
  return `calendrier «\u00a0${feeds.find(({ id }) => id === feed)?.name ?? '?'}\u00a0»`
}

// An occupation's title, or "sans titre".
export const occupationTitle = (title: string) => title || 'sans titre'

// The other thing of a conflict, within a sentence, e.g. "la session HAUTE RIVE TAKEOVER", "l'occupation RÉPARATION" or
// "le silence du calendrier « Séjours »".
export function inSentence(thing: ConflictThing, feeds: Feed[]): string {
  if (thing.kind === 'session') return `la session ${thing.title}`
  if (thing.kind === 'occupation') return `l'occupation ${occupationTitle(thing.title)}`
  return `le silence du ${calendarOf(feeds, thing.feed)}`
}

// Every thing of the calendar: sessions, occupations and quiet time.
function thingsOf(calendar: Calendar): Thing[] {
  return [
    ...calendar.sessions.flatMap(({ start, end, ...session }): Thing[] => (start !== null && end !== null ? [{ kind: 'session', ...session, start, end }] : [])),
    ...calendar.occupations.map((occupation): Thing => ({ kind: 'occupation', ...occupation })),
    ...calendar.quietTimes.map((quietTime): Thing => ({ kind: 'quiet-time', ...quietTime })),
  ]
}

// A thing on a day: its part of the day, and the other things of its conflicts whose overlap takes some of the day.
export type DayThing = { thing: Thing; part: string; conflictsWith: ConflictThing[] }

// A day of the grid: what takes some of it, quiet time first, then in order of start and end, and its free time, if it's
// shown (see "Free time" in docs/design/client/admin/calendrier.md), as `freeTime` gives it.
export type CalendarDay = { things: DayThing[]; free: string[] }

// The days of the grid of `month`, as they're shown with `calendar`, read for them, on `today`.
export function calendarDays(calendar: Calendar, month: string, today: string): Map<string, CalendarDay> {
  const days = gridDays(month)
  const byDay = new Map(days.map((day): [string, CalendarDay] => [day, { things: [], free: [] }]))
  const conflicts = new Map<string, Conflict[]>()
  for (const conflict of calendar.conflicts) {
    // Once for two things that are the same, e.g. an event that's twice in its feed.
    for (const key of new Set(conflict.things.map(thingKey))) conflicts.set(key, [...(conflicts.get(key) ?? []), conflict])
  }
  const order = (thing: Thing) => (thing.kind === 'quiet-time' ? 0 : 1)
  const things = thingsOf(calendar).sort((a, b) => order(a) - order(b) || Date.parse(a.start) - Date.parse(b.start) || Date.parse(a.end) - Date.parse(b.end))
  for (const thing of things) {
    const key = thingKey(thing)
    for (const day of daysOf(thing, [days[0], days.at(-1)!])) {
      const conflictsWith = (conflicts.get(key) ?? [])
        .filter((conflict) => takesSomeOf(conflict, day))
        .map((conflict) => conflict.things.find((other) => thingKey(other) !== key) ?? conflict.things[0])
      byDay.get(day)!.things.push({ thing, part: partOfDay(thing, day), conflictsWith })
    }
  }
  const horizon = addDays(today, HORIZON_DAYS)
  for (const [day, shown] of byDay) {
    if (monthOf(day) !== month || day < today || day >= horizon) continue
    // Cancelled sessions don't take the studio.
    const taking = shown.things.map(({ thing }) => thing).filter((thing) => thing.kind !== 'session' || thing.status !== 'cancelled')
    if (taking.some((thing) => thing.kind !== 'quiet-time' && Date.parse(thing.start) >= dayStart(day))) continue
    shown.free = freeTime(day, taking)
  }
  return byDay
}
