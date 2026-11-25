import { inQuebecTime } from '../api/formats.js'
import { RA_PROMOTER_ID, RA_VENUE_ID } from '../ra-events/ra.js'
import { SYNTH_MEETUP_LINEUP, lineup } from '../sessions/lineup.js'
import type { SessionBody } from '../sessions/routes.js'

// A session's event on Resident Advisor, as RA's `EventInput`, which the bookmarklet sends to RA as it is (see "The
// event" in docs/design/server/ra-publication.md).

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
const RA_PLAYER_LINKS = [{ sourceId: 'https://www.youtube.com/@parkingdotradio' }, { sourceId: 'https://soundcloud.com/parkingdotradio' }]

// `instant` in Québec time, without its offset, to the millisecond, as RA takes it, e.g. "2026-11-20T21:00:00.000".
const raTime = (instant: string) => `${inQuebecTime(instant).slice(0, 'YYYY-MM-DDTHH:MM:SS'.length)}.000`

// The event of `session`, which starts at `start` and ends at `end`.
export function raEventInput(session: SessionBody, start: string, end: string) {
  return {
    title: session.title,
    startTime: raTime(start),
    endTime: raTime(end),
    lineup: raLineup(session),
    venueId: RA_VENUE_ID,
    promoterIds: [RA_PROMOTER_ID],
    content: session.effectiveDescription,
    promotionalLinks: RA_PROMOTIONAL_LINKS,
    playerLinks: RA_PLAYER_LINKS,
    submissionSource: 'SUBMITEVENTPAGE' as const,
  }
}
