import { desc, eq } from 'drizzle-orm'
import { DETAILS_MAX_LENGTH, PRESTATION_MAX_LENGTH, isDay, isTime } from 'shared/applications'
import type { ApplicationFields, ApplicationStatus, TimeSlot } from 'shared/applications'
import { line, text } from './artists.js'
import type { db as Database } from './db.js'
import { violatesConstraint } from './query-errors.js'
import { applications } from './schema.js'
import { isUuid } from './uuid.js'

// Checks applications against the rules in shared/src/applications.ts, and stores them in the database.

// Thrown when an application isn't valid. The message tells the artist what's wrong, in French.
export class InvalidApplication extends Error {}

// Checks an application's fields, and returns the cleaned-up version to store:
// - dates and time slots are sorted, without duplicates
// - text is trimmed
// - blank prestations are dropped, and so are duplicates, ignoring case
// Throws an InvalidApplication if the application isn't valid.
export function validateApplication(sent: unknown): ApplicationFields {
  const application: Partial<Record<keyof ApplicationFields, unknown>> = sent !== null && typeof sent === 'object' ? sent : {}

  const dates = Array.isArray(application.dates) ? [...new Set(application.dates)].sort() : []
  if (dates.length === 0) throw new InvalidApplication('Choisis au moins une date.')
  if (!dates.every((date) => typeof date === 'string' && isDay(date))) throw new InvalidApplication('Une des dates est invalide.')

  const timeSlots = new Map<string, TimeSlot>()
  for (const slot of Array.isArray(application.timeSlots) ? application.timeSlots : []) {
    const { start, end }: Partial<Record<keyof TimeSlot, unknown>> = slot !== null && typeof slot === 'object' ? slot : {}
    if (typeof start !== 'string' || typeof end !== 'string' || !isTime(start) || !isTime(end) || start >= end) {
      throw new InvalidApplication('Une des plages horaires est invalide.')
    }
    timeSlots.set(`${start}-${end}`, { start, end })
  }

  const prestations: string[] = []
  for (const sentPrestation of Array.isArray(application.prestations) ? application.prestations : []) {
    const prestation = line(sentPrestation, 'Une prestation', PRESTATION_MAX_LENGTH, null, InvalidApplication)
    if (prestation && !prestations.some((other) => other.toLowerCase() === prestation.toLowerCase())) prestations.push(prestation)
  }

  const details = text(application.details, 'Le champ « Questions ou détails »', DETAILS_MAX_LENGTH, null, InvalidApplication)

  return { dates, timeSlots: [...timeSlots.keys()].sort().map((key) => timeSlots.get(key)!), prestations, details }
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
  // Throws a NoSuchArtist.
  create(application: ApplicationFields & { artistId: string; createdBy: string }): Promise<StoredApplication>
  // Replaces the application's fields, and returns the updated application.
  update(id: string, changes: ApplicationFields & { updatedBy: string; updatedAt: Date }): Promise<StoredApplication | null>
  // Changes the application's status, and returns the updated application.
  setStatus(id: string, change: { status: ApplicationStatus; statusUpdatedBy: string; statusUpdatedAt: Date }): Promise<StoredApplication | null>
  // Returns false if the application didn't exist.
  delete(id: string): Promise<boolean>
}

export function applicationsStore(db: typeof Database): ApplicationsStore {
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
