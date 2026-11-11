import { RA_PROMOTER_ID, RA_VENUE_ID } from '../events/ra.js'
import type { RaEventContent, SessionBody } from './routes.js'

// The content of a session's event on Resident Advisor, which an admin creates there from it (see "Events on RA" in
// docs/design/server/sessions.md).

// What a synth meetup without performers has as its lineup, as Parking Radio's synth meetups do on RA.
const SYNTH_MEETUP_LINEUP = 'OPEN JAM'

// One performer per line, from the sets that aren't cancelled, in order, without repeated lines. RA needs a lineup, so a
// session without such performers has one of its own.
function lineup(session: SessionBody): string {
  const names = session.sets.filter((set) => set.status !== 'cancelled').flatMap((set) => set.performers.map((performer) => performer.name))
  if (names.length > 0) return [...new Set(names)].join('\n')
  return session.type === 'synth-meetup' ? SYNTH_MEETUP_LINEUP : session.title
}

// The content of the event of `session`, as the endpoints return it.
export function raEventContent(session: SessionBody): RaEventContent {
  return {
    title: session.title,
    start: session.start,
    end: session.end,
    lineup: lineup(session),
    venueId: RA_VENUE_ID,
    promoterIds: [RA_PROMOTER_ID],
    content: session.effectiveDescription,
  }
}
