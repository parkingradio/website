import { and, eq, exists, gte, lt, not, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import { RECENT_PAST_EVENTS } from '../api/formats.js'
import { keyNamed } from '../artists/keys.js'
import type { Queryable } from '../db/connection.js'
import { collectiveMembers, sessions, setPerformers, sets } from '../db/schema.js'
import { endsAfter, hasEnded, sessionsWhere } from '../sessions/store.js'
import type { StoredSession } from '../sessions/store.js'

// What's public: the events, which are the announced sessions, and the artists and collectives they make public (see
// docs/design/server/events.md, and "Public profiles" in artists.md and collectives.md).

// Whether a session is an event.
const isEvent = eq(sessions.announced, true)

// Whether the collective whose id is `collectiveId` is public: it has a takeover that's an event.
export function isPublicCollective(db: Queryable, collectiveId: AnyColumn): SQL {
  return exists(
    db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.takeoverId, collectiveId), isEvent)),
  )
}

// Whether the artist whose id is `artistId` is public: they're a performer of a set of an event, whatever its status, or
// a member of a public collective.
export function isPublicArtist(db: Queryable, artistId: AnyColumn): SQL {
  const performer = db
    .select({ id: setPerformers.setId })
    .from(setPerformers)
    .innerJoin(sets, eq(sets.id, setPerformers.setId))
    .innerJoin(sessions, eq(sessions.id, sets.sessionId))
    .where(and(eq(setPerformers.artistId, artistId), isEvent))
  const member = db
    .select({ id: collectiveMembers.collectiveId })
    .from(collectiveMembers)
    .where(and(eq(collectiveMembers.artistId, artistId), isPublicCollective(db, collectiveMembers.collectiveId)))
  return sql`(${exists(performer)} or ${exists(member)})`
}

// The events, as sessions, with their sets. Upcoming and past are worked out from `now`, the time of the request.
export type EventsStore = {
  // Those that start at or after `from` and before `to`, when they're given, split into those whose end hasn't passed,
  // the soonest first, and those whose end has, the most recent first: only the RECENT_PAST_EVENTS most recent without
  // `from` and `to`. Sessions that start at the same time, all of them but one at most cancelled, are then ordered by
  // when they were added, so that the order doesn't change from one request to the next: the first added first among
  // the upcoming ones, and last among the past ones.
  list(range: { from?: Date; to?: Date; now: Date }): Promise<{ upcoming: StoredSession[]; past: StoredSession[] }>
  // The events of the calendar feed, those that end after `since`, a year back, in any order.
  feed(since: Date): Promise<StoredSession[]>
  // The key of the flyer named `name` (see `photoName` in artists/keys.ts) that an event has, or null when none has it.
  getFlyer(name: string): Promise<string | null>
}

export function eventsStore(db: Queryable): EventsStore {
  return {
    async list({ from, to, now }) {
      const inRange = and(isEvent, from && gte(sessions.startAt, from), to && lt(sessions.startAt, to))
      const ended = hasEnded(now)
      const [upcoming, past] = await Promise.all([
        sessionsWhere(db, and(inRange, not(ended))),
        sessionsWhere(db, and(inRange, ended), from || to ? undefined : RECENT_PAST_EVENTS),
      ])
      // sessionsWhere gives every upcoming one, the most recent first: reversed, they're the soonest first.
      return { upcoming: upcoming.toReversed(), past }
    },

    feed: (since) => sessionsWhere(db, and(isEvent, endsAfter(since))),

    getFlyer: (name) => keyNamed(db, sessions.flyerKey, 'sessions', name, isEvent),
  }
}
