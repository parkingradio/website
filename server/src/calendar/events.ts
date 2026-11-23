import ICAL from 'ical.js'
import { instantIn, isTimeZone } from '../api/formats.js'
import type { FeedKind } from './fields.js'
import { FeedReadError, refused } from './fetch.js'

// What a read keeps of a feed: its events, from the iCalendar text its link gave (see "Events" in
// docs/design/server/calendar.md).
//
// ical.js parses the text, and goes through recurring events' occurrences, in their local time, but the server turns the
// local times into instants itself, with `instantIn`, like RA events' times, rather than with ical.js, which can't read a
// time zone that the feed doesn't define, and doesn't resolve the times that the clocks skip or show twice as RFC 5545
// says. ical.js is only trusted with the time zones the feed defines whose names aren't IANA's.

// An event, or an occurrence of a recurring event: from `start`, included, to `end`, excluded. Only occupations have a
// title, which is "" for none: quiet time's are never kept.
export type CalendarEvent = { start: Date; end: Date; title: string | null }

// How many occurrences a recurring event can have until the end of the time a read keeps before it's left out, e.g. one
// every minute, and how many events and occurrences a read can go through in all, before it fails. ical.js can only go
// through an event's occurrences from its first one, so the events that started long ago count all of theirs. The
// limits keep a read from holding the server for too long: it doesn't wait for anything while it goes through them.
export const MAX_OCCURRENCES_PER_EVENT = 20_000
export const MAX_OCCURRENCES_PER_READ = 50_000

// The time a read at `readAt` keeps the events of: from a year before it to two years after it.
export function keptTime(readAt: Date): { from: Date; to: Date } {
  const yearsAfter = (years: number) => {
    const date = new Date(readAt)
    date.setUTCFullYear(date.getUTCFullYear() + years)
    return date
  }
  return { from: yearsAfter(-1), to: yearsAfter(2) }
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

// The instant `time` is, in ms, when it's a value of a property with the time zone `tzid`, if any: whole days start at
// 00:00 in Québec time.
function instantOf(time: ICAL.Time, tzid: string | null): number {
  const day = `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`
  const local = `${day}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`
  let ms: number
  if (time.isDate) ms = instantIn(null, `${day}T00:00`).getTime()
  else if (time.zone === ICAL.Timezone.utcTimezone) ms = Date.parse(`${local}Z`)
  else if (tzid && isTimeZone(tzid)) ms = instantIn(tzid, local).getTime()
  // The feed's own definition of a time zone whose name isn't IANA's (a `VTIMEZONE`), which ical.js reads it in.
  else if (tzid && time.zone && time.zone !== ICAL.Timezone.localTimezone) ms = time.toUnixTime() * 1000
  // Without a time zone, or with one that's neither.
  else ms = instantIn(null, local).getTime()
  if (!Number.isFinite(ms)) throw new Error('A time that is not valid')
  return ms
}

// The time zone of a property of `event`, e.g. its DTSTART, if it has one.
function tzidOf(event: ICAL.Event, property: string): string | null {
  const tzid = event.component.getFirstProperty(property)?.getParameter('tzid')
  return typeof tzid === 'string' ? tzid : null
}

// How long the occurrences of a timed event last, in ms: the time from its DTSTART to its DTEND, or its DURATION.
function durationOf(event: ICAL.Event): number {
  if (event.component.hasProperty('dtend')) {
    return instantOf(event.endDate, tzidOf(event, 'dtend')) - instantOf(event.startDate, tzidOf(event, 'dtstart'))
  }
  const duration = event.component.getFirstPropertyValue('duration')
  return duration instanceof ICAL.Duration ? duration.toSeconds() * 1000 : 0
}

const isCancelled = (event: ICAL.Event) => String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED'

// The events and occurrences of a feed that has `kind`, from its text, that take some of the time from `from` to `to`,
// sorted by when they start, and how many events were left out because they couldn't be read, or had too many
// occurrences. Throws a FeedReadError when the text isn't a calendar, or has too many events and occurrences in all.
export function calendarEvents(text: string, kind: FeedKind, { from, to }: { from: Date; to: Date }): { events: CalendarEvent[]; skipped: number } {
  let parsed: unknown
  try {
    parsed = ICAL.parse(text)
  } catch {
    // ical.js's message quotes the text.
    throw refused("its answer isn't valid iCalendar")
  }
  if (!Array.isArray(parsed) || parsed[0] !== 'vcalendar') throw refused("its answer isn't an iCalendar calendar")
  const calendar = new ICAL.Component(parsed)

  // The events by their UID: those that recur, or don't, and the occurrences changed on their own, which ical.js relates
  // to their recurring event only when it's told which they are. Events without a UID are on their own.
  const groups: { events: ICAL.Component[]; changed: ICAL.Component[] }[] = []
  const byUid = new Map<string, (typeof groups)[number]>()
  for (const vevent of calendar.getAllSubcomponents('vevent')) {
    const uid = vevent.getFirstPropertyValue('uid')
    let group = typeof uid === 'string' && uid !== '' ? byUid.get(uid) : undefined
    if (!group) {
      group = { events: [], changed: [] }
      groups.push(group)
      if (typeof uid === 'string' && uid !== '') byUid.set(uid, group)
    }
    ;(vevent.hasProperty('recurrence-id') ? group.changed : group.events).push(vevent)
  }

  const events: CalendarEvent[] = []
  let skipped = 0
  let occurrences = 0
  const fromMs = from.getTime()
  const toMs = to.getTime()

  // The title of an occurrence of `event`, which only occupations keep.
  // ical.js's values are slices of the feed's text, which they would keep in memory: the titles kept are copies.
  const titleOf = (event: ICAL.Event) =>
    kind === 'occupation' ? Buffer.from(String(event.component.getFirstPropertyValue('summary') ?? '').trim()).toString() : null

  // The occurrences of `event` that take some of the time from `from` to `to`, or null when it has too many. An event
  // that doesn't recur has one.
  function occurrencesOf(event: ICAL.Event): CalendarEvent[] | null {
    const found: CalendarEvent[] = []
    const tzid = tzidOf(event, 'dtstart')
    const cancelled = isCancelled(event)
    const title = titleOf(event)
    let duration: number | undefined
    // ical.js's details of an occurrence say whether it was changed on its own, but they're slow to get: only for the
    // events that have such occurrences, and for whole days, whose end they give.
    const changes = Object.keys(event.exceptions).length > 0 || event.rangeExceptions.length > 0
    // ical.js gives no occurrences for an occurrence changed on its own, which is an event of its own here.
    const alone = [event.startDate]
    const iterator = event.isRecurrenceException() ? { next: () => alone.pop() ?? null } : event.iterator()
    for (let count = 1; ; count++) {
      const next = iterator.next()
      if (!next) return found
      if (++occurrences > MAX_OCCURRENCES_PER_READ) {
        throw refused(`it has more than ${MAX_OCCURRENCES_PER_READ} events and occurrences`)
      }
      if (count > MAX_OCCURRENCES_PER_EVENT) return null
      const original = instantOf(next, tzid)
      if (original >= toMs) return found
      const details = changes || next.isDate ? event.getOccurrenceDetails(next) : null
      const item = details?.item ?? event
      if (item === event ? cancelled : isCancelled(item)) continue
      const startDate = details?.startDate ?? next
      const start = startDate === next ? original : instantOf(startDate, tzidOf(item, 'dtstart'))
      let end: number
      if (startDate.isDate) end = instantOf(details!.endDate, null)
      else if (item === event) end = start + (duration ??= durationOf(event))
      else end = start + durationOf(item)
      if (end <= start || end <= fromMs || start >= toMs) continue
      found.push({ start: new Date(start), end: new Date(end), title: item === event ? title : titleOf(item) })
    }
  }

  for (const { events: recurring, changed } of groups) {
    // Occurrences changed on their own whose recurring event isn't in the feed are events of their own.
    const alone = recurring.length === 0
    for (const vevent of alone ? changed : recurring) {
      let found: CalendarEvent[] | null = null
      try {
        const event = alone ? new ICAL.Event(vevent) : new ICAL.Event(vevent, { exceptions: changed })
        if (vevent.hasProperty('dtstart')) found = occurrencesOf(event)
      } catch (error) {
        // Any other error is the event's: e.g. a value that isn't valid, which ical.js only finds as it reads it.
        if (error instanceof FeedReadError) throw error
      }
      if (found) events.push(...found)
      else skipped++
    }
  }
  events.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime())
  return { events, skipped }
}
