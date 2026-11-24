import type { Data, Schema } from '../../../api/client'
import { isDay } from '../../../application-fields'
import { addDays, daysBetween, quebecDayAndTime, quebecInstant } from '../../../quebec-time'
import type { Session } from '../../../session-fields'
import { endsByItsTime, formatDayInYear, formatQuebecDay, formatQuebecDayInYear, formatTime, formatWeekdayAndNumber, shortTimes } from '../describe'

// What the Calendrier page shows of the calendar, worked out from what the server gives (see
// docs/design/client/admin/calendrier.md), without React. Days are "YYYY-MM-DD" in Québec, and months "YYYY-MM", which
// are only ever reckoned with as such, or as midnight UTC, never in the browser's time zone.

export type Calendar = Data<'get', '/api/admin/calendar'> & { ok: true }
export type Conflict = Calendar['conflicts'][number]
export type ConflictThing = Conflict['things'][number]
export type Feed = Calendar['feeds'][number]

// An occupation as the page names it: its title, or null when it has none or its feed's titles are private, and its
// feed's name, `calendar`, which stands in for its title when it has none (see "What's shown" in
// docs/design/client/admin/calendrier.md).
export type OccupationName = { title: string | null; calendar: string }

// Something that takes the studio, as the page shows it: a session, with a start, or an occupation.
export type Thing =
  | ({ kind: 'session' } & Omit<Session, 'start' | 'end'> & { start: string; end: string })
  | ({ kind: 'occupation'; start: string; end: string } & OccupationName)

// What the page names a conflict's thing by: a session, by its title, or an occupation.
export type NamedThing = { kind: 'session'; id: string; title: string; status: Session['status'] } | ({ kind: 'occupation' } & OccupationName)

// The days the server takes (see docs/design/server/calendar.md).
const FIRST_DAY = '2000-01-01'
export const LAST_DAY = '2999-12-31'
export const FIRST_MONTH = FIRST_DAY.slice(0, 7)
export const LAST_MONTH = LAST_DAY.slice(0, 7)

// How many days from today conflicts are found in, and free time and the list shown in.
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

// The days the page asks the server for, for a grid's `days`: all of them, within the days the server takes.
export function gridRange(days: string[]): { from: string; to: string } {
  return { from: days[0] < FIRST_DAY ? FIRST_DAY : days[0], to: days.at(-1)! > LAST_DAY ? LAST_DAY : days.at(-1)! }
}

// The days the list shows, and asks the server for: the 365 days from `today`, those conflicts are found in.
export function listRange(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, HORIZON_DAYS - 1) }
}

// When `day` starts in Québec, at 00:00, which is never skipped, in milliseconds: the days the clocks change on are 23 or
// 25 hours long.
const dayStart = (day: string) => quebecInstant(day, '00:00')!.getTime()

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
const WHOLE_DAY = 'toute la journée'

// The part of `day` something takes, as the month writes it, e.g. "21 h – 23 h", "dès 18 h", "jusqu'à 1 h" or "toute la
// journée" (see "What's shown" in docs/design/client/admin/calendrier.md).
export function partOfDay({ start, end }: Times, day: string): string {
  const [from, to] = [Date.parse(start), Date.parse(end)]
  const [dayFrom, dayTo] = [dayStart(day), dayStart(addDays(day, 1))]
  if (from <= dayFrom && to >= dayTo) return WHOLE_DAY
  if (from <= dayFrom) return `jusqu'à ${timeOf(to)}`
  if (to <= dayTo || endsByItsTime(start, end)) return `${timeOf(from)} – ${timeOf(to)}`
  return `dès ${timeOf(from)}`
}

// Something's times in brief, on `day`, which it takes some of, e.g. "18 h – 21 h", "21 h – 1 h", "15 h → mar. 24", "→ 11 h",
// "journée" or "→ jeu. 3", where a later day is the last one it takes, with its month when it's four weeks or more after
// `day`, e.g. "→ sam. 2 janv." (see "What's shown" in docs/design/client/admin/calendrier.md). Where `shortTimes` would
// give the day and the time something ends, it gives the last day it takes, so that it fits in 17 characters (the
// list's column, see calendrier.css), except with a month.
export function briefTimes(times: Times, day: string): string {
  const [from, to] = [Date.parse(times.start), Date.parse(times.end)]
  const last = dayOf(to - 1)
  // A weekday and a number only come back together four weeks or more later.
  const lastDay = () => (daysBetween(day, last) < 28 ? formatWeekdayAndNumber(last) : formatDayInYear(last))
  // From the start of the day: since an earlier day, or 00:00.
  if (from <= dayStart(day)) {
    if (last > day) return `→ ${lastDay()}`
    return to >= dayStart(addDays(day, 1)) ? 'journée' : `→ ${timeOf(to)}`
  }
  return endsByItsTime(times.start, times.end) ? shortTimes(times) : `${timeOf(from)} → ${lastDay()}`
}

// Something's times in full, on `day`, e.g. "21 h – 1 h", "toute la journée", "du ven. 13 nov. au dim. 15 nov.",
// "jusqu'au dim. 15 nov., 11 h" or "ven. 13 nov., 21 h – 1 h" (see "What's shown" in
// docs/design/client/admin/calendrier.md).
export function fullTimes(times: Times, day: string): string {
  const from = quebecDayAndTime(new Date(times.start))
  const to = quebecDayAndTime(new Date(times.end))
  if (from.time === '00:00' && to.time === '00:00') {
    const last = addDays(to.day, -1)
    return from.day === last ? WHOLE_DAY : `du ${formatDayInYear(from.day)} au ${formatDayInYear(last)}`
  }
  // From the start of its day, as the month writes it.
  if (from.time === '00:00') {
    const until = to.day === from.day ? `jusqu'à ${formatTime(to.time)}` : `jusqu'au ${formatDayInYear(to.day)}, ${formatTime(to.time)}`
    return from.day === day ? until : `du ${formatDayInYear(from.day)} ${until}`
  }
  return from.day === day ? shortTimes(times) : `${formatQuebecDayInYear(times.start)}, ${shortTimes(times)}`
}

// The day something starts, e.g. "sam. 21 nov.", with its year when it isn't `near`'s, e.g. "sam. 2 janv. 2027", `near`
// being a day the reader knows the year of, e.g. today.
export function startDay({ start }: Times, near: string): string {
  return dayOf(Date.parse(start)).slice(0, 4) === near.slice(0, 4) ? formatQuebecDayInYear(start) : formatQuebecDay(start)
}

// A thing's name alone, without its calendar's: a session's title, or an occupation's, or its calendar's name when it
// has none.
export const nameOf = (thing: NamedThing) => (thing.kind === 'session' ? thing.title : (thing.title ?? thing.calendar))

// A stretch of free time on a day: the part of the day it is, "toute la journée", or e.g. "jusqu'à 15 h", "dès 11 h" or
// "11 h – 15 h", and whether it's the whole day.
export type FreeStretch = { part: string; wholeDay: boolean }

// The free time of `day` outside what takes some of it, `busy`, stretch by stretch, each with when it starts, in
// milliseconds, or nothing when it's all taken.
function freeStretches(day: string, busy: Times[]): { start: number; stretch: FreeStretch }[] {
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
  const part = (from: number, to: number) => {
    if (from === dayFrom && to === dayTo) return WHOLE_DAY
    if (from === dayFrom) return `jusqu'à ${timeOf(to)}`
    if (to === dayTo) return `dès ${timeOf(from)}`
    return `${timeOf(from)} – ${timeOf(to)}`
  }
  return stretches.map(([from, to]) => ({ start: from, stretch: { part: part(from, to), wholeDay: from === dayFrom && to === dayTo } }))
}

// The free time of `day` outside what takes some of it, `busy`, stretch by stretch, or nothing when it's all taken.
export function freeTime(day: string, busy: Times[]): FreeStretch[] {
  return freeStretches(day, busy).map(({ stretch }) => stretch)
}

// What tells things apart, the way the server does: a session by its id, and an occupation by all it's given with (see
// "The calendar" in docs/design/server/calendar.md).
export function thingKey(thing: ConflictThing): string {
  if (thing.kind === 'session') return `session ${thing.id}`
  return JSON.stringify([thing.feedId, Date.parse(thing.start), Date.parse(thing.end), thing.wholeDay, thing.title])
}

// An occupation's name, with its feed's name from `feeds`, which has it, as the server's calendar has every occupation's
// feed.
function occupationName({ feedId, title }: Schema<'CalendarOccupation'>, feeds: Feed[]): OccupationName {
  return { title: title || null, calendar: feeds.find(({ id }) => id === feedId)!.name }
}

// A conflict's thing, as the page names it.
export function namedThing(thing: ConflictThing, feeds: Feed[]): NamedThing {
  if (thing.kind === 'session') return { kind: 'session', id: thing.id, title: thing.title, status: thing.status }
  return { kind: 'occupation', ...occupationName(thing, feeds) }
}

// The other thing of a conflict, within a sentence, e.g. "la session HAUTE RIVE TAKEOVER", "l'occupation RÉPARATION
// (Équipe)" or "l'occupation Séjours".
export function inSentence(thing: NamedThing): string {
  if (thing.kind === 'session') return `la session ${thing.title}`
  return thing.title === null ? `l'occupation ${thing.calendar}` : `l'occupation ${thing.title} (${thing.calendar})`
}

// Every thing of the calendar, sessions and occupations, with their keys.
function thingsOf({ sessions, occupations, feeds }: Calendar): { key: string; thing: Thing }[] {
  return [
    ...sessions.flatMap(({ start, end, ...session }) => {
      if (start === null || end === null) return []
      const thing = { kind: 'session' as const, ...session, start, end }
      return [{ key: thingKey(thing), thing }]
    }),
    ...occupations.map((occupation) => {
      const { start, end } = occupation
      return { key: thingKey({ kind: 'occupation', ...occupation }), thing: { kind: 'occupation' as const, start, end, ...occupationName(occupation, feeds) } }
    }),
  ]
}

// One of a thing's conflicts, with its other thing, as the page names it, or the thing itself, when it's in conflict with
// another that's the same as it.
export type ThingConflict = { conflict: Conflict; other: NamedThing }

// A thing, with every one of its conflicts.
export type ThingWithConflicts = { thing: Thing; conflicts: ThingConflict[] }

// Every thing of the calendar, by start, then end, with every one of its conflicts, as the server gives them, but each
// other thing once, even when it's in conflict with two things that are the same as this one.
export function thingsWithConflicts(calendar: Calendar): ThingWithConflicts[] {
  // Each thing's conflicts, by its key, with their two things' keys and names.
  const conflicts = new Map<string, { conflict: Conflict; things: { key: string; named: NamedThing }[] }[]>()
  for (const conflict of calendar.conflicts) {
    const keyed = { conflict, things: conflict.things.map((thing) => ({ key: thingKey(thing), named: namedThing(thing, calendar.feeds) })) }
    for (const { key } of keyed.things) conflicts.set(key, [...(conflicts.get(key) ?? []), keyed])
  }
  return thingsOf(calendar)
    .sort(({ thing: a }, { thing: b }) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(a.end) - Date.parse(b.end))
    .map(({ key, thing }) => {
      const others = new Map<string, ThingConflict>()
      for (const { conflict, things } of conflicts.get(key) ?? []) {
        // The other thing, or this one, in conflict with another that's the same. The conflicts with things that are the
        // same are the same, so the first one stands for them.
        const other = things.find((other) => other.key !== key) ?? things[0]
        if (!others.has(other.key)) others.set(other.key, { conflict, other: other.named })
      }
      return { thing, conflicts: [...others.values()] }
    })
}

// A thing on a day: its part of the day, and its conflicts whose overlap takes some of the day.
export type DayThing = { thing: Thing; part: string; conflicts: ThingConflict[] }

// What's on a day of the grid, in order of time: what takes some of it, by start, then end, and the stretches of its free
// time, if it has any (see "Free time" in docs/design/client/admin/calendrier.md), among them.
export type DayEntry = DayThing | FreeStretch
export type CalendarDay = DayEntry[]

export const isFree = (entry: DayEntry): entry is FreeStretch => !('thing' in entry)

// The days of a grid, `days`, as they're shown with `calendar`, read for them.
export function calendarDays(calendar: Calendar, days: string[]): Map<string, CalendarDay> {
  const byDay = new Map(days.map((day): [string, DayThing[]] => [day, []]))
  for (const { thing, conflicts } of thingsWithConflicts(calendar)) {
    for (const day of daysOf(thing, [days[0], days.at(-1)!])) {
      byDay.get(day)!.push({ thing, part: partOfDay(thing, day), conflicts: conflicts.filter(({ conflict }) => takesSomeOf(conflict, day)) })
    }
  }
  return new Map([...byDay].map(([day, dayThings]) => [day, withFreeTime(day, dayThings, calendar.today)]))
}

// What takes some of `day`, `dayThings`, with the stretches of its free time among them, if it has any, on the server's
// `today` (see "Free time" in docs/design/client/admin/calendrier.md).
function withFreeTime(day: string, dayThings: DayThing[], today: string): CalendarDay {
  // The days conflicts are found in, from the server's today.
  if (day < today || day >= addDays(today, HORIZON_DAYS)) return dayThings
  // Cancelled sessions don't take the studio.
  const taking = dayThings.map(({ thing }) => thing).filter((thing) => thing.kind !== 'session' || thing.status !== 'cancelled')
  const dayFrom = dayStart(day)
  // A day on which a session starts has no free time.
  if (taking.some((thing) => thing.kind === 'session' && Date.parse(thing.start) >= dayFrom)) return dayThings
  // By when each entry starts on the day, the things that started earlier at 00:00, and a thing before a stretch that
  // starts when it does, e.g. a cancelled session.
  const entries: [number, DayEntry][] = [
    ...dayThings.map((entry): [number, DayEntry] => [Math.max(Date.parse(entry.thing.start), dayFrom), entry]),
    ...freeStretches(day, taking).map(({ start, stretch }): [number, DayEntry] => [start, stretch]),
  ]
  return entries.sort(([a], [b]) => a - b).map(([, entry]) => entry)
}

// One of a thing's conflicts in the list, and whether their overlap misses the day it's listed on, so that the list says
// the day it starts.
export type ListedConflict = ThingConflict & { elsewhere: boolean }

// A thing in the list, on the first of the list's days it takes some of, `day`, with every one of its conflicts.
export type ListedThing = { day: string; thing: Thing; conflicts: ListedConflict[] }

// A month of the list, with its things, in order.
export type ListedMonth = { month: string; things: ListedThing[] }

// What the list shows of `calendar`, read for the days from `from` to `to`: every month they take some of, and each
// thing, once, on the first of these days it takes some of, by start, then end (see "The list" in
// docs/design/client/admin/calendrier.md).
export function listedMonths(calendar: Calendar, from: string, to: string): ListedMonth[] {
  const months: ListedMonth[] = []
  for (let month = monthOf(from); month <= monthOf(to); month = addMonths(month, 1)) months.push({ month, things: [] })
  for (const { thing, conflicts } of thingsWithConflicts(calendar)) {
    // Leaving out what's outside these days, which a calendar read for them doesn't have.
    const day = daysOf(thing, [from, to])[0]
    if (day === undefined) continue
    months
      .find(({ month }) => month === monthOf(day))!
      .things.push({ day, thing, conflicts: conflicts.map((each) => ({ ...each, elsewhere: !takesSomeOf(each.conflict, day) })) })
  }
  return months
}
