import type { FastifyInstance } from 'fastify'
import { calendar as icalendar, dateTime, text } from '../core/icalendar.js'
import type { SessionType } from '../sessions/fields.js'
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
export const CANCELLED = '[CANCELLED]'
// How long browsers and calendar apps can keep the feed.
const CACHE_CONTROL = 'public, max-age=300'

// The description of a session's event: the names of its lineup, one per line, then a blank line and its description,
// either of which can be missing. A synth meetup without a lineup that isn't cancelled has OPEN JAM, as on Programmation.
export function eventDescription({ lineup, type, cancelled, description }: { lineup: { name: string }[]; type: SessionType; cancelled: boolean; description: string }): string {
  const names = lineup.length === 0 && type === 'synth-meetup' && !cancelled ? [SYNTH_MEETUP_LINEUP] : lineup.map((artist) => artist.name)
  return [names.join('\n'), description].filter((part) => part !== '').join('\n\n')
}

// A session's VEVENT, in the feed of the public events, or in an admin's own (see subscriptions/calendars.ts), which only
// differ by their UID, SUMMARY and URL.
export function sessionVevent(fields: { uid: string; now: Date; start: Date | string; end: Date | string; summary: string; cancelled: boolean; description: string; url: string }): string[] {
  const { uid, now, start, end, summary, cancelled, description, url } = fields
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dateTime(now)}`,
    `DTSTART:${dateTime(start)}`,
    `DTEND:${dateTime(end)}`,
    `SUMMARY:${text(summary)}`,
    ...(cancelled ? ['STATUS:CANCELLED'] : []),
    `LOCATION:${LOCATION}`,
    ...(description === '' ? [] : [`DESCRIPTION:${text(description)}`]),
    `URL:${url}`,
    'END:VEVENT',
  ]
}

function vevent(event: Event, { siteOrigin, now }: CalendarOptions): string[] {
  return sessionVevent({
    uid: `${event.id}@parking.radio`,
    now,
    start: event.start,
    end: event.end,
    summary: event.cancelled ? `${CANCELLED} ${event.title}` : event.title,
    cancelled: event.cancelled,
    description: eventDescription(event),
    url: event.raEvent ?? `${siteOrigin}/programmation`,
  })
}

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
