import { desc, eq } from 'drizzle-orm'
import { violatesConstraint } from '../api/query-errors.js'
import type { Queryable } from '../db/connection.js'
import { applications } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import { ApplicationFields } from './fields.js'
import type { ApplicationStatus } from './fields.js'

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

// Thrown when creating an application for an artist that doesn't exist.
export class NoSuchArtist extends Error {}

// Where applications are stored. Methods that take an application's id return null if it doesn't exist, including
// when the id isn't a UUID.
export type ApplicationsStore = {
  // The most recently received first, then the most recently created. With `artistId`, only that artist's applications.
  list(artistId?: string): Promise<StoredApplication[]>
  get(id: string): Promise<StoredApplication | null>
  // `createdBy` is the email of the admin who creates the application, or null if the artist sends it themselves.
  // `receivedAt` is when the artist sent it, now if it's left out. Throws a NoSuchArtist.
  create(application: ApplicationFields & { artistId: string; createdBy: string | null; receivedAt?: Date }): Promise<StoredApplication>
  // Replaces the application's fields, and `receivedAt` unless it's left out, and returns the updated application.
  update(id: string, changes: ApplicationFields & { receivedAt?: Date; updatedBy: string; updatedAt: Date }): Promise<StoredApplication | null>
  // Changes the application's status, and returns the updated application.
  setStatus(id: string, change: { status: ApplicationStatus; statusUpdatedBy: string; statusUpdatedAt: Date }): Promise<StoredApplication | null>
  // Returns false if the application didn't exist.
  delete(id: string): Promise<boolean>
}

export function applicationsStore(db: Queryable): ApplicationsStore {
  async function change(id: string, changes: Partial<typeof applications.$inferInsert>) {
    if (!isUuid(id)) return null
    const [row] = await db.update(applications).set(changes).where(eq(applications.id, id)).returning()
    return row ?? null
  }

  return {
    async list(artistId) {
      if (artistId !== undefined && !isUuid(artistId)) return []
      return db
        .select()
        .from(applications)
        .where(artistId === undefined ? undefined : eq(applications.artistId, artistId))
        .orderBy(desc(applications.receivedAt), desc(applications.createdAt))
    },

    async get(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select().from(applications).where(eq(applications.id, id))
      return row ?? null
    },

    async create(application) {
      if (!isUuid(application.artistId)) throw new NoSuchArtist()
      try {
        const [row] = await db.insert(applications).values(application).returning()
        return row
      } catch (error) {
        if (violatesConstraint(error, 'applications_artist_id_artists_id_fk')) throw new NoSuchArtist()
        throw error
      }
    },

    update: change,
    setStatus: change,

    async delete(id) {
      if (!isUuid(id)) return false
      const deleted = await db.delete(applications).where(eq(applications.id, id)).returning({ id: applications.id })
      return deleted.length > 0
    },
  }
}
