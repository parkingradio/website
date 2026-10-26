import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { PHOTO_MAX_BYTES, PHOTO_TOO_LARGE, PHOTO_WRONG_TYPE } from './artist-profile.js'
import type { AdminArtistProfile, ArtistProfile, Profile } from './artist-profile.js'
import type { Queryable } from './db.js'
import type { PrivateFiles } from './private-bucket.js'
import { artists } from './schema.js'
import { violatesConstraint } from './query-errors.js'
import { isUuid } from './uuid.js'

// Checks the profiles and photos sent for artists against the rules in artist-profile.ts, keeps artists in the database,
// and keeps their photos in the private bucket.

// Thrown when a profile or photo is invalid. Its message tells the artist what's wrong, in French.
export class InvalidProfile extends Error {}

// Checks a profile against `schema`, which says who sent it, and returns what's saved of it. Throws an InvalidProfile,
// saying what's wrong with the first field that's wrong, otherwise.
export function validateProfile(sent: unknown, schema: typeof ArtistProfile | typeof AdminArtistProfile): Profile {
  const result = schema.safeParse(sent)
  if (!result.success) throw new InvalidProfile(result.error.issues[0].message)
  return result.data
}

// A photo that was sent, and its MIME type, as checked from its contents.
export type SentPhoto = { body: Buffer; type: string }

// The type of a photo, told from its first bytes rather than trusting what the browser says: JPEG, PNG or WebP, or
// null for anything else.
function photoType(body: Buffer): string | null {
  if (body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg'
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

// Checks the photo, from its type as told from its contents, and returns it with that type, or null when there's none.
// Throws an InvalidProfile otherwise.
export function validatePhoto(body: Buffer | undefined): SentPhoto | null {
  if (!body) return null
  const type = photoType(body)
  if (!type) throw new InvalidProfile(PHOTO_WRONG_TYPE)
  if (body.length > PHOTO_MAX_BYTES) throw new InvalidProfile(PHOTO_TOO_LARGE)
  return { body, type }
}

export type StoredArtist = typeof artists.$inferSelect

// Where the photo of an artist is stored (see `Photos`), and its MIME type, or nulls when they have none: never one
// without the other, which the database checks too.
export type StoredPhoto = { photoKey: string; photoType: string } | { photoKey: null; photoType: null }

const NO_PHOTO: StoredPhoto = { photoKey: null, photoType: null }

// Thrown when saving an artist with the email of another one, whatever its case.
export class EmailTaken extends Error {}

// The artists, as the admin pages manage them. Each method that's about one artist returns null when there's no such
// artist, which is the case of any id that isn't a UUID.
export type ArtistsStore = {
  // By name, whatever its case.
  list(): Promise<StoredArtist[]>
  get(id: string): Promise<StoredArtist | null>
  // `createdBy` is the email of the admin who adds the artist, or null if the artist adds themselves by applying.
  // Throws an EmailTaken.
  create(artist: Profile & StoredPhoto & { createdBy: string | null }): Promise<StoredArtist>
  // Replaces the artist's profile, and their photo when there's a new one, or nulls to remove it. Returns the artist as
  // they were, so that a photo that was replaced or removed can be deleted, and as they are then. Throws an EmailTaken.
  update(
    id: string,
    changes: Profile & (StoredPhoto | Record<never, never>) & { updatedBy: string; updatedAt: Date },
  ): Promise<{ before: StoredArtist; after: StoredArtist } | null>
  // Returns the artist as they were, so that their photo can be deleted too.
  delete(id: string): Promise<StoredArtist | null>
}

export function artistsStore(db: Queryable): ArtistsStore {
  return {
    async list() {
      return db.select().from(artists).orderBy(asc(sql`lower(${artists.name})`))
    },

    async get(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select().from(artists).where(eq(artists.id, id))
      return row ?? null
    },

    async create(artist) {
      try {
        const [row] = await db.insert(artists).values(artist).returning()
        return row
      } catch (error) {
        if (violatesConstraint(error, 'artists_email_lower_idx')) throw new EmailTaken()
        throw error
      }
    },

    async update(id, changes) {
      if (!isUuid(id)) return null
      try {
        return await db.transaction(async (tx) => {
          const [before] = await tx.select().from(artists).where(eq(artists.id, id)).for('update')
          if (!before) return null
          const [after] = await tx.update(artists).set(changes).where(eq(artists.id, id)).returning()
          return { before, after }
        })
      } catch (error) {
        if (violatesConstraint(error, 'artists_email_lower_idx')) throw new EmailTaken()
        throw error
      }
    },

    async delete(id) {
      if (!isUuid(id)) return null
      const [row] = await db.delete(artists).where(eq(artists.id, id)).returning()
      return row ?? null
    },
  }
}

// Artists' photos. They're personal data, so they're private files (see private-bucket.ts), under `artists/`, rather
// than public assets.
export type Photos = Pick<PrivateFiles, 'read' | 'delete'> & {
  // Stores the photo under a new key, and returns that key.
  store(photo: SentPhoto): Promise<string>
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export function artistPhotos(files: PrivateFiles): Photos {
  return {
    async store({ body, type }) {
      const key = `artists/${randomUUID()}.${EXTENSIONS[type] ?? 'bin'}`
      await files.put(key, body, type)
      return key
    },
    read: files.read,
    delete: files.delete,
  }
}

// Stores the photo that was sent, if there's one, and returns where, as an artist keeps it.
export async function storePhoto(photos: Pick<Photos, 'store'>, photo: SentPhoto | null): Promise<StoredPhoto> {
  return photo ? { photoKey: await photos.store(photo), photoType: photo.type } : NO_PHOTO
}

// Deletes a photo that was stored but that no artist uses, or uses anymore, if there's one. If that fails, the error is
// only logged, so that the request it's part of can still succeed.
export async function forgetPhoto(photos: Pick<Photos, 'delete'>, log: FastifyBaseLogger, key: string | null) {
  if (!key) return
  await photos.delete(key).catch((error: unknown) => {
    log.error({ err: error, key }, 'Failed to delete a photo that is not used anymore')
  })
}
