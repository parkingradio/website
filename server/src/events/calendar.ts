import type { FastifyInstance } from 'fastify'
import { calendar as icalendar, dateTime, text } from '../core/icalendar.js'
import { SYNTH_MEETUP_LINEUP } from '../sessions/lineup.js'
import { event } from './routes.js'
import type { Event } from './routes.js'
import type { EventsStore } from './store.js'

// The calendar feed of the events, in iCalendar (RFC 5545), which calendar apps subscribe to (see `GET /calendar.ics` in
// docs/design/server/events.md). It's only built from the public events, so it can't make anything else public.

const NAME = 'Parking Radio'
// How often subscribers are asked to read the feed again.
const REFRESH_INTERVAL = 'PT1H'
const LOCATION = 'parking.radio'
// How cancelled events are marked, as on Programmation (`CANCELLED` in client/src/public-events.ts), the way RA marks its
// cancelled events.
const CANCELLED = '[CANCELLED]'
// How long browsers and calendar apps can keep the feed.
const CACHE_CONTROL = 'public, max-age=300'

// The description of an event: the names of its lineup, one per line, then a blank line and its description, either of
// which can be missing. A synth meetup without a lineup that isn't cancelled has OPEN JAM, as on Programmation.
function description(event: Event): string {
  const names = event.lineup.length === 0 && event.type === 'synth-meetup' && !event.cancelled ? [SYNTH_MEETUP_LINEUP] : event.lineup.map((artist) => artist.name)
  return [names.join('\n'), event.description].filter((part) => part !== '').join('\n\n')
}

type VeventOptions = {
  uid: string
  url: string
  // When the feed is made, which is every event's DTSTAMP.
  now: Date
  // What its title is marked with, after CANCELLED for a cancelled event.
  marks?: string[]
  // Whether it leaves the time it takes free in calendar apps (TRANSP:TRANSPARENT), rather than busy, as they make it by
  // default.
  transparent?: boolean
}

// An event's VEVENT, as this feed has it, or as an admin's calendar of sessions has it, with a UID, a URL and marks of its
// own (see admin-calendars/calendars.ts), so that both give sessions the same way.
export function eventVevent(event: Event, { uid, url, now, marks = [], transparent = false }: VeventOptions): string[] {
  const about = description(event)
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dateTime(now)}`,
    `DTSTART:${dateTime(event.start)}`,
    `DTEND:${dateTime(event.end)}`,
    `SUMMARY:${text([...(event.cancelled ? [CANCELLED] : []), ...marks, event.title].join(' '))}`,
    ...(event.cancelled ? ['STATUS:CANCELLED'] : []),
    ...(transparent ? ['TRANSP:TRANSPARENT'] : []),
    `LOCATION:${LOCATION}`,
    ...(about === '' ? [] : [`DESCRIPTION:${text(about)}`]),
    `URL:${url}`,
    'END:VEVENT',
  ]
}

const vevent = (event: Event, { siteOrigin, now }: CalendarOptions) =>
  eventVevent(event, { uid: `${event.id}@parking.radio`, url: event.raEvent ?? `${siteOrigin}/programmation`, now })

type CalendarOptions = {
  // Where the site is, whose Programmation page is the link of events without one on RA.
  siteOrigin: string
  // When the feed is made, which is every event's DTSTAMP.
  now: Date
}

// The feed of `events`, in any order.
export function calendar(events: Event[], options: CalendarOptions): string {
  return icalendar({ name: NAME, refreshInterval: REFRESH_INTERVAL, components: events.map((event) => vevent(event, options)) })
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
    const events = (await store.feed(now)).map(event)
    return reply.type('text/calendar; charset=utf-8').header('cache-control', CACHE_CONTROL).send(calendar(events, { siteOrigin, now }))
  })
}
