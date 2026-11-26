import { and, desc, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { violatesConstraint } from '../api/errors.js'
import type { Queryable } from '../db/connection.js'
import { applications } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import { isBooked, lockSessions } from '../sessions/store.js'
import { ApplicationFields } from './fields.js'
import type { ApplicationDecision } from './fields.js'

// Checks applications against the rules in applications/fields.ts, and stores them in the database.

// Thrown when an application isn't valid. The message tells the artist what's wrong, in French.
export class InvalidApplication extends Error {}

// Checks an application's fields against `ApplicationFields`, and returns the cleaned-up version to store. Throws an
// InvalidApplication, saying what's wrong with the first field that's wrong, otherwise.
export function validateApplication(sent: unknown): ApplicationFields {
  const result = ApplicationFields.safeParse(sent)
  if (!result.success) throw new InvalidApplication(result.error.issues[0].message)
  return result.data
}

export type StoredApplication = typeof applications.$inferSelect

// Thrown when creating an application for an artist or a collective that doesn't exist.
export class NoSuchArtist extends Error {}
export class NoSuchCollective extends Error {}

// What changing an application saves: the fields that were sent, and when it was received, if that was sent.
type ApplicationChange = Partial<ApplicationFields> & { receivedAt?: Date }

// Thrown when rejecting an application that has a set or a session that's planned or done.
export class RejectedWhileBooked extends Error {}

// Who an application belongs to: an artist or a collective, by their id.
export type ApplicationOwner = { artistId: string; collectiveId?: undefined } | { collectiveId: string; artistId?: undefined }

// Where applications are stored. Methods that take an application's id return null if it doesn't exist, including
// when the id isn't a UUID.
export type ApplicationsStore = {
  // The most recently received first, then the most recently created. With `artist` or `collective`, only their
  // applications: none when there's no such artist or collective. With `from` or `to`, days, only those with at least one
  // of their dates from `from` to `to`, both included.
  list(filter?: { artist?: string; collective?: string; from?: string; to?: string }): Promise<StoredApplication[]>
  get(id: string): Promise<StoredApplication | null>
  // `createdBy` is the email of the admin who creates the application, or null if the artist sends it themselves.
  // `receivedAt` is when the artist sent it, now if it's left out. Throws a NoSuchArtist or a NoSuchCollective.
  create(application: ApplicationFields & ApplicationOwner & { createdBy: string | null; receivedAt?: Date }): Promise<StoredApplication>
  // Changes the application's fields that `changes` has, and returns the updated application.
  update(id: string, changes: ApplicationChange & { updatedBy: string; updatedAt: Date }): Promise<StoredApplication | null>
  // Changes what admins decided about the application, and returns the updated application. Throws a RejectedWhileBooked
  // when it's rejected while it has a set or a session that's planned or done.
  decide(id: string, change: { decision: ApplicationDecision; decisionUpdatedBy: string; decisionUpdatedAt: Date }): Promise<StoredApplication | null>
  // Returns false if the application didn't exist. Its sets and sessions stay, without it.
  delete(id: string): Promise<boolean>
}

function ownerId(owner: ApplicationOwner): string {
  return owner.artistId !== undefined ? owner.artistId : owner.collectiveId
}

export function applicationsStore(db: Queryable): ApplicationsStore {
  // Changes the application `id` in `tx`.
  async function changeIn(tx: Queryable, id: string, changes: Partial<typeof applications.$inferInsert>) {
    if (!isUuid(id)) return null
    const [row] = await tx.update(applications).set(changes).where(eq(applications.id, id)).returning()
    return row ?? null
  }

  return {
    async list({ artist, collective, from, to } = {}) {
      if ((artist !== undefined && !isUuid(artist)) || (collective !== undefined && !isUuid(collective))) return []
      const conditions: SQL[] = []
      if (artist !== undefined) conditions.push(eq(applications.artistId, artist))
      if (collective !== undefined) conditions.push(eq(applications.collectiveId, collective))
      if (from !== undefined || to !== undefined) {
        // Both bounds on the same date, rather than one date after `from` and another before `to`.
        const range = sql`${from ?? '-infinity'}::date and ${to ?? 'infinity'}::date`
        conditions.push(sql`exists (select 1 from unnest(${applications.dates}) as dates(day) where day between ${range})`)
      }
      return db
        .select()
        .from(applications)
        .where(and(...conditions))
        .orderBy(desc(applications.receivedAt), desc(applications.createdAt))
    },

    async get(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select().from(applications).where(eq(applications.id, id))
      return row ?? null
    },

    async create(application) {
      const noSuchOwner = () => (application.artistId !== undefined ? new NoSuchArtist() : new NoSuchCollective())
      if (!isUuid(ownerId(application))) throw noSuchOwner()
      try {
        const [row] = await db.insert(applications).values(application).returning()
        return row
      } catch (error) {
        if (violatesConstraint(error, 'applications_artist_id_artists_id_fk') || violatesConstraint(error, 'applications_collective_id_collectives_id_fk')) {
          throw noSuchOwner()
        }
        throw error
      }
    },

    update: (id, changes) => changeIn(db, id, changes),

    async decide(id, change) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        // So that its sets and sessions can't be planned, or un-cancelled, in the meantime (see `lockSessions`).
        await lockSessions(tx)
        if (change.decision === 'rejected' && (await isBooked(tx, id))) throw new RejectedWhileBooked()
        return changeIn(tx, id, change)
      })
    },

    async delete(id) {
      if (!isUuid(id)) return false
      return db.transaction(async (tx) => {
        // Deleting it takes it from its sets and sessions, which writes them (see `lockSessions`).
        await lockSessions(tx)
        const deleted = await tx.delete(applications).where(eq(applications.id, id)).returning({ id: applications.id })
        return deleted.length > 0
      })
    },
  }
}
