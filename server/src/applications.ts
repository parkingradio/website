import { desc, eq } from 'drizzle-orm'
import { checkApplication } from 'shared/applications'
import type { ApplicationFields, ApplicationStatus } from 'shared/applications'
import { firstError } from 'shared/checks'
import type { Queryable } from './db.js'
import { violatesConstraint } from './query-errors.js'
import { applications } from './schema.js'
import { isUuid } from './uuid.js'

// Checks applications against the rules in shared/src/applications.ts, and stores them in the database.

// Thrown when an application isn't valid. The message tells the artist what's wrong, in French.
export class InvalidApplication extends Error {}

// Checks an application's fields with `checkApplication`, and returns the cleaned-up version to store. Throws an
// InvalidApplication, saying what's wrong with the first field that's wrong, otherwise.
export function validateApplication(sent: unknown): ApplicationFields {
  const { application, errors } = checkApplication(sent)
  if (errors) throw new InvalidApplication(firstError(errors))
  return application
}

export type StoredApplication = typeof applications.$inferSelect

// Thrown when creating an application for an artist that doesn't exist.
export class NoSuchArtist extends Error {}

// Where applications are stored. Methods that take an application's id return null if it doesn't exist, including
// when the id isn't a UUID.
export type ApplicationsStore = {
  // Newest first. With `artistId`, only that artist's applications.
  list(artistId?: string): Promise<StoredApplication[]>
  get(id: string): Promise<StoredApplication | null>
  // `createdBy` is the email of the admin who creates the application, or null if the artist sends it themselves.
  // Throws a NoSuchArtist.
  create(application: ApplicationFields & { artistId: string; createdBy: string | null }): Promise<StoredApplication>
  // Replaces the application's fields, and returns the updated application.
  update(id: string, changes: ApplicationFields & { updatedBy: string; updatedAt: Date }): Promise<StoredApplication | null>
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
        .orderBy(desc(applications.createdAt))
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
