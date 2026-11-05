import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Queryable } from '../db/connection.js'

// For the tests: the rules of sessions and sets that must always hold, checked against the whole database, whatever
// enforces them (see "Rules" in docs/design/server/sessions.md). The rules that the database's own constraints enforce
// within a row or a reference, e.g. a set's duration, are left to them.

// Each rule, and what breaks it: none of the query's rows, when it holds. Each query gives what breaks its rule as one
// text column, `what`, so that they're all run at once.
const INVARIANTS: Record<string, SQL> = {
  // Without session_period, which the constraint that enforces it uses, so that this checks what a session's period is too.
  "Sessions don't overlap, unless one of them is cancelled or has no start": sql`
    select a.id || ' ' || b.id from sessions a join sessions b on a.id < b.id
    where a.status <> 'cancelled' and b.status <> 'cancelled'
      and a.start_at < b.start_at + b.duration_minutes * interval '1 minute'
      and b.start_at < a.start_at + a.duration_minutes * interval '1 minute'`,
  'A SoundCloud track belongs to at most one set': sql`
    select soundcloud_track_id from sets where soundcloud_track_id is not null group by 1 having count(*) > 1`,
  'A YouTube video belongs to at most one set': sql`
    select youtube_video_id from sets where youtube_video_id is not null group by 1 having count(*) > 1`,
  'A cancelled session only has cancelled sets': sql`
    select sets.id::text from sets join sessions on sessions.id = sets.session_id
    where sessions.status = 'cancelled' and sets.status <> 'cancelled'`,
  'A session starts from the year 2000 to the year 2999, in UTC': sql`
    select id::text from sessions where start_at < '2000-01-01T00:00:00Z' or start_at >= '3000-01-01T00:00:00Z'`,
}

// Throws an error that lists every rule that doesn't hold, with what breaks it.
export async function checkSessionsInvariants(db: Queryable) {
  const queries = Object.entries(INVARIANTS).map(([rule, violations]) => sql`select ${rule}::text as rule, what from (${violations}) as broken(what)`)
  const { rows } = await db.execute<{ rule: string; what: string }>(sql.join(queries, sql` union all `))
  if (rows.length > 0) throw new Error(`Broken rules:\n${rows.map(({ rule, what }) => `${rule}: ${what}`).join('\n')}`)
}
