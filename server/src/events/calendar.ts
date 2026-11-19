import type { FastifyInstance } from 'fastify'
import { SYNTH_MEETUP_LINEUP } from '../sessions/lineup.js'
import { event } from './routes.js'
import type { Event } from './routes.js'
import type { EventsStore } from './store.js'

// The calendar feed of the events, in iCalendar (RFC 5545), which calendar apps subscribe to (see `GET /calendar.ics` in
// docs/design/server/events.md). It's only built from the public events, so it can't make anything else public.

const NAME = 'Parking Radio'
const PRODUCT = '-//Parking Radio//Calendrier//FR'
// How often subscribers are asked to read the feed again, for the apps that take it (RFC 7986 and Outlook's own).
const REFRESH_INTERVAL = 'PT1H'
const LOCATION = 'parking.radio'
// How cancelled events are marked, as on Programmation (`CANCELLED` in client/src/public-events.ts), the way RA marks its
// cancelled events.
const CANCELLED = '[CANCELLED]'
// Lines are at most this many octets long, without their CRLF.
const MAX_LINE_OCTETS = 75
// How long browsers and calendar apps can keep the feed.
const CACHE_CONTROL = 'public, max-age=300'

// A TEXT value: backslashes, semicolons, commas and line breaks escaped, and the control characters other than tabs, which
// it can't hold, dropped.
export function text(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\P{Cc}\t\n]/gu, '')
    .replace(/[\\;,]/g, (character) => `\\${character}`)
    .replace(/\n/g, '\\n')
}

// A content line, folded into lines of at most MAX_LINE_OCTETS octets, continued on the next with a space, which counts
// towards them. Lines are only folded between characters, never inside one's UTF-8 octets.
export function contentLine(line: string): string {
  if (Buffer.byteLength(line) <= MAX_LINE_OCTETS) return line
  const lines: string[] = []
  let current = ''
  let octets = 0
  for (const character of line) {
    const size = Buffer.byteLength(character)
    if (octets + size > MAX_LINE_OCTETS) {
      lines.push(current)
      current = ' '
      octets = 1
    }
    current += character
    octets += size
  }
  lines.push(current)
  return lines.join('\r\n')
}

// A DATE-TIME in UTC, e.g. 20261115T020000Z.
function dateTime(instant: string | Date): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
}

// The lineup, one name per line, then a blank line and the description, either of which can be missing. A synth meetup
// without a lineup that isn't cancelled has OPEN JAM, as on Programmation.
function description(event: Event): string {
  const names = event.lineup.map((artist) => artist.name)
  if (names.length === 0 && event.type === 'synth-meetup' && !event.cancelled) names.push(SYNTH_MEETUP_LINEUP)
  return [names.join('\n'), event.description].filter((part) => part !== '').join('\n\n')
}

function vevent(event: Event, { siteOrigin, now }: CalendarOptions): string[] {
  const about = description(event)
  return [
    'BEGIN:VEVENT',
    `UID:${event.id}@parking.radio`,
    `DTSTAMP:${dateTime(now)}`,
    `DTSTART:${dateTime(event.start)}`,
    `DTEND:${dateTime(event.end)}`,
    `SUMMARY:${text(event.cancelled ? `${CANCELLED} ${event.title}` : event.title)}`,
    ...(event.cancelled ? ['STATUS:CANCELLED'] : []),
    `LOCATION:${LOCATION}`,
    ...(about === '' ? [] : [`DESCRIPTION:${text(about)}`]),
    `URL:${event.raEvent ?? `${siteOrigin}/programmation`}`,
    'END:VEVENT',
  ]
}

type CalendarOptions = {
  // Where the site is, whose Programmation page is the link of events without one on RA.
  siteOrigin: string
  // When the feed is made, which is every event's DTSTAMP.
  now: Date
}

// The feed of `events`, in any order.
export function calendar(events: Event[], options: CalendarOptions): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT}`,
    `NAME:${NAME}`,
    `X-WR-CALNAME:${NAME}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
    ...events.flatMap((event) => vevent(event, options)),
    'END:VCALENDAR',
  ]
  return lines.map((line) => `${contentLine(line)}\r\n`).join('')
}

type CalendarRoutesOptions = {
  store: EventsStore
  // Where the site is, whose Programmation page the feed links to.
  siteOrigin: string
}

// The feed isn't part of the API, since it isn't JSON. Its route has no schema, so it isn't in openapi.json, nor a tool of
// the MCP server, and it can't be one of the routes of `zodRoutes`, which need one.
export async function calendarRoutes(app: FastifyInstance, { store, siteOrigin }: CalendarRoutesOptions) {
  app.get('/calendar.ics', async (_request, reply) => {
    // Every event that starts at most a year before the request, and every upcoming one.
    const now = new Date()
    const since = new Date(now)
    since.setUTCFullYear(since.getUTCFullYear() - 1)
    const events = (await store.feed({ since, now })).map(event)
    return reply.type('text/calendar; charset=utf-8').header('cache-control', CACHE_CONTROL).send(calendar(events, { siteOrigin, now }))
  })
}
