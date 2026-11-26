import { createHash } from 'node:crypto'
import { addDays, inQuebecTime, quebecDay } from '../api/formats.js'
import type { StoredFeed } from '../calendar/feeds.js'
import type { FeedRead } from '../calendar/reads.js'
import { serverName } from '../core/config.js'
import { TRANSPARENT, calendar, date, dateTime, text } from '../core/icalendar.js'
import { eventVevent } from '../events/calendar.js'
import { event } from '../events/routes.js'
import type { StoredSession } from '../sessions/store.js'

// Admins' calendars, of the sessions, the occupations and the available time, in iCalendar (see
// docs/design/server/admin-calendars.md).

// How often subscribers are asked to read them again: as often as the server reads the calendar feeds.
const REFRESH_INTERVAL = 'PT15M'
// How sessions that aren't announced are marked, after `[CANCELLED]`.
const UNANNOUNCED = '[UNANNOUNCED]'
// How the calendar feeds whose last read failed are marked.
const REFRESH_ERROR = '[REFRESH ERROR]'
// What each stretch of available time is, in French, as Calendrier calls it, like the calendar's name.
const AVAILABLE = 'disponible'

export type CalendarOptions = {
  // Where the site is, which the events link to.
  siteOrigin: string
  // The server's environment, which the calendars' names have outside production.
  environment: string
  // When the calendar is made, which is every event's DTSTAMP.
  now: Date
}

// A calendar's name, e.g. "Parking Radio (test) · sessions" in the test environment.
const calendarName = (what: string, environment: string) => `${serverName(environment)} · ${what}`

// The calendar of the sessions `rows`, which all have a start, in any order. Each one is the VEVENT of its event in
// /calendar.ics, as if it were announced, with its own UID and URL.
export function sessionsCalendar(rows: StoredSession[], { siteOrigin, environment, now }: CalendarOptions): string {
  const vevent = (row: StoredSession) =>
    eventVevent(event(row), {
      uid: `session-${row.id}@parking.radio`,
      url: `${siteOrigin}/admin/sessions/${row.id}`,
      now,
      marks: row.announced ? [] : [UNANNOUNCED],
    })
  return calendar({ name: calendarName('sessions', environment), refreshInterval: REFRESH_INTERVAL, components: rows.map(vevent) })
}

// A feed, with what was read from it as it is now (see `CalendarReads.of`).
export type FeedWithRead = { feed: Pick<StoredFeed, 'id' | 'name'>; read: FeedRead }

// A start or an end: a DATE in Québec for what takes whole days, and a DATE-TIME otherwise.
const time = (property: 'DTSTART' | 'DTEND', instant: Date, wholeDay: boolean) =>
  wholeDay ? `${property};VALUE=DATE:${date(quebecDay(instant))}` : `${property}:${dateTime(instant)}`

// Whether the feed's last read failed.
const failed = ({ read }: FeedWithRead) => read.error !== null

// The event about a feed whose last read failed, on today in Québec, with `uid`, the feed's in its calendar.
function refreshError({ feed, read }: FeedWithRead, { uid, siteOrigin, now }: { uid: string; siteOrigin: string; now: Date }): string[] {
  const today = quebecDay(now)
  const since = read.readAt
    ? `It was last read successfully on ${inQuebecTime(read.readAt).slice(0, 16).replace('T', ' ')}, Québec time.`
    : "It hasn't been read successfully since the server started."
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dateTime(now)}`,
    `DTSTART;VALUE=DATE:${date(today)}`,
    `DTEND;VALUE=DATE:${date(addDays(today, 1))}`,
    `SUMMARY:${text(`${REFRESH_ERROR} ${feed.name}`)}`,
    TRANSPARENT,
    `DESCRIPTION:${text(`The last read of this calendar feed failed. ${read.error}.\n${since}`)}`,
    `URL:${siteOrigin}/admin/calendrier`,
    'END:VEVENT',
  ]
}

// The calendar of the occupations of `feeds`, as they were read, and of the feeds whose last read failed, in the order of
// `feeds`.
export function occupationsCalendar(feeds: FeedWithRead[], { siteOrigin, environment, now }: CalendarOptions): string {
  const stamp = `DTSTAMP:${dateTime(now)}`
  // How many occupations had each UID made from what they are, so that those that are the same have UIDs of their own.
  const seen = new Map<string, number>()

  const occupations = feeds.flatMap(({ feed, read }) =>
    read.events.map(({ start, end, wholeDay, title }) => {
      const made = createHash('sha256')
        .update(JSON.stringify([feed.id, start.toISOString(), end.toISOString(), wholeDay, title]))
        .digest('hex')
        .slice(0, 32)
      const count = (seen.get(made) ?? 0) + 1
      seen.set(made, count)
      return [
        'BEGIN:VEVENT',
        `UID:occupation-${made}${count === 1 ? '' : `-${count}`}@parking.radio`,
        stamp,
        time('DTSTART', start, wholeDay),
        time('DTEND', end, wholeDay),
        `SUMMARY:${text(title === '' ? feed.name : `${title} (${feed.name})`)}`,
        TRANSPARENT,
        'END:VEVENT',
      ]
    }),
  )

  const refreshErrors = feeds.filter(failed).map((feed) => refreshError(feed, { uid: `feed-${feed.feed.id}@parking.radio`, siteOrigin, now }))
  return calendar({ name: calendarName('occupations', environment), refreshInterval: REFRESH_INTERVAL, components: [...occupations, ...refreshErrors] })
}

// The calendar of the available time `stretches`, by start, which don't overlap, and of the feeds whose last read failed,
// among `feeds`, in their order.
export function availabilityCalendar(stretches: { start: Date; end: Date }[], feeds: FeedWithRead[], { siteOrigin, environment, now }: CalendarOptions): string {
  const available = stretches.map(({ start, end }) => [
    'BEGIN:VEVENT',
    // Stretches never overlap, so their starts tell them apart. One whose start changes is another event, e.g. the one that
    // goes on at 00:00 today, which the year ahead cuts there, every day: calendar apps then replace it, which is harmless.
    `UID:availability-${environment}-${dateTime(start)}@parking.radio`,
    `DTSTAMP:${dateTime(now)}`,
    // Always times, even from 00:00 to 00:00, unlike what takes whole days.
    `DTSTART:${dateTime(start)}`,
    `DTEND:${dateTime(end)}`,
    `SUMMARY:${AVAILABLE}`,
    TRANSPARENT,
    `URL:${siteOrigin}/admin/calendrier?day=${quebecDay(start)}`,
    'END:VEVENT',
  ])
  const refreshErrors = feeds.filter(failed).map((feed) => refreshError(feed, { uid: `availability-feed-${feed.feed.id}@parking.radio`, siteOrigin, now }))
  return calendar({ name: calendarName('disponibilités', environment), refreshInterval: REFRESH_INTERVAL, components: [...available, ...refreshErrors] })
}
