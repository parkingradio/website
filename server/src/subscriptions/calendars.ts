import { createHash } from 'node:crypto'
import { addDays, inQuebecTime, quebecDay } from '../api/formats.js'
import type { StoredFeed } from '../calendar/feeds.js'
import type { FeedRead } from '../calendar/reads.js'
import { calendar, date, dateTime, text } from '../core/icalendar.js'
import { serverName } from '../core/config.js'
import { CANCELLED, eventDescription, sessionVevent } from '../events/calendar.js'
import { effectiveDescription } from '../sessions/descriptions.js'
import { after, sessionTitle } from '../sessions/fields.js'
import { lineup } from '../sessions/lineup.js'
import type { StoredSession } from '../sessions/store.js'

// Admins' own calendar feeds, of the sessions and of the occupations, in iCalendar (see
// docs/design/server/subscriptions.md).

// How often subscribers are asked to read them again: as often as the server reads the calendar feeds.
const REFRESH_INTERVAL = 'PT15M'
// How sessions that aren't announced are marked, after CANCELLED.
const UNANNOUNCED = '[UNANNOUNCED]'
// How the calendar feeds whose last read failed are marked.
const NOT_READ = '[NOT READ]'

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

// The feed of the sessions `rows`, which all have a start, in any order.
export function sessionsCalendar(rows: StoredSession[], { siteOrigin, environment, now }: CalendarOptions): string {
  const vevent = (row: StoredSession): string[] => {
    const cancelled = row.status === 'cancelled'
    return sessionVevent({
      uid: `session-${row.id}@parking.radio`,
      now,
      start: row.startAt!,
      end: after(row.startAt!, row.durationMinutes),
      summary: [cancelled && CANCELLED, !row.announced && UNANNOUNCED, sessionTitle(row)].filter(Boolean).join(' '),
      cancelled,
      description: eventDescription({ ...row, lineup: lineup(row.sets), cancelled, description: effectiveDescription(row) }),
      url: `${siteOrigin}/admin/sessions/${row.id}`,
    })
  }
  return calendar({ name: calendarName('sessions', environment), refreshInterval: REFRESH_INTERVAL, components: rows.map(vevent) })
}

// A feed, with what was read from it as it is now (see `CalendarReads.of`).
export type FeedWithRead = { feed: Pick<StoredFeed, 'id' | 'name'>; read: FeedRead }

// A start or an end: a DATE in Québec for what takes whole days, and a DATE-TIME otherwise.
const time = (property: 'DTSTART' | 'DTEND', instant: Date, wholeDay: boolean) =>
  wholeDay ? `${property};VALUE=DATE:${date(quebecDay(instant))}` : `${property}:${dateTime(instant)}`

// The feed of the occupations of `feeds`, as they were read, and of the feeds whose last read failed, in the order of
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
        'END:VEVENT',
      ]
    }),
  )

  const today = quebecDay(now)
  const notRead = feeds
    .filter(({ read }) => read.error !== null)
    .map(({ feed, read }) => {
      const since = read.readAt
        ? `It was last read successfully on ${inQuebecTime(read.readAt).slice(0, 16).replace('T', ' ')}, Québec time.`
        : "It hasn't been read successfully since the server started."
      return [
        'BEGIN:VEVENT',
        `UID:feed-${feed.id}@parking.radio`,
        stamp,
        `DTSTART;VALUE=DATE:${date(today)}`,
        `DTEND;VALUE=DATE:${date(addDays(today, 1))}`,
        `SUMMARY:${text(`${NOT_READ} ${feed.name}`)}`,
        `DESCRIPTION:${text(`The last read of this calendar feed failed: ${read.error}\n${since}`)}`,
        `URL:${siteOrigin}/admin/calendrier`,
        'END:VEVENT',
      ]
    })

  return calendar({ name: calendarName('occupations', environment), refreshInterval: REFRESH_INTERVAL, components: [...occupations, ...notRead] })
}
