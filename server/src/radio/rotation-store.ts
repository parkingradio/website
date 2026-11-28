import { asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Queryable } from '../db/connection.js'
import { radioRotation, rotationSets, sessions, sets, soundcloudTrackReads } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import { lockSessions, sessionsWhere } from '../sessions/store.js'
import type { StoredSession, StoredSet } from '../sessions/store.js'
import { durationOf, ineligibility, onAirAfterChange, onAirAfterReads, onAirAt, readThrough, sameSaved, skipReasons } from './rotation.js'
import type { Entry, Saved, SkipReason } from './rotation.js'
import type { TrackRead } from './soundcloud.js'

// Keeps the radio's rotation of sets in the database: its sets, in order, who last changed it, the set on air, and what
// was read from SoundCloud of their tracks (see "The rotation of sets" in docs/design/server/radio.md). It keeps what's
// on air as the rules of rotation.ts decide it, under a lock, so that no request keeps what another one already changed.

export type StoredTrackRead = typeof soundcloudTrackReads.$inferSelect

// A set of the rotation, as the rules of what's on air work from it, with its session, and what was read of its track
// through the link it has, if anything.
export type RotationEntry = Entry & { set: StoredSet; session: StoredSession; read: StoredTrackRead | null }

// The rotation: who last changed it, and when, its sets, in order, and what's kept of what's on air (see `Saved` in
// rotation.ts).
export type Rotation = { updatedBy: string | null; updatedAt: Date | null; entries: RotationEntry[]; saved: Saved | null }

export const DUPLICATE_SET = 'A set is only once in the rotation'
export const NO_SUCH_SET = 'No such set'
export const CANNOT_ADD = "This set can't be added to the rotation"

// Thrown when the rotation can't be changed: `setIndex` is the place in the request's list of the set it's about, and
// `reasons` why it can't be added, for a 409.
export class RotationRefused extends Error {
  status: 400 | 409
  setIndex: number
  reasons?: SkipReason[]

  constructor(status: 400 | 409, message: string, setIndex: number, reasons?: SkipReason[]) {
    super(message)
    this.status = status
    this.setIndex = setIndex
    this.reasons = reasons
  }
}

// What a read of a track got: what SoundCloud said of it, or why it couldn't be read, the server's own message.
export type ReadOutcome = { read: TrackRead } | { error: string }

export type RotationStore = {
  // The rotation as it is, all of it at the same instant, as what's on air was last kept.
  load(): Promise<Rotation>
  // The rotation as it is, with what's on air at `now`, which is kept when it changed (see `onAirAt` in rotation.ts).
  onAir(now: number): Promise<Rotation>
  // Makes the rotation `setIds`, ids of sets in lower case, in order from the play head, as a change by `updatedBy`, which
  // changes what's on air (see `onAirAfterChange` in rotation.ts), and returns it. It's changed at the time `now` gives
  // once nothing else can change what's on air, so that it's never before what another request kept. Throws a RotationRefused when a set is
  // there twice, doesn't exist, or can't be added, as its endpoint checks them, in that order (see
  // `PUT /api/admin/radio/rotation` in docs/design/server/radio.md), in which case nothing changes.
  replace(setIds: string[], updatedBy: string, now?: () => number): Promise<Rotation>
  // The rotation as it is, with what's on air at `now`, once the tracks that changing it to `changed`, which `replace`
  // returned, reads are read: unless it has been changed again since, the first set that can be played then goes on air,
  // when it isn't the one that could be played first before (see `onAirAfterReads` in rotation.ts).
  afterReads(changed: Rotation, now: number): Promise<Rotation>
  // The sets that can be added to the rotation, and aren't in it, with their sessions: the most recent session first, then
  // in each session's order.
  candidates(): Promise<{ set: StoredSet; session: StoredSession }[]>
  // The tracks of the rotation's sets, with the links they have, and what was read of them, if anything.
  tracks(): Promise<{ trackId: string; link: string; read: StoredTrackRead | null }[]>
  // Keeps what a read of the track `trackId` through `link`, which ended `at`, got. A read that failed keeps what was read
  // before through the same link, if anything.
  saveRead(trackId: string, link: string, outcome: ReadOutcome, at: Date): Promise<void>
}

function savedOf(row: typeof radioRotation.$inferSelect): Saved | null {
  if (row.onAirSetId === null) return null
  return { setId: row.onAirSetId, trackId: row.onAirTrackId!, startedAt: row.onAirStartedAt?.getTime() ?? null, position: row.onAirPosition! }
}

function onAirColumns(saved: Saved | null) {
  return {
    onAirSetId: saved?.setId ?? null,
    onAirTrackId: saved?.trackId ?? null,
    onAirStartedAt: saved?.startedAt == null ? null : new Date(saved.startedAt),
    onAirPosition: saved?.position ?? null,
  }
}

// The sessions of the sets `setIds`, with all their sets, by set id.
async function setsWithIds(db: Queryable, setIds: string[]): Promise<Map<string, { set: StoredSet; session: StoredSession }>> {
  if (setIds.length === 0) return new Map()
  const found = await sessionsWhere(db, inArray(sessions.id, db.select({ id: sets.sessionId }).from(sets).where(inArray(sets.id, setIds))))
  return new Map(found.flatMap((session) => session.sets.map((set) => [set.id, { set, session }] as const)))
}

// The rotation, as `db` sees it.
async function loadFrom(db: Queryable): Promise<Rotation> {
  const [row] = await db.select().from(radioRotation)
  const places = await db.select().from(rotationSets).orderBy(asc(rotationSets.position))
  const found = await setsWithIds(
    db,
    places.map(({ setId }) => setId),
  )
  const trackIds = [...found.values()].flatMap(({ set }) => (set.soundcloudTrackId === null ? [] : [set.soundcloudTrackId]))
  const reads = trackIds.length === 0 ? [] : await db.select().from(soundcloudTrackReads).where(inArray(soundcloudTrackReads.trackId, trackIds))
  const readOf = new Map(reads.map((read) => [read.trackId, read]))
  const entries = places.flatMap(({ setId, position }): RotationEntry[] => {
    // Only a set deleted since its place was read, which a transaction that sees both at the same instant doesn't see.
    const { set, session } = found.get(setId) ?? {}
    if (!set || !session) return []
    const read = readThrough(set.soundcloudTrackUrl, (set.soundcloudTrackId !== null && readOf.get(set.soundcloudTrackId)) || null)
    const skipped = skipReasons(set, session, read)
    return [{ setId, position, trackId: set.soundcloudTrackId, durationMs: durationOf(set, read), skipped, set, session, read }]
  })
  return { updatedBy: row.updatedBy, updatedAt: row.updatedAt, entries, saved: savedOf(row) }
}

// Locks the row of what's on air, until the transaction `tx` ends: every transaction that changes it takes this lock,
// then works out what to keep from what it reads, so that none of them keeps what another one has already changed.
async function lockOnAir(tx: Queryable) {
  await tx.select({ id: radioRotation.id }).from(radioRotation).for('update')
}

async function keep(tx: Queryable, before: Saved | null, saved: Saved | null) {
  if (!sameSaved(before, saved)) await tx.update(radioRotation).set(onAirColumns(saved))
}

// Keeps what `decide` makes of what's on air, from the rotation as it is once nothing else can change it, and returns the
// rotation with it.
function keepLocked(db: Queryable, decide: (latest: Rotation) => Saved | null): Promise<Rotation> {
  return db.transaction(async (tx) => {
    await lockOnAir(tx)
    const latest = await loadFrom(tx)
    const saved = decide(latest)
    await keep(tx, latest.saved, saved)
    return { ...latest, saved }
  })
}

export function rotationStore(db: Queryable): RotationStore {
  const load = () => db.transaction(loadFrom, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  return {
    load,

    async onAir(now) {
      const rotation = await load()
      // It's only kept under the lock, from what's read then, when it changed, which is about once a set.
      if (sameSaved(onAirAt(rotation.entries, rotation.saved, now), rotation.saved)) return rotation
      return keepLocked(db, (latest) => onAirAt(latest.entries, latest.saved, now))
    },

    async replace(setIds, updatedBy, now = Date.now) {
      const seen = new Set<string>()
      setIds.forEach((id, index) => {
        if (seen.has(id)) throw new RotationRefused(400, DUPLICATE_SET, index)
        seen.add(id)
      })
      return db.transaction(async (tx) => {
        // So that what the sets and their sessions are can't change until the rotation is saved, and that deleting a set,
        // which takes it out of the rotation, waits (see `lockSessions` in sessions/store.ts).
        await lockSessions(tx)
        await lockOnAir(tx)
        const updatedAt = new Date(now())
        const before = await loadFrom(tx)
        const inRotation = new Set(before.entries.map(({ set }) => set.id))
        const found = await setsWithIds(tx, setIds.filter(isUuid))
        const missing = setIds.findIndex((id) => !found.has(id))
        if (missing !== -1) throw new RotationRefused(400, NO_SUCH_SET, missing)
        setIds.forEach((id, index) => {
          if (inRotation.has(id)) return
          const { set, session } = found.get(id)!
          const reasons = ineligibility(set, session)
          if (reasons.length > 0) throw new RotationRefused(409, CANNOT_ADD, index, reasons)
        })

        await tx.delete(rotationSets)
        if (setIds.length > 0) await tx.insert(rotationSets).values(setIds.map((setId, position) => ({ setId, position })))
        await tx.update(radioRotation).set({ updatedBy, updatedAt })
        const after = await loadFrom(tx)
        const saved = onAirAfterChange(before.entries, after.entries, before.saved, updatedAt.getTime())
        await keep(tx, after.saved, saved)
        return { ...after, saved }
      })
    },

    async afterReads(changed, now) {
      return keepLocked(db, (latest) =>
        latest.updatedAt?.getTime() === changed.updatedAt?.getTime()
          ? onAirAfterReads(changed.entries, latest.entries, latest.saved, now)
          : onAirAt(latest.entries, latest.saved, now),
      )
    },

    async candidates() {
      const [all, inRotation] = await Promise.all([sessionsWhere(db, undefined), db.select({ id: rotationSets.setId }).from(rotationSets)])
      const taken = new Set(inRotation.map(({ id }) => id))
      return all.flatMap((session) =>
        session.sets.filter((set) => !taken.has(set.id) && ineligibility(set, session).length === 0).map((set) => ({ set, session })),
      )
    },

    async tracks() {
      const rows = await db
        .select({ trackId: sets.soundcloudTrackId, link: sets.soundcloudTrackUrl, read: soundcloudTrackReads })
        .from(rotationSets)
        .innerJoin(sets, eq(sets.id, rotationSets.setId))
        .leftJoin(soundcloudTrackReads, eq(soundcloudTrackReads.trackId, sets.soundcloudTrackId))
        .where(isNotNull(sets.soundcloudTrackId))
        .orderBy(asc(rotationSets.position))
      return rows.map(({ trackId, link, read }) => ({ trackId: trackId!, link: link!, read }))
    },

    async saveRead(trackId, link, outcome, at) {
      if ('read' in outcome) {
        const { state, durationMs, secretToken } = outcome.read
        const values = { link, state, durationMs, secretToken, readAt: at, attemptedAt: at, error: null }
        await db
          .insert(soundcloudTrackReads)
          .values({ trackId, ...values })
          .onConflictDoUpdate({ target: soundcloudTrackReads.trackId, set: values })
        return
      }
      // What was read through another link doesn't count anymore (see "soundcloud_track_reads" in db/schema.ts).
      const kept = <T>(column: T) => sql`case when ${soundcloudTrackReads.link} = excluded.link then ${column} else null end`
      await db
        .insert(soundcloudTrackReads)
        .values({ trackId, link, attemptedAt: at, error: outcome.error })
        .onConflictDoUpdate({
          target: soundcloudTrackReads.trackId,
          set: {
            link: sql`excluded.link`,
            attemptedAt: sql`excluded.attempted_at`,
            error: sql`excluded.error`,
            state: kept(soundcloudTrackReads.state),
            durationMs: kept(soundcloudTrackReads.durationMs),
            secretToken: kept(soundcloudTrackReads.secretToken),
            readAt: kept(soundcloudTrackReads.readAt),
          },
        })
    },
  }
}
