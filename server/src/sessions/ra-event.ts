import { RA_PROMOTER_ID, RA_VENUE_ID } from '../ra-events/ra.js'
import { SYNTH_MEETUP_LINEUP, lineup } from './lineup.js'
import type { RaEventContent, SessionBody } from './routes.js'

// The content of a session's event on Resident Advisor, which an admin creates there from it (see "Events on RA" in
// docs/design/server/sessions.md).

// One performer per line, from the session's lineup, the one its public event gives. RA needs a lineup, so a session
// without one has one of its own, unlike public events, which have none (see `lineup` in client/src/pages/programmation/
// listing.ts and `description` in events/calendar.ts).
function raLineup(session: SessionBody): string {
  const names = lineup(session.sets).map((artist) => artist.name)
  if (names.length > 0) return names.join('\n')
  return session.type === 'synth-meetup' ? SYNTH_MEETUP_LINEUP : session.title
}

// Parking Radio's links, and its media links, which every one of its events on RA has.
const RA_PROMOTIONAL_LINKS = [
  { title: 'parking.radio', url: 'https://parking.radio' },
  { title: 'instagram', url: 'https://www.instagram.com/parking.radio' },
]
const RA_PLAYER_LINKS = ['https://www.youtube.com/@parkingdotradio', 'https://soundcloud.com/parkingdotradio']

// The content of the event of `session`, as the endpoints return it.
export function raEventContent(session: SessionBody): RaEventContent {
  return {
    title: session.title,
    start: session.start,
    end: session.end,
    lineup: raLineup(session),
    venueId: RA_VENUE_ID,
    promoterIds: [RA_PROMOTER_ID],
    content: session.effectiveDescription,
    promotionalLinks: RA_PROMOTIONAL_LINKS,
    playerLinks: RA_PLAYER_LINKS,
  }
}
