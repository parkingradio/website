import type { Reference } from '../api/schemas.js'
import type { Status } from './fields.js'

// The lineup of a session, which its public event gives (see docs/design/server/events.md), and its event on RA uses
// (see "Events on RA" in docs/design/server/sessions.md).

// What a synth meetup without performers has as its lineup where one is shown, as Parking Radio's synth meetups do on RA.
export const SYNTH_MEETUP_LINEUP = 'OPEN JAM'

// The performers of the sets that aren't cancelled, in the sets' order then their performers', each artist once, by id:
// two artists with the same name are both in it.
export function lineup(sets: { status: Status; performers: Reference[] }[]): Reference[] {
  const artists = new Map<string, Reference>()
  for (const set of sets) {
    if (set.status === 'cancelled') continue
    for (const performer of set.performers) if (!artists.has(performer.id)) artists.set(performer.id, performer)
  }
  return [...artists.values()]
}
