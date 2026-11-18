import type { Schema } from '../../api/client'
import { withCancelled } from '../../public-events'

// What Programmation lists: the events from RA, or the public events, as the rows it shows.

// An event as a row of the page shows it, whether it's read from RA or from the public events.
export type Row = {
  id: string
  title: string
  start: string
  end: string | null
  // What the row shows before its times, e.g. its venue and city.
  places: string[]
  lineup: string[]
  // The image the row shows as its flyer, or null for the placeholder.
  flyer: string | null
  // The event's page on RA, which its flyer, title and « voir sur RA » link to, or null when it has none.
  url: string | null
}

// What the page lists, in the server's order: the upcoming events the soonest first, and the past ones the most recent
// first.
export type Listing = { upcoming: Row[]; past: Row[] }

// The events read from RA, while the `evenements-publics` flag is off.
export function raListing(data: Schema<'RaEvents'>): Listing {
  const row = (event: Schema<'RaEvent'>): Row => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    places: [event.venue, event.city].filter((part) => part !== null),
    lineup: event.lineup,
    flyer: event.flyer ? flyerThumbnail(event.flyer) : null,
    url: event.url,
  })
  return { upcoming: data.upcoming.map(row), past: data.past.map(row) }
}

// What a synth meetup without performers has as its lineup, as Parking Radio's synth meetups do on RA.
const SYNTH_MEETUP_LINEUP = 'OPEN JAM'

// The performers of the sets that aren't cancelled, in order, each name once, or else OPEN JAM for a synth meetup that
// isn't cancelled. It follows the same rule as the lineup of a session's event on RA (`lineup` in
// server/src/sessions/ra-event.ts), except that other events without performers have none, rather than their title, and
// a cancelled synth meetup none rather than OPEN JAM.
function lineup(event: Schema<'Event'>): string[] {
  const names = event.sets.filter((set) => !set.cancelled).flatMap((set) => set.performers.map((performer) => performer.name))
  if (names.length > 0) return [...new Set(names)]
  return event.type === 'synth-meetup' && !event.cancelled ? [SYNTH_MEETUP_LINEUP] : []
}

// The public events, the announced sessions, once the `evenements-publics` flag is on. They're always at the studio, so
// they have no venue or city, and their flyers come from our server, full size.
export function eventsListing(data: Schema<'Events'>): Listing {
  const row = (event: Schema<'Event'>): Row => ({
    id: event.id,
    title: withCancelled(event.title, event.cancelled),
    start: event.start,
    end: event.end,
    places: [],
    lineup: lineup(event),
    flyer: event.flyer,
    url: event.raEvent,
  })
  return { upcoming: data.upcoming.map(row), past: data.past.map(row) }
}

// Flyers are full-size uploads (often 1080×1920), so rows load a small square crop from RA's image resizer,
// the same one ra.co uses. It takes the original URL in URL-safe base64.
function flyerThumbnail(flyer: string) {
  const encoded = btoa(flyer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `https://imgproxy.ra.co/_/quality:66/w:240/h:240/rt:fill/${encoded}`
}
