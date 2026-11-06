import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { violatesConstraint } from '../api/errors.js'
import type { Reference } from '../api/schemas.js'
import type { Queryable } from '../db/connection.js'
import { artists, collectives, sessions, setPerformers, sets } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import { NO_SUCH_ARTIST, NO_SUCH_COLLECTIVE } from './fields.js'
import type { SentPerformer, Status } from './fields.js'

// Keeps sessions, their sets and the sets' performers in the database (see docs/design/server/sessions.md).

// A set, as the database keeps it, with its performers, in order.
export type SetRow = typeof sets.$inferSelect
export type StoredSet = SetRow & { performers: Reference[] }

// A session, as the database keeps it, with the collective whose takeover it is, and its sets, in order.
type SessionRow = typeof sessions.$inferSelect
export type StoredSession = SessionRow & { takeover: Reference | null; sets: StoredSet[] }

// What's saved of a session, or a set, when it's added or changed: everything but who did it, and its status.
export type SessionChanges = Pick<SessionRow, 'startAt' | 'durationMinutes' | 'type' | 'name' | 'takeoverId' | 'raEventId'>
export type SetChanges = Pick<
  SetRow,
  'offsetMinutes' | 'durationMinutes' | 'performanceTypes' | 'otherPerformanceType' | 'genres' | 'soundcloudTrackId' | 'soundcloudTrackUrl' | 'youtubeVideoId'
> & { performers: SentPerformer[] }
export type StatusChange = { status: Status; statusUpdatedBy: string; statusUpdatedAt: Date }

// Thrown when a session or a set can't be saved because the takeover's collective, or one of its performers, doesn't
// exist. The message says which.
export class NoSuchReference extends Error {}

// Thrown when saving a session or a set, or deleting a collective that has takeovers, would break one of the rules of
// sessions. The message says which, and `session` and `set` are what's in the way: `set` is a set, if it's one, and
// `session` is the session in the way, or that set's. Both are null only if it can't be found anymore, which only
// something outside the server could cause (see `checkingRules`).
export class Conflict extends Error {
  session: StoredSession | null
  set: StoredSet | null

  constructor(message: string, session: StoredSession | null, set: StoredSet | null = null) {
    super(message)
    this.session = session
    this.set = set
  }
}

export const SESSION_CANCELLED = 'This session is cancelled'

// The rules of sessions that the database enforces, by the constraint that enforces each one, with how to find what's
// in the way of the session or the set that broke it, as it would have been saved.
type SetLinks = Pick<SetRow, 'soundcloudTrackId' | 'youtubeVideoId'>
type Rule<Saved> = { message: string; other: (saved: Saved) => SQL }

const SESSION_RULES: Record<string, Rule<SessionChanges>> = {
  sessions_no_overlap: {
    message: 'Another session overlaps this one',
    // Like the constraint, which only fails for a session with a start.
    other: ({ startAt, durationMinutes }) =>
      sql`${sessions.status} <> 'cancelled' and session_period(${sessions.startAt}, ${sessions.durationMinutes}) && session_period(${startAt!.toISOString()}::timestamptz, ${durationMinutes}::integer)`,
  },
}

const SET_RULES: Record<string, Rule<SetLinks>> = {
  sets_soundcloud_track_id_idx: {
    message: "This SoundCloud track is another set's",
    // A unique index never fails on null.
    other: (set) => eq(sets.soundcloudTrackId, set.soundcloudTrackId!),
  },
  sets_youtube_video_id_idx: {
    message: "This YouTube video is another set's",
    other: (set) => eq(sets.youtubeVideoId, set.youtubeVideoId!),
  },
}

// The sessions, and their sets, as the admin pages manage them. Each method that's about one session or set returns null
// when there's no such session or set, which is the case of any id that isn't a UUID. Those that save a set return its
// session, as it is then.
export type SessionsStore = {
  // Those without a start first, the most recently added first, then the others, the most recent first, by start, then
  // by when they were added. With `artist`, only the sessions with a set that artist played, and with `takeover`, only
  // that collective's takeovers: none when there's no such artist or collective. With `from` or `to`, only those that
  // start at or after `from` and before `to`, which leaves out those without a start.
  list(filter?: { artist?: string; takeover?: string; from?: Date; to?: Date }): Promise<StoredSession[]>
  get(id: string): Promise<StoredSession | null>
  // Adds a session, as "planned". Throws a NoSuchReference or a Conflict.
  create(session: SessionChanges & { createdBy: string }): Promise<StoredSession>
  // Replaces the session's fields, but not its status or its sets. Throws a NoSuchReference or a Conflict.
  update(id: string, changes: SessionChanges & { updatedBy: string; updatedAt: Date }): Promise<StoredSession | null>
  // Cancelling a session cancels its sets that aren't, as the same admin, at the same time. Throws a Conflict.
  setStatus(id: string, change: StatusChange): Promise<StoredSession | null>
  // Returns false if the session didn't exist. Its sets are deleted with it, but not their performers.
  delete(id: string): Promise<boolean>
  // The set as the database keeps it, without its performers.
  getSet(id: string): Promise<SetRow | null>
  // Adds a set to the session `sessionId`, as "planned". Throws a NoSuchReference or a Conflict.
  addSet(sessionId: string, set: SetChanges & { createdBy: string }): Promise<StoredSession | null>
  // Replaces the set's fields and performers, but not its session or its status. Throws a NoSuchReference or a Conflict.
  updateSet(id: string, changes: SetChanges & { updatedBy: string; updatedAt: Date }): Promise<StoredSession | null>
  // Throws a Conflict.
  setSetStatus(id: string, change: StatusChange): Promise<StoredSession | null>
  // Returns false if the set didn't exist. Its performers stay.
  deleteSet(id: string): Promise<boolean>
}

// The sets of the sessions `sessionIds`, by session, in order, with their performers.
async function setsOf(db: Queryable, sessionIds: string[]): Promise<Map<string, StoredSet[]>> {
  const rows = await db
    .select()
    .from(sets)
    .where(inArray(sets.sessionId, sessionIds))
    .orderBy(sql`${sets.offsetMinutes} asc nulls last`, asc(sets.createdAt))
  const performers =
    rows.length === 0
      ? []
      : await db
          .select({ setId: setPerformers.setId, id: artists.id, name: artists.name })
          .from(setPerformers)
          .innerJoin(artists, eq(artists.id, setPerformers.artistId))
          .where(inArray(setPerformers.setId, rows.map((set) => set.id)))
          .orderBy(asc(setPerformers.position))
  const performersOf = new Map<string, Reference[]>()
  for (const { setId, ...performer } of performers) {
    if (!performersOf.has(setId)) performersOf.set(setId, [])
    performersOf.get(setId)!.push(performer)
  }
  const found = new Map<string, StoredSet[]>()
  for (const set of rows) {
    if (!found.has(set.sessionId)) found.set(set.sessionId, [])
    found.get(set.sessionId)!.push({ ...set, performers: performersOf.get(set.id) ?? [] })
  }
  return found
}

// The sessions that match `where`, in the order of `list`, or only the first `limit` of them, with their takeovers and
// their sets.
async function sessionsWhere(db: Queryable, where: SQL | undefined, limit?: number): Promise<StoredSession[]> {
  const query = db
    .select({ session: sessions, takeoverName: collectives.name })
    .from(sessions)
    .leftJoin(collectives, eq(collectives.id, sessions.takeoverId))
    .where(where)
    .orderBy(sql`${sessions.startAt} desc nulls first`, desc(sessions.createdAt))
  const rows = await (limit === undefined ? query : query.limit(limit))
  if (rows.length === 0) return []
  const setsBySession = await setsOf(
    db,
    rows.map(({ session }) => session.id),
  )
  return rows.map(({ session, takeoverName }) => ({
    ...session,
    takeover: session.takeoverId === null ? null : { id: session.takeoverId, name: takeoverName! },
    sets: setsBySession.get(session.id) ?? [],
  }))
}

// One of the takeovers of the collective `collectiveId`, the first in the order of `list`, or null when it has none.
// Deleting a collective checks it, in a transaction that holds the sessions' lock (see `lockSessions`), so that no
// takeover can be added in the meantime.
export async function takeoverOf(tx: Queryable, collectiveId: string): Promise<StoredSession | null> {
  return (await sessionsWhere(tx, eq(sessions.takeoverId, collectiveId), 1))[0] ?? null
}

async function sessionWithId(db: Queryable, id: string): Promise<StoredSession | null> {
  return (await sessionsWhere(db, eq(sessions.id, id)))[0] ?? null
}

// The set with `id`, and its session.
async function setWithId(db: Queryable, id: string): Promise<{ session: StoredSession; set: StoredSet } | null> {
  const [session] = await sessionsWhere(db, inArray(sessions.id, db.select({ id: sets.sessionId }).from(sets).where(eq(sets.id, id))))
  const set = session?.sets.find((set) => set.id === id)
  return set ? { session, set } : null
}

// Every transaction that writes sessions, sets or their performers takes this lock first, and so do deleting an artist,
// which writes them too, by deleting the artist's rows in set_performers, and deleting a collective, which mustn't have
// takeovers (see artists/store.ts and collectives/store.ts). They're done one at a time, so that:
// - Two sessions that would overlap can't both be inserted into the index of the exclusion constraint sessions_no_overlap,
//   then each wait for the other to end before it could tell whether they overlap, which Postgres would end as a
//   deadlock, rather than with the constraint's error.
// - What a write reads can't change until it's done: the rule that spans sessions and sets (a cancelled session only has
//   cancelled sets), whether the session, the set, the takeover's collective and the performers exist, and so whether
//   the foreign keys hold, without locking their rows, which would keep their profiles from being changed in the
//   meantime, and whether a collective that's deleted has takeovers.
// - Deleting a session and deleting an artist can't take the artist's rows in set_performers in opposite orders, and
//   deadlock.
// Every transaction that takes it takes it before any other lock, so it can't be part of a deadlock itself. The
// constraints still hold for anything that doesn't take it.
const SESSIONS_LOCK = 0x5e55 // "sess"

export async function lockSessions(tx: Queryable) {
  await tx.execute(sql`select pg_advisory_xact_lock(${SESSIONS_LOCK})`)
}

// Checks that the rows of `table` with `ids` exist, which they do until the transaction `tx`, which holds the sessions'
// lock, ends, since deleting them takes it too (see `lockSessions`). Throws a NoSuchReference with `error` otherwise.
async function checkAll(tx: Queryable, table: typeof artists | typeof collectives, ids: string[], error: string) {
  if (ids.length === 0) return
  if (!ids.every(isUuid)) throw new NoSuchReference(error)
  const found = await tx.select({ id: table.id }).from(table).where(inArray(table.id, ids))
  if (found.length < ids.length) throw new NoSuchReference(error)
}

// Checks that the collective whose takeover a session is, if any, exists (see `checkAll`).
function checkTakeover(tx: Queryable, takeoverId: string | null) {
  return checkAll(tx, collectives, takeoverId === null ? [] : [takeoverId], NO_SUCH_COLLECTIVE)
}

// Checks that a set's performers exist (see `checkAll`).
function checkPerformers(tx: Queryable, performers: SentPerformer[]) {
  return checkAll(
    tx,
    artists,
    performers.map((performer) => performer.id),
    NO_SUCH_ARTIST,
  )
}

// Saves the performers of the set `setId`, which has none, in order, once checkPerformers has checked them.
async function addPerformers(tx: Queryable, setId: string, performers: SentPerformer[]) {
  await tx.insert(setPerformers).values(performers.map(({ id }, position) => ({ setId, artistId: id, position })))
}

// Runs `write` in a savepoint of the transaction `tx`, and when it breaks the constraint of one of `rules`, throws a
// Conflict with what `inTheWay` finds in the way. That's looked for in `tx`, which holds the sessions' lock (see
// `lockSessions`), so it can only be missing if something outside the server, which doesn't take that lock, removed it
// in the meantime.
async function checkingRules<T, Saved>(
  tx: Queryable,
  rules: Record<string, Rule<Saved>>,
  inTheWay: (rule: Rule<Saved>) => Promise<Pick<Conflict, 'session' | 'set'>>,
  write: (savepoint: Queryable) => Promise<T>,
): Promise<T> {
  try {
    return await tx.transaction(write)
  } catch (error) {
    const constraint = Object.keys(rules).find((name) => violatesConstraint(error, name))
    if (!constraint) throw error
    const { session, set } = await inTheWay(rules[constraint])
    throw new Conflict(rules[constraint].message, session, set)
  }
}

// Runs `write`, which saves the session `id`, or a new one when it's null, as `session` says it then is, and throws a
// Conflict with the other session when it breaks a rule (see `checkingRules`).
function checkingSessionRules<T>(tx: Queryable, id: string | null, session: SessionChanges, write: (savepoint: Queryable) => Promise<T>) {
  return checkingRules(
    tx,
    SESSION_RULES,
    async (rule) => {
      const [other] = await sessionsWhere(tx, and(rule.other(session), id === null ? undefined : ne(sessions.id, id)))
      return { session: other ?? null, set: null }
    },
    write,
  )
}

// Runs `write`, which saves the set `id`, or a new one when it's null, as `set` says it then is, and throws a Conflict
// with the other set, and its session, when it breaks a rule (see `checkingRules`).
function checkingSetRules<T>(tx: Queryable, id: string | null, set: SetLinks, write: (savepoint: Queryable) => Promise<T>) {
  return checkingRules(
    tx,
    SET_RULES,
    async (rule) => {
      const [other] = await tx
        .select({ id: sets.id })
        .from(sets)
        .where(and(rule.other(set), id === null ? undefined : ne(sets.id, id)))
        .limit(1)
      return (other && (await setWithId(tx, other.id))) ?? { session: null, set: null }
    },
    write,
  )
}

// The session `id`, or null when there's no such session.
async function sessionRow(tx: Queryable, id: string): Promise<SessionRow | null> {
  const [session] = await tx.select().from(sessions).where(eq(sessions.id, id))
  return session ?? null
}

// The session of the set `id`, or null when there's no such set.
async function sessionOfSet(tx: Queryable, id: string): Promise<SessionRow | null> {
  const [found] = await tx.select({ session: sessions }).from(sets).innerJoin(sessions, eq(sessions.id, sets.sessionId)).where(eq(sets.id, id))
  return found?.session ?? null
}

export function sessionsStore(db: Queryable): SessionsStore {
  return {
    async list({ artist, takeover, from, to } = {}) {
      if ((artist !== undefined && !isUuid(artist)) || (takeover !== undefined && !isUuid(takeover))) return []
      const conditions: SQL[] = []
      if (artist !== undefined) {
        const played = db
          .select({ id: sets.sessionId })
          .from(sets)
          .innerJoin(setPerformers, eq(setPerformers.setId, sets.id))
          .where(eq(setPerformers.artistId, artist))
        conditions.push(inArray(sessions.id, played))
      }
      if (takeover !== undefined) conditions.push(eq(sessions.takeoverId, takeover))
      // A session without a start matches neither, since comparing null gives null.
      if (from !== undefined) conditions.push(gte(sessions.startAt, from))
      if (to !== undefined) conditions.push(lt(sessions.startAt, to))
      return sessionsWhere(db, and(...conditions))
    },

    async get(id) {
      return isUuid(id) ? sessionWithId(db, id) : null
    },

    create(session) {
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        await checkTakeover(tx, session.takeoverId)
        const [row] = await checkingSessionRules(tx, null, session, (savepoint) => savepoint.insert(sessions).values(session).returning({ id: sessions.id }))
        return (await sessionWithId(tx, row.id))!
      })
    },

    async update(id, changes) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        if (!(await sessionRow(tx, id))) return null
        await checkTakeover(tx, changes.takeoverId)
        await checkingSessionRules(tx, id, changes, (savepoint) => savepoint.update(sessions).set(changes).where(eq(sessions.id, id)))
        return sessionWithId(tx, id)
      })
    },

    async setStatus(id, change) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        // With its start and duration, which the status doesn't change.
        const before = await sessionRow(tx, id)
        if (!before) return null
        await checkingSessionRules(tx, id, before, (savepoint) => savepoint.update(sessions).set(change).where(eq(sessions.id, id)))
        if (change.status === 'cancelled') {
          await tx
            .update(sets)
            .set(change)
            .where(and(eq(sets.sessionId, id), ne(sets.status, 'cancelled')))
        }
        return sessionWithId(tx, id)
      })
    },

    async delete(id) {
      if (!isUuid(id)) return false
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const deleted = await tx.delete(sessions).where(eq(sessions.id, id)).returning({ id: sessions.id })
        return deleted.length > 0
      })
    },

    async getSet(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select().from(sets).where(eq(sets.id, id))
      return row ?? null
    },

    async addSet(sessionId, { performers, ...set }) {
      if (!isUuid(sessionId)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const session = await sessionRow(tx, sessionId)
        if (!session) return null
        if (session.status === 'cancelled') throw new Conflict(SESSION_CANCELLED, await sessionWithId(tx, sessionId))
        await checkPerformers(tx, performers)
        const row = { ...set, sessionId }
        const [{ id }] = await checkingSetRules(tx, null, row, (savepoint) => savepoint.insert(sets).values(row).returning({ id: sets.id }))
        await addPerformers(tx, id, performers)
        return sessionWithId(tx, sessionId)
      })
    },

    async updateSet(id, { performers, ...changes }) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const session = await sessionOfSet(tx, id)
        if (!session) return null
        await checkPerformers(tx, performers)
        await checkingSetRules(tx, id, changes, (savepoint) => savepoint.update(sets).set(changes).where(eq(sets.id, id)))
        await tx.delete(setPerformers).where(eq(setPerformers.setId, id))
        await addPerformers(tx, id, performers)
        return sessionWithId(tx, session.id)
      })
    },

    async setSetStatus(id, change) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const session = await sessionOfSet(tx, id)
        if (!session) return null
        if (session.status === 'cancelled' && change.status !== 'cancelled') {
          throw new Conflict(SESSION_CANCELLED, await sessionWithId(tx, session.id))
        }
        await tx.update(sets).set(change).where(eq(sets.id, id))
        return sessionWithId(tx, session.id)
      })
    },

    async deleteSet(id) {
      if (!isUuid(id)) return false
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const deleted = await tx.delete(sets).where(eq(sets.id, id)).returning({ id: sets.id })
        return deleted.length > 0
      })
    },
  }
}
