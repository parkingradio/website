import { and, asc, count, desc, eq, exists, gt, gte, inArray, lt, ne, not, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { violatesConstraint } from '../api/errors.js'
import type { Reference } from '../api/schemas.js'
import { REJECTED_APPLICATION } from '../applications/fields.js'
import type { ApplicationDecision } from '../applications/fields.js'
import type { Queryable } from '../db/connection.js'
import { applications, artists, collectives, sessions, setPerformers, sets } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import {
  NOT_THE_SESSIONS_APPLICATION,
  NOT_THE_SETS_APPLICATION,
  NO_SUCH_APPLICATION,
  NO_SUCH_ARTIST,
  NO_SUCH_COLLECTIVE,
  NO_SUCH_SESSION,
  brokenSessionRule,
} from './fields.js'
import type { BrokenRule, SentPerformer, Status } from './fields.js'

// Keeps sessions, their sets and the sets' performers in the database (see docs/design/server/sessions.md).

// The application a set or a session comes from, as they give it.
export type StoredApplicationLink = { id: string; receivedAt: Date }

// A set, as the database keeps it, with its performers, in order, and its application. Its position is its place among
// its session's sets, from 0 (see "sets" in db/schema.ts).
export type SetRow = typeof sets.$inferSelect
export type StoredSet = SetRow & { performers: Reference[]; application: StoredApplicationLink | null }

// A session, as the database keeps it, with the collective whose takeover it is, its application, and its sets, in order.
export type SessionRow = typeof sessions.$inferSelect
export type StoredSession = SessionRow & { takeover: Reference | null; application: StoredApplicationLink | null; sets: StoredSet[] }

// What's saved of a session, or a set, when it's added or changed: everything but who did it, and its status, and a
// session's flyer, which is where it's stored (see `Photos` in artists/store.ts), and its MIME type, or nulls for none,
// and a set's position, which the store gives it.
export type SessionChanges = Pick<SessionRow, 'startAt' | 'durationMinutes' | 'type' | 'name' | 'takeoverId' | 'applicationId' | 'raEventId' | 'description'>
export type StoredFlyer = { flyerKey: string; flyerType: string } | { flyerKey: null; flyerType: null }
export type SetChanges = Pick<
  SetRow,
  | 'durationMinutes'
  | 'performanceTypes'
  | 'otherPerformanceType'
  | 'genres'
  | 'soundcloudTrackId'
  | 'soundcloudTrackUrl'
  | 'youtubeVideoId'
  | 'applicationId'
> & { performers: SentPerformer[] }
// Who changes a status, and when, and to what.
export type StatusChangedBy = { statusUpdatedBy: string; statusUpdatedAt: Date }
export type StatusChange = StatusChangedBy & { status: Status }
export type AnnouncedChange = Pick<SessionRow, 'announced'> & { announcedUpdatedBy: string; announcedUpdatedAt: Date }
export type NewSet = SetChanges & { createdBy: string }

// Thrown when a session or a set can't be saved. When it's about one of the sets added with a session, `setIndex` is that
// set's place among them, from 0.
class Refused extends Error {
  setIndex?: number
}

// Thrown when a session or a set can't be saved because the takeover's collective, one of its performers, or its
// application, doesn't exist. The message says which.
export class NoSuchReference extends Refused {}

// Thrown when a change would make a session or a set break a rule that involves several of its fields, with the fields
// it doesn't change as they are (see `brokenSessionRule` in sessions/fields.ts, and `checkAnnounced`), or its application
// (see `checkSessionApplication` and `checkSetApplication`). The message says which.
export class BrokenFields extends Refused {}

// `row` as `changes` would leave it: a field they don't have, or have as undefined, stays as it is, as Drizzle leaves a
// column when it's given undefined.
function changed<Row extends object>(row: Row, changes: Partial<Row>): Row {
  return { ...row, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) }
}

// Throws a BrokenFields with the rule that's `broken`, if there's one.
function check(broken: BrokenRule | null) {
  if (broken) throw new BrokenFields(broken.message)
}

// Thrown when saving a session or a set, or deleting a collective that has takeovers, would break one of the rules of
// sessions. The message says which, and `session` and `set` are what's in the way: `set` is a set, if it's one, and
// `session` is the session in the way, or that set's. Both are null when what's in the way isn't another session or set,
// e.g. a rejected application (see `checkUncancelled`), when it's another of the sets added with a session, which isn't
// saved, whose place among them is then `otherSetIndex`, and otherwise only if it can't be found anymore, which only
// something outside the server could cause (see `checkingRules`).
export class Conflict extends Refused {
  session: StoredSession | null
  set: StoredSet | null
  otherSetIndex?: number

  constructor(message: string, session: StoredSession | null, set: StoredSet | null = null, otherSetIndex?: number) {
    super(message)
    this.session = session
    this.set = set
    this.otherSetIndex = otherSetIndex
  }
}

export const SESSION_CANCELLED = 'This session is cancelled'
export const ANNOUNCED_HAS_START = 'An announced session has a start'

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
  // Adds a session, as "planned", and `sets` to it, in order, as `addSet` would add each one, all of them or none. Throws
  // a NoSuchReference, a BrokenFields or a Conflict, with the `setIndex` of the set it's about, if it's about one.
  create(session: SessionChanges & StoredFlyer & { createdBy: string }, sets: NewSet[]): Promise<StoredSession>
  // Changes the session's fields that `changes` has, all of them when they're replaced, and its flyer when there's a new
  // one, or nulls to remove it, but not its status, whether it's announced, or its sets. Returns the session as it was,
  // so that a flyer that was replaced or removed can be deleted, and as it is then. Throws a BrokenFields, a
  // NoSuchReference or a Conflict.
  update(
    id: string,
    changes: Partial<SessionChanges> & (StoredFlyer | Record<never, never>) & { updatedBy: string; updatedAt: Date },
  ): Promise<{ before: SessionRow; after: StoredSession } | null>
  // Cancelling a session cancels its sets that aren't, and marking it done marks its planned sets done, as the same
  // admin, at the same time. Throws a Conflict.
  setStatus(id: string, change: StatusChange): Promise<StoredSession | null>
  // Announces the session, or un-announces it. Throws a BrokenFields when it's announced without a start.
  setAnnounced(id: string, change: AnnouncedChange): Promise<StoredSession | null>
  // Returns the session as it was, so that its flyer can be deleted too, or null if it didn't exist. Its sets are deleted
  // with it, but not their performers.
  delete(id: string): Promise<SessionRow | null>
  // The set as the database keeps it, without its performers.
  getSet(id: string): Promise<SetRow | null>
  // Adds a set to the session `sessionId`, as "planned", after its other sets, which plans the session again if it's
  // done, as whoever adds the set, when they do (see `followSets`). Throws a NoSuchReference, a BrokenFields or a
  // Conflict.
  addSet(sessionId: string, set: NewSet): Promise<StoredSession | null>
  // Changes the set's fields that `changes` has, all of them when they're replaced, and its performers when it has them,
  // but not its session (see `moveSetToSession`), its position or its status. Throws a BrokenFields, a NoSuchReference or
  // a Conflict.
  updateSet(id: string, changes: Partial<SetChanges> & { updatedBy: string; updatedAt: Date }): Promise<StoredSession | null>
  // Makes the set's session follow its sets, as the same admin, at the same time (see `followSets`). Throws a Conflict.
  setSetStatus(id: string, change: StatusChange): Promise<StoredSession | null>
  // Moves the set to `position` among its session's sets, or last when that's past the last, the others keeping their
  // order. Doesn't count as changing it.
  moveSet(id: string, position: number): Promise<StoredSession | null>
  // Moves the set to the session `sessionId`, after its sets, as a change to the set, `by`, the sets of the session it
  // leaves keeping their order. Then both sessions follow their sets, as the same admin, at the same time (see
  // `followSets`). Moved to the session it's in, it stays where it is, but still counts as changed. Returns the set's
  // session, and the one it was in, as they are then: the same one when it didn't move. Throws a NoSuchReference when
  // there's no such session, or a Conflict when the set isn't cancelled and that session is.
  moveSetToSession(
    id: string,
    sessionId: string,
    by: { updatedBy: string; updatedAt: Date },
  ): Promise<{ session: StoredSession; previousSession: StoredSession } | null>
  // Returns the set's session as it is then, or null if the set didn't exist. Its performers stay, and the session's
  // other sets keep their order. Makes the session follow its sets, as `by` says (see `followSets`).
  deleteSet(id: string, by: StatusChangedBy): Promise<StoredSession | null>
  // The sessions that come from one of the applications `applicationIds`, or that have a set that does, in the order of
  // `list`, with all their sets.
  ofApplications(applicationIds: string[]): Promise<StoredSession[]>
}

// The application with `id`, and when it was received, as a set or a session gives it, or null for none.
function storedApplicationLink(id: string | null, receivedAt: Date | null): StoredApplicationLink | null {
  return id === null ? null : { id, receivedAt: receivedAt! }
}

// The sets of the sessions `sessionIds`, by session, in order, with their performers.
async function setsOf(db: Queryable, sessionIds: string[]): Promise<Map<string, StoredSet[]>> {
  const rows = await db
    .select({ set: sets, receivedAt: applications.receivedAt })
    .from(sets)
    .leftJoin(applications, eq(applications.id, sets.applicationId))
    .where(inArray(sets.sessionId, sessionIds))
    .orderBy(asc(sets.position))
  const performers =
    rows.length === 0
      ? []
      : await db
          .select({ setId: setPerformers.setId, id: artists.id, name: artists.name })
          .from(setPerformers)
          .innerJoin(artists, eq(artists.id, setPerformers.artistId))
          .where(inArray(setPerformers.setId, rows.map(({ set }) => set.id)))
          .orderBy(asc(setPerformers.position))
  const performersOf = new Map<string, Reference[]>()
  for (const { setId, ...performer } of performers) {
    if (!performersOf.has(setId)) performersOf.set(setId, [])
    performersOf.get(setId)!.push(performer)
  }
  const found = new Map<string, StoredSet[]>()
  for (const { set, receivedAt } of rows) {
    if (!found.has(set.sessionId)) found.set(set.sessionId, [])
    found.get(set.sessionId)!.push({ ...set, performers: performersOf.get(set.id) ?? [], application: storedApplicationLink(set.applicationId, receivedAt) })
  }
  return found
}

// The sessions that match `where`, in the order of `list`, or only the first `limit` of them, with their takeovers and
// their sets.
async function sessionsWhere(db: Queryable, where: SQL | undefined, limit?: number): Promise<StoredSession[]> {
  const query = db
    .select({ session: sessions, takeoverName: collectives.name, receivedAt: applications.receivedAt })
    .from(sessions)
    .leftJoin(collectives, eq(collectives.id, sessions.takeoverId))
    .leftJoin(applications, eq(applications.id, sessions.applicationId))
    .where(where)
    .orderBy(sql`${sessions.startAt} desc nulls first`, desc(sessions.createdAt))
  const rows = await (limit === undefined ? query : query.limit(limit))
  if (rows.length === 0) return []
  const setsBySession = await setsOf(
    db,
    rows.map(({ session }) => session.id),
  )
  return rows.map(({ session, takeoverName, receivedAt }) => ({
    ...session,
    takeover: session.takeoverId === null ? null : { id: session.takeoverId, name: takeoverName! },
    application: storedApplicationLink(session.applicationId, receivedAt),
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
// which writes them too, by deleting the artist's rows in set_performers, and their applications (see below), deleting a
// collective, which mustn't have takeovers, deleting an application, which takes it from its sets and sessions, and
// changing what admins decided about an application, since a rejected one mustn't have sets or sessions that are planned
// or done (see artists/store.ts, collectives/store.ts and applications/store.ts). They're done one at a time, so that:
// - Two sessions that would overlap can't both be inserted into the index of the exclusion constraint sessions_no_overlap,
//   then each wait for the other to end before it could tell whether they overlap, which Postgres would end as a
//   deadlock, rather than with the constraint's error. Taking an application from a session rewrites its row, which
//   checks the constraint again too.
// - What a write reads can't change until it's done: the rule that spans sessions and sets (a cancelled session only has
//   cancelled sets), whether the session, the set, the takeover's collective, the performers and the application exist,
//   and so whether the foreign keys hold, rather than failing unexpectedly once they're checked, without locking their
//   rows, which would keep their profiles from being changed in the meantime, whether a collective that's deleted has
//   takeovers, the statuses of a session's sets, which its own follows (see `followSets`), who an application belongs
//   to and whether it's rejected, which its rules are about (see "Applications" in docs/design/server/sessions.md), and
//   whether an application has sets or sessions that are planned or done, which rejecting it is about, and a session's
//   sets' positions and how many there are, which adding, moving and deleting a set work from, so that the positions stay
//   0 to n - 1 (see "sets" in db/schema.ts).
// - Deleting a session and deleting an artist can't take the artist's rows in set_performers in opposite orders, and
//   deadlock. Nor can saving a set or a session, which takes a lock on its application's row to check its foreign key
//   once its own row is written, and deleting that application, which writes the set's or the session's row once it has
//   locked its own.
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

// Who the application `id` belongs to, and what admins decided about it, which stay as they are until the transaction
// `tx`, which holds the sessions' lock, ends, since deleting it and changing its decision take it too (see
// `lockSessions`), and its owner doesn't change. Throws a NoSuchReference when there's no such application.
async function savedApplication(tx: Queryable, id: string): Promise<Pick<typeof applications.$inferSelect, 'artistId' | 'collectiveId' | 'decision'>> {
  const [found] = isUuid(id)
    ? await tx
        .select({ artistId: applications.artistId, collectiveId: applications.collectiveId, decision: applications.decision })
        .from(applications)
        .where(eq(applications.id, id))
    : []
  if (!found) throw new NoSuchReference(NO_SUCH_APPLICATION)
  return found
}

// Whether a set or a session whose application has `decision`, which would have `status`, would break the rule that a
// rejected application has no set or session that's planned or done (see "Applications" in
// docs/design/server/sessions.md).
function breaksRejection({ decision }: { decision: ApplicationDecision }, status: Status): boolean {
  return decision === 'rejected' && status !== 'cancelled'
}

// Checks that a session's application, if it has one, is that of the collective whose takeover it is, and isn't rejected
// unless the session, with `status`, is cancelled (see "Applications" in docs/design/server/sessions.md), once its fields
// are checked, so that it's a takeover (see `brokenSessionRule`), and its collective exists. Throws a NoSuchReference or a
// BrokenFields.
async function checkSessionApplication(tx: Queryable, { applicationId, takeoverId, status }: Pick<SessionRow, 'applicationId' | 'takeoverId' | 'status'>) {
  if (applicationId === null) return
  const application = await savedApplication(tx, applicationId)
  if (application.collectiveId !== takeoverId) throw new BrokenFields(NOT_THE_SESSIONS_APPLICATION)
  if (breaksRejection(application, status)) throw new BrokenFields(REJECTED_APPLICATION)
}

// Checks that a set's application is that of one of its performers, `performerIds`, once they're checked, and isn't
// rejected unless the set, with `status`, is cancelled. Throws a NoSuchReference or a BrokenFields.
async function checkSetApplication(tx: Queryable, applicationId: string, performerIds: string[], status: Status) {
  const application = await savedApplication(tx, applicationId)
  if (application.artistId === null || !performerIds.includes(application.artistId)) throw new BrokenFields(NOT_THE_SETS_APPLICATION)
  if (breaksRejection(application, status)) throw new BrokenFields(REJECTED_APPLICATION)
}

// Whether the application `id` has a set or a session that's planned or done, which can't change until the transaction
// `tx`, which holds the sessions' lock, ends.
export async function isBooked(tx: Queryable, id: string): Promise<boolean> {
  const booked = (table: typeof sets | typeof sessions) => exists(tx.select().from(table).where(and(eq(table.applicationId, id), ne(table.status, 'cancelled'))))
  const { rows } = await tx.execute<{ found: boolean }>(sql`select ${or(booked(sets), booked(sessions))} as found`)
  return rows[0].found
}

// Throws a Conflict when a set or a session with the application `applicationId` can't go from status `from` to `to`
// because that application is rejected, which only happens when it stops being cancelled, since one that isn't can't
// have a rejected application. In a transaction that holds the sessions' lock, so that the application can't be rejected
// in the meantime.
async function checkUncancelled(tx: Queryable, applicationId: string | null, from: Status, to: Status) {
  if (applicationId === null || from !== 'cancelled' || to === 'cancelled') return
  if (breaksRejection(await savedApplication(tx, applicationId), to)) throw new Conflict(REJECTED_APPLICATION, null)
}

// The ids of the performers of the set `setId`, as they're saved.
async function savedPerformerIds(tx: Queryable, setId: string): Promise<string[]> {
  const rows = await tx.select({ id: setPerformers.artistId }).from(setPerformers).where(eq(setPerformers.setId, setId))
  return rows.map(({ id }) => id)
}

const idsOf = (performers: SentPerformer[]) => performers.map(({ id }) => id)

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
  inTheWay: (rule: Rule<Saved>) => Promise<Pick<Conflict, 'session' | 'set' | 'otherSetIndex'>>,
  write: (savepoint: Queryable) => Promise<T>,
): Promise<T> {
  try {
    return await tx.transaction(write)
  } catch (error) {
    const constraint = Object.keys(rules).find((name) => violatesConstraint(error, name))
    if (!constraint) throw error
    const { session, set, otherSetIndex } = await inTheWay(rules[constraint])
    throw new Conflict(rules[constraint].message, session, set, otherSetIndex)
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
// with the other set, and its session, when it breaks a rule (see `checkingRules`), or with the other set's place among
// `added`, the sets added with the same session, by id, when it's one of them.
function checkingSetRules<T>(
  tx: Queryable,
  id: string | null,
  set: SetLinks,
  write: (savepoint: Queryable) => Promise<T>,
  added: Map<string, number> = new Map(),
) {
  return checkingRules(
    tx,
    SET_RULES,
    async (rule) => {
      const [other] = await tx
        .select({ id: sets.id })
        .from(sets)
        .where(and(rule.other(set), id === null ? undefined : ne(sets.id, id)))
        .limit(1)
      if (other && added.has(other.id)) return { session: null, set: null, otherSetIndex: added.get(other.id) }
      return (other && (await setWithId(tx, other.id))) ?? { session: null, set: null }
    },
    write,
  )
}

// How many sets the session `sessionId` has, which is the position of the one that's added next.
async function setCount(tx: Queryable, sessionId: string): Promise<number> {
  const [{ sets: found }] = await tx.select({ sets: count() }).from(sets).where(eq(sets.sessionId, sessionId))
  return found
}

// Moves the sets of the session `sessionId` after `position` up by one, once its set there is gone, so that its positions
// are still 0 to n - 1.
async function closeGap(tx: Queryable, sessionId: string, position: number) {
  await tx
    .update(sets)
    .set({ position: sql`${sets.position} - 1` })
    .where(and(eq(sets.sessionId, sessionId), gt(sets.position, position)))
}

// Adds `set` to the session `sessionId`, after its other sets, in the transaction `tx`, which holds the sessions' lock,
// with `added` and its `position` as `create` gives them when the set is added with its session, and returns its id.
// Throws a NoSuchReference, a BrokenFields or a Conflict.
async function insertSet(
  tx: Queryable,
  sessionId: string,
  { performers, ...set }: NewSet,
  { added, position }: { added?: Map<string, number>; position?: number } = {},
): Promise<string> {
  await checkPerformers(tx, performers)
  // A new set is planned.
  if (set.applicationId !== null) await checkSetApplication(tx, set.applicationId, idsOf(performers), 'planned')
  const row = { ...set, sessionId, position: position ?? (await setCount(tx, sessionId)) }
  const [{ id }] = await checkingSetRules(tx, null, row, (savepoint) => savepoint.insert(sets).values(row).returning({ id: sets.id }), added)
  await addPerformers(tx, id, performers)
  return id
}

// Checks that a session, as it would be, isn't announced without a start (see "Announced" in
// docs/design/server/sessions.md), in a transaction that holds the sessions' lock, so that it can't be announced, or lose
// its start, in the meantime. Throws a BrokenFields otherwise.
function checkAnnounced(session: Pick<SessionRow, 'announced' | 'startAt'>) {
  if (session.announced && session.startAt === null) throw new BrokenFields(ANNOUNCED_HAS_START)
}

// Makes the status of the session `sessionId` follow its sets', as `by` says (see "Status" in
// docs/design/server/sessions.md): planned again if it's done, with a set that's planned, or done if it's planned, with
// at least one set that's done, and none that's planned. In a transaction that holds the sessions' lock, so that its sets
// can't change in the meantime: two of its sets marked done at the same time can't each see the other still planned.
// Called whenever one of its sets is added, its status is set, or it's deleted, or a set is moved into it or out of it.
async function followSets(tx: Queryable, sessionId: string, by: { statusUpdatedBy: string; statusUpdatedAt: Date | SQL }) {
  const hasSet = (status: Status) => exists(tx.select().from(sets).where(and(eq(sets.sessionId, sessionId), eq(sets.status, status))))
  // In one statement, which only ever matches one of the two.
  await tx
    .update(sessions)
    .set({ ...by, status: sql`case when ${sessions.status} = 'done' then 'planned' else 'done' end` })
    .where(
      and(
        eq(sessions.id, sessionId),
        or(and(eq(sessions.status, 'done'), hasSet('planned')), and(eq(sessions.status, 'planned'), hasSet('done'), not(hasSet('planned')))),
      ),
    )
}

// The session `id`, or null when there's no such session.
async function sessionRow(tx: Queryable, id: string): Promise<SessionRow | null> {
  const [session] = await tx.select().from(sessions).where(eq(sessions.id, id))
  return session ?? null
}

// The set `id`, without its performers, and its session, or null when there's no such set.
async function setAndSession(tx: Queryable, id: string): Promise<{ set: SetRow; session: SessionRow } | null> {
  const [found] = await tx.select({ set: sets, session: sessions }).from(sets).innerJoin(sessions, eq(sessions.id, sets.sessionId)).where(eq(sets.id, id))
  return found ?? null
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

    create(session, newSets) {
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        await checkTakeover(tx, session.takeoverId)
        // A new session is planned.
        await checkSessionApplication(tx, { ...session, status: 'planned' })
        const [row] = await checkingSessionRules(tx, null, session, (savepoint) => savepoint.insert(sessions).values(session).returning({ id: sessions.id }))
        // The sets added so far, by id, with their place among them.
        const added = new Map<string, number>()
        for (const [setIndex, set] of newSets.entries()) {
          try {
            // A new session's sets are in the order they're sent.
            added.set(await insertSet(tx, row.id, set, { added, position: setIndex }), setIndex)
          } catch (error) {
            if (error instanceof Refused) error.setIndex = setIndex
            throw error
          }
        }
        return (await sessionWithId(tx, row.id))!
      })
    },

    async update(id, changes) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const before = await sessionRow(tx, id)
        if (!before) return null
        // The rules are about the session as it will be, with the fields that aren't changed as they are.
        const session = changed(before, changes)
        check(
          brokenSessionRule({
            start: session.startAt,
            durationMinutes: session.durationMinutes,
            type: session.type,
            takeover: session.takeoverId,
            application: session.applicationId,
            name: session.name,
          }),
        )
        checkAnnounced(session)
        await checkTakeover(tx, session.takeoverId)
        await checkSessionApplication(tx, session)
        await checkingSessionRules(tx, id, session, (savepoint) => savepoint.update(sessions).set(changes).where(eq(sessions.id, id)))
        return { before, after: (await sessionWithId(tx, id))! }
      })
    },

    async setStatus(id, change) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        // With its start and duration, which the status doesn't change.
        const before = await sessionRow(tx, id)
        if (!before) return null
        await checkUncancelled(tx, before.applicationId, before.status, change.status)
        await checkingSessionRules(tx, id, before, (savepoint) => savepoint.update(sessions).set(change).where(eq(sessions.id, id)))
        // Cancelling it cancels its sets that aren't, and marking it done marks those that are planned.
        if (change.status !== 'planned') {
          const marked = change.status === 'cancelled' ? ne(sets.status, 'cancelled') : eq(sets.status, 'planned')
          await tx
            .update(sets)
            .set(change)
            .where(and(eq(sets.sessionId, id), marked))
        }
        return sessionWithId(tx, id)
      })
    },

    async setAnnounced(id, change) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const before = await sessionRow(tx, id)
        if (!before) return null
        checkAnnounced({ ...before, ...change })
        await tx.update(sessions).set(change).where(eq(sessions.id, id))
        return sessionWithId(tx, id)
      })
    },

    async delete(id) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const [deleted] = await tx.delete(sessions).where(eq(sessions.id, id)).returning()
        return deleted ?? null
      })
    },

    async getSet(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select().from(sets).where(eq(sets.id, id))
      return row ?? null
    },

    async addSet(sessionId, set) {
      if (!isUuid(sessionId)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const session = await sessionRow(tx, sessionId)
        if (!session) return null
        if (session.status === 'cancelled') throw new Conflict(SESSION_CANCELLED, await sessionWithId(tx, sessionId))
        await insertSet(tx, sessionId, set)
        // Its session, if it's done, is planned again, as whoever added the set, when they did: now() is when the
        // transaction started, which the set's created_at is too.
        await followSets(tx, sessionId, { statusUpdatedBy: set.createdBy, statusUpdatedAt: sql`now()` })
        return sessionWithId(tx, sessionId)
      })
    },

    async updateSet(id, { performers, ...changes }) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const [before] = await tx.select().from(sets).where(eq(sets.id, id))
        if (!before) return null
        // The rules are about the set as it will be, with the fields that aren't changed as they are, its performers
        // included, which stay as they are when they're left out.
        const set = changed(before, changes)
        if (performers) await checkPerformers(tx, performers)
        // Against its new performers, or else those it has.
        if (set.applicationId !== null) {
          await checkSetApplication(tx, set.applicationId, performers ? idsOf(performers) : await savedPerformerIds(tx, id), set.status)
        }
        await checkingSetRules(tx, id, set, (savepoint) => savepoint.update(sets).set(changes).where(eq(sets.id, id)))
        if (performers) {
          await tx.delete(setPerformers).where(eq(setPerformers.setId, id))
          await addPerformers(tx, id, performers)
        }
        return sessionWithId(tx, before.sessionId)
      })
    },

    async setSetStatus(id, change) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const found = await setAndSession(tx, id)
        if (!found) return null
        const { session, set } = found
        if (session.status === 'cancelled' && change.status !== 'cancelled') {
          throw new Conflict(SESSION_CANCELLED, await sessionWithId(tx, session.id))
        }
        await checkUncancelled(tx, set.applicationId, set.status, change.status)
        await tx.update(sets).set(change).where(eq(sets.id, id))
        await followSets(tx, session.id, change)
        return sessionWithId(tx, session.id)
      })
    },

    async moveSet(id, position) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const [set] = await tx.select({ sessionId: sets.sessionId, position: sets.position }).from(sets).where(eq(sets.id, id))
        if (!set) return null
        // Past the last, it goes last, before anything reaches the database, whose integers are smaller than some that are
        // sent.
        const to = Math.min(position, (await setCount(tx, set.sessionId)) - 1)
        const from = set.position
        if (to !== from) {
          // The sets in between shift by one towards where it was. In a single statement, since each position is only
          // once in a session, which is checked at the end of each statement (see "sets" in db/schema.ts).
          const shift = to < from ? sql`${sets.position} + 1` : sql`${sets.position} - 1`
          await tx
            .update(sets)
            .set({ position: sql`case when ${sets.id} = ${id} then ${to}::integer else ${shift} end` })
            .where(and(eq(sets.sessionId, set.sessionId), sql`${sets.position} between ${Math.min(from, to)} and ${Math.max(from, to)}`))
        }
        return sessionWithId(tx, set.sessionId)
      })
    },

    async moveSetToSession(id, sessionId, by) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const [set] = await tx.select({ sessionId: sets.sessionId, position: sets.position, status: sets.status }).from(sets).where(eq(sets.id, id))
        if (!set) return null
        const from = set.sessionId
        if (sessionId === from) {
          await tx.update(sets).set(by).where(eq(sets.id, id))
          const session = (await sessionWithId(tx, from))!
          return { session, previousSession: session }
        }
        const to = isUuid(sessionId) ? await sessionRow(tx, sessionId) : null
        if (!to) throw new NoSuchReference(NO_SUCH_SESSION)
        if (to.status === 'cancelled' && set.status !== 'cancelled') throw new Conflict(SESSION_CANCELLED, await sessionWithId(tx, to.id))
        // After the sets of the session it joins.
        await tx
          .update(sets)
          .set({ ...by, sessionId: to.id, position: await setCount(tx, to.id) })
          .where(eq(sets.id, id))
        await closeGap(tx, from, set.position)
        // Both as the same admin, at the same time, when the set was moved.
        const statusBy = { statusUpdatedBy: by.updatedBy, statusUpdatedAt: by.updatedAt }
        await followSets(tx, from, statusBy)
        await followSets(tx, to.id, statusBy)
        const both = await sessionsWhere(tx, inArray(sessions.id, [to.id, from]))
        const found = (sessionId: string) => both.find((session) => session.id === sessionId)!
        return { session: found(to.id), previousSession: found(from) }
      })
    },

    async deleteSet(id, by) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        await lockSessions(tx)
        const [deleted] = await tx.delete(sets).where(eq(sets.id, id)).returning({ sessionId: sets.sessionId, position: sets.position })
        if (!deleted) return null
        await closeGap(tx, deleted.sessionId, deleted.position)
        await followSets(tx, deleted.sessionId, by)
        return sessionWithId(tx, deleted.sessionId)
      })
    },

    async ofApplications(applicationIds) {
      const ids = applicationIds.filter(isUuid)
      if (ids.length === 0) return []
      const ofTheirSets = db.select({ id: sets.sessionId }).from(sets).where(inArray(sets.applicationId, ids))
      return sessionsWhere(db, or(inArray(sessions.applicationId, ids), inArray(sessions.id, ofTheirSets)))
    },
  }
}
