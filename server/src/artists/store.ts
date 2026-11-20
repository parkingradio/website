import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'
import { and, asc, eq, exists, or, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { z } from 'zod'
import { PHOTO_MAX_BYTES, PHOTO_TOO_LARGE, PHOTO_UNREADABLE, PHOTO_WRONG_TYPE } from './profile.js'
import { PHOTO_WIDTHS, SIZE_TYPE, makeSizes, sizeKey } from './sizes.js'
import type { PhotoWidth } from './sizes.js'
import type { AdminArtistProfile, Profile } from './profile.js'
import type { Queryable } from '../db/connection.js'
import type { PrivateFiles } from '../core/private-bucket.js'
import { artists, collectiveMembers, collectives, sessions } from '../db/schema.js'
import { violatesConstraint } from '../api/errors.js'
import type { Reference } from '../api/schemas.js'
import { isUuid } from '../db/uuid.js'
import { isPublicArtist } from '../events/store.js'
import { lockSessions } from '../sessions/store.js'

// Checks the profiles and photos sent for artists against the rules in artists/profile.ts, keeps artists in the
// database, and keeps their photos in the private bucket.

// Thrown when a profile or photo is invalid. Its message tells the artist what's wrong, in French. `path` is where in the
// profile, when it's about one of its fields.
export class InvalidProfile extends Error {
  path: PropertyKey[]

  constructor(message: string, path: PropertyKey[] = []) {
    super(message)
    this.path = path
  }
}

// Checks a profile, an artist's or a collective's, against `schema`, which says who sent it, and returns what's saved of
// it. Throws an InvalidProfile, saying what's wrong with the first field that's wrong, otherwise.
export function validateProfile(sent: unknown, schema: typeof AdminArtistProfile): Profile
export function validateProfile<Schema extends z.ZodType>(sent: unknown, schema: Schema): z.output<Schema>
export function validateProfile(sent: unknown, schema: z.ZodType): unknown {
  const result = schema.safeParse(sent)
  if (!result.success) throw new InvalidProfile(result.error.issues[0].message, result.error.issues[0].path)
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

// What's wrong with a photo, as an artist is told, or, e.g., what's wrong with a session's flyer.
export type PhotoErrors = { wrongType: string; tooLarge: string; unreadable: string }
export const PHOTO_ERRORS: PhotoErrors = { wrongType: PHOTO_WRONG_TYPE, tooLarge: PHOTO_TOO_LARGE, unreadable: PHOTO_UNREADABLE }

// Checks the photo, from its type as told from its contents, and returns it with that type, or null when there's none.
// Throws an InvalidProfile otherwise, with the message of `errors` that says what's wrong.
export function validatePhoto(body: Buffer | undefined, errors = PHOTO_ERRORS): SentPhoto | null {
  if (!body) return null
  const type = photoType(body)
  if (!type) throw new InvalidProfile(errors.wrongType)
  if (body.length > PHOTO_MAX_BYTES) throw new InvalidProfile(errors.tooLarge)
  return { body, type }
}

// A photo that was sent and checked, with its sizes (see sizes.ts).
export type SizedPhoto = SentPhoto & { sizes: Map<PhotoWidth, Buffer> }

// Reads the photo, and returns it with its sizes. Throws an InvalidProfile, with the message of `errors` that says so,
// when it can't be read.
export async function withSizes(photo: SentPhoto, errors = PHOTO_ERRORS): Promise<SizedPhoto> {
  try {
    return { ...photo, sizes: await makeSizes(photo.body) }
  } catch {
    // An UnreadablePhoto, as makeSizes throws.
    throw new InvalidProfile(errors.unreadable)
  }
}

// Checks the photo, like `validatePhoto`, then reads it, like `withSizes`, and returns it with its sizes, or null when
// there's none.
export async function readPhoto(body: Buffer | undefined, errors = PHOTO_ERRORS): Promise<SizedPhoto | null> {
  const photo = validatePhoto(body, errors)
  return photo && withSizes(photo, errors)
}

// An artist, as the database keeps them, and with the collectives they're in, by name, whatever its case.
export type ArtistRow = typeof artists.$inferSelect
export type StoredArtist = ArtistRow & { collectives: Reference[] }

// What an artist or a collective stores of `photo`, a photo that was stored, or null for none: where it's stored (see
// `Photos`), and its MIME type, or nulls, never one without the other, which the database checks too.
export function photoColumns(photo: Pick<NewPhoto, 'key' | 'type'> | null) {
  return { photoKey: photo?.key ?? null, photoType: photo?.type ?? null }
}

// Thrown when saving an artist with the email of another one, whatever its case, and a collective with the email of
// another collective.
export class EmailTaken extends Error {}

// The artists, as the admin pages manage them. Each method that's about one artist returns null when there's no such
// artist, which is the case of any id that isn't a UUID.
export type ArtistsStore = {
  // By name, whatever its case, or only the members of the collective with `collectiveId`, in its order: none when
  // there's no such collective.
  list(collectiveId?: string): Promise<StoredArtist[]>
  get(id: string): Promise<StoredArtist | null>
  // The artist, without their collectives, only when they're public (see "Public profiles" in
  // docs/design/server/artists.md).
  getPublic(id: string): Promise<ArtistRow | null>
  // `createdBy` is the email of the admin who adds the artist, or null if they come through the form, applying alone or
  // as one of a collective's artists. `photo` is their photo, once it's stored, or null for none.
  // Throws an EmailTaken.
  create(artist: Profile & { photo: NewPhoto | null; createdBy: string | null }): Promise<StoredArtist>
  // Changes the fields of the artist's profile that `changes` has, and their photo when it has one: a new one, once
  // it's stored, or null to remove it. Returns the artist as they were, so that a photo that was replaced or removed
  // can be deleted, and as they are then. Throws an EmailTaken.
  update(
    id: string,
    changes: Partial<Profile> & { photo?: NewPhoto | null; updatedBy: string; updatedAt: Date },
  ): Promise<{ before: ArtistRow; after: StoredArtist } | null>
  // Returns the artist as they were, so that their photo can be deleted too. They're taken out of their collectives and
  // their sets.
  delete(id: string): Promise<ArtistRow | null>
}

// The collectives that each artist is in, by name, whatever its case, or only those of the artist with `artistId`.
async function collectivesOf(db: Queryable, artistId?: string): Promise<Map<string, Reference[]>> {
  const rows = await db
    .select({ artistId: collectiveMembers.artistId, id: collectives.id, name: collectives.name })
    .from(collectiveMembers)
    .innerJoin(collectives, eq(collectives.id, collectiveMembers.collectiveId))
    .where(artistId === undefined ? undefined : eq(collectiveMembers.artistId, artistId))
    .orderBy(asc(sql`lower(${collectives.name})`))
  const found = new Map<string, Reference[]>()
  for (const { artistId, ...collective } of rows) {
    if (!found.has(artistId)) found.set(artistId, [])
    found.get(artistId)!.push(collective)
  }
  return found
}

async function withCollectives(db: Queryable, row: ArtistRow): Promise<StoredArtist> {
  return { ...row, collectives: (await collectivesOf(db, row.id)).get(row.id) ?? [] }
}

export function artistsStore(db: Queryable): ArtistsStore {
  return {
    async list(collectiveId) {
      if (collectiveId !== undefined && !isUuid(collectiveId)) return []
      const rows =
        collectiveId === undefined
          ? await db.select().from(artists).orderBy(asc(sql`lower(${artists.name})`))
          : (
              await db
                .select({ artist: artists })
                .from(collectiveMembers)
                .innerJoin(artists, eq(artists.id, collectiveMembers.artistId))
                .where(eq(collectiveMembers.collectiveId, collectiveId))
                .orderBy(asc(collectiveMembers.position))
            ).map((member) => member.artist)
      const found = await collectivesOf(db)
      return rows.map((row) => ({ ...row, collectives: found.get(row.id) ?? [] }))
    },

    async get(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select().from(artists).where(eq(artists.id, id))
      return row ? withCollectives(db, row) : null
    },

    async getPublic(id) {
      if (!isUuid(id)) return null
      const [row] = await db
        .select()
        .from(artists)
        .where(and(eq(artists.id, id), isPublicArtist(db, artists.id)))
      return row ?? null
    },

    async create({ photo, ...artist }) {
      const insert = async (tx: Queryable) => {
        await photo?.keep(tx)
        const [row] = await tx.insert(artists).values({ ...artist, ...photoColumns(photo) }).returning()
        return row
      }
      try {
        // Only in a transaction of its own when there's a photo to keep with it.
        const row = photo ? await db.transaction(insert) : await insert(db)
        return { ...row, collectives: [] }
      } catch (error) {
        if (violatesConstraint(error, 'artists_email_lower_idx')) throw new EmailTaken()
        throw error
      }
    },

    async update(id, { photo, ...changes }) {
      if (!isUuid(id)) return null
      try {
        return await db.transaction(async (tx) => {
          // Before the artist's row is locked (see `Photos`).
          await photo?.keep(tx)
          // Like the update itself, which doesn't change a key, so that it doesn't wait for sets' performers referring to
          // the artist (see `lockSessions` in sessions/store.ts).
          const [before] = await tx.select().from(artists).where(eq(artists.id, id)).for('no key update')
          if (!before) return null
          const [after] = await tx
            .update(artists)
            .set({ ...changes, ...(photo === undefined ? {} : photoColumns(photo)) })
            .where(eq(artists.id, id))
            .returning()
          return { before, after: await withCollectives(tx, after) }
        })
      } catch (error) {
        if (violatesConstraint(error, 'artists_email_lower_idx')) throw new EmailTaken()
        throw error
      }
    },

    async delete(id) {
      if (!isUuid(id)) return null
      return db.transaction(async (tx) => {
        // Deleting them deletes their rows in set_performers, which writes sets' performers, and their applications, which
        // takes them from their sets (see `lockSessions`).
        await lockSessions(tx)
        const [row] = await tx.delete(artists).where(eq(artists.id, id)).returning()
        return row ?? null
      })
    },
  }
}

// Where new photos are stored: artists' under `artists/`, collectives' under `collectives/`, and sessions' flyers under
// `sessions/`, so that each kind only shares its photos with its own (see `photoKey`). Otherwise, what's stored is the
// photo's key, which is read and deleted as it is, whatever folder it's in.
export type PhotoFolder = 'artists' | 'collectives' | 'sessions'

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// The key of `photo` in `folder`: the SHA-256 of its content, in hex, so that a photo that's the same, byte for byte,
// as one that's stored in that folder is stored once, with its sizes, however many have it (see "Private files" in
// docs/deployment.md).
export function photoKey({ body, type }: SentPhoto, folder: PhotoFolder): string {
  return `${folder}/${createHash('sha256').update(body).digest('hex')}.${EXTENSIONS[type] ?? 'bin'}`
}

// A photo or a flyer that was stored (see `Photos`): its key, its MIME type, and `keep`, which the transaction that
// saves it in a row calls before it takes any lock but the sessions' (see `lockPhotos`).
export type NewPhoto = { key: string; type: string; keep(tx: Queryable): Promise<void> }

// Artists' and collectives' photos, and sessions' flyers, and their sizes. They're private files (see
// core/private-bucket.ts), rather than public assets: photos are personal data, and both are only for admins until
// their artist, collective or session is public, when the server serves their sizes to anyone (see
// docs/design/server/events.md).
//
// Each one is stored once, however many artists, collectives or sessions have it, and deleted once none has it anymore.
// So that it's never deleted from under a row that starts using it, both take the photos' lock (see `lockPhotos`):
// - A transaction that saves a photo in a row first calls its `keep`, which takes the lock, and stores again what was
//   deleted since `store` stored it, then saves the row: once the transaction ends, the row is committed, and the
//   photo is there.
// - `deleteUnused` takes the lock in a transaction of its own, then reads whether a row has the photo, as committed by
//   then, and only deletes it when none has.
// Both call the bucket while they hold the lock, and `keep` while its transaction is open, e.g. while it holds the
// sessions' lock, for a flyer: a request to S3 that stalls holds up the other photos' changes, and, for a flyer, the
// writes of sessions and sets, for up to its 30 seconds (see core/private-bucket.ts).
// `deleteUnused` must never be called while a transaction holds the photos' lock, e.g. after `keep` and before that
// transaction ends, even when it fails: it would wait for that transaction, from another connection, while that
// transaction waits for it, which Postgres can't tell, and the request would hang.
export type Photos = Pick<PrivateFiles, 'read'> & {
  // Stores the photo, and the sizes it has, under its key in `folder` (see `photoKey`), unless they're there already,
  // and returns it. If one can't be stored, the photo is deleted unless it's used, or that failure is logged, and the
  // error is thrown.
  store(photo: SizedPhoto, folder: PhotoFolder): Promise<NewPhoto>
  // The size at `width` of the photo with that key, or null when there's none, e.g. when the photo itself is missing.
  readSize(key: string, width: PhotoWidth): Promise<Readable | null>
  // Deletes the photo with that key and its sizes, unless an artist, a collective or a session has it.
  deleteUnused(key: string): Promise<void>
}

// Any key but the sessions' lock's (see `lockSessions` in sessions/store.ts).
const PHOTOS_LOCK = 0x9407

// Takes the photos' lock (see `Photos`), until the transaction `tx` ends. Every transaction that takes it takes it
// before any other lock but the sessions' (see `lockSessions` in sessions/store.ts), e.g. before the row of the artist
// whose photo it changes, so that it can't be part of a deadlock.
export async function lockPhotos(tx: Queryable) {
  await tx.execute(sql`select pg_advisory_xact_lock(${PHOTOS_LOCK})`)
}

// Whether an artist, a collective or a session has the photo with `key`. Every table is checked, whatever folder the
// key is in, only because some collectives' photos are still under `artists/`, from when they were artists (see
// drizzle/0004_collectives.sql), until they're moved (see artists/content-keys.ts): once they are, only the table of
// the key's folder needs to be, in step 3 of #200.
async function isUsed(tx: Queryable, key: string): Promise<boolean> {
  const used = or(
    exists(tx.select().from(artists).where(eq(artists.photoKey, key))),
    exists(tx.select().from(collectives).where(eq(collectives.photoKey, key))),
    exists(tx.select().from(sessions).where(eq(sessions.flyerKey, key))),
  )
  const { rows } = await tx.execute<{ used: boolean }>(sql`select ${used} as used`)
  return rows[0].used
}

// The photos, kept in `files`, and used by the rows of `db`. `log` gets what fails to be deleted.
export function privatePhotos(files: PrivateFiles, db: Queryable, log: FastifyBaseLogger): Photos {
  const photos: Photos = {
    async store(photo, folder) {
      const key = photoKey(photo, folder)
      try {
        await putMissing(files, key, photo)
      } catch (error) {
        await forgetPhoto(photos, log, key)
        throw error
      }
      return {
        key,
        type: photo.type,
        // When it fails, the photo is deleted, unless it's used, once the transaction is rolled back, by whoever saves
        // it.
        keep: async (tx) => {
          await lockPhotos(tx)
          await putMissing(files, key, photo)
        },
      }
    },
    read: files.read,
    readSize: (key, width) => files.read(sizeKey(key, width)),
    deleteUnused: (key) =>
      db.transaction(async (tx) => {
        await lockPhotos(tx)
        if (!(await isUsed(tx, key))) await deletePhoto(files, key)
      }),
  }
  return photos
}

// Stores the photo and the sizes it has under `key`, those that aren't there.
async function putMissing(files: PrivateFiles, key: string, { body, type, sizes }: SizedPhoto) {
  if (!(await files.exists(key))) await files.put(key, body, type)
  for (const [width, size] of sizes) {
    if (!(await files.exists(sizeKey(key, width)))) await files.put(sizeKey(key, width), size, SIZE_TYPE)
  }
}

async function putSizes(files: PrivateFiles, key: string, sizes: Map<PhotoWidth, Buffer>) {
  for (const [width, size] of sizes) await files.put(sizeKey(key, width), size, SIZE_TYPE)
}

// The photo first, then its sizes, so that a size made in the meantime (see `completeSizes`) is deleted either here or
// where it's made.
async function deletePhoto(files: PrivateFiles, key: string) {
  await files.delete(key)
  await Promise.all(PHOTO_WIDTHS.map((width) => files.delete(sizeKey(key, width))))
}

// Makes the sizes that the photo with `key` doesn't have, e.g. one stored before there were sizes (see
// artists/backfill.ts), and returns whether it had them all, they were made, or the photo is missing, e.g. because it was
// deleted or replaced. Throws an UnreadablePhoto when it can't be read.
export async function completeSizes(
  files: PrivateFiles,
  photos: Pick<Photos, 'deleteUnused'>,
  key: string,
  log: FastifyBaseLogger,
): Promise<'complete' | 'made' | 'missing'> {
  const kept = await Promise.all(PHOTO_WIDTHS.map((width) => files.exists(sizeKey(key, width))))
  const missing = PHOTO_WIDTHS.filter((_, index) => !kept[index])
  if (missing.length === 0) return 'complete'
  const photo = await files.read(key)
  if (!photo) return 'missing'
  const sizes = await makeSizes(await buffer(photo), missing)
  const failed = await putSizes(files, key, sizes).then(
    () => null,
    (error: unknown) => ({ error }),
  )
  // The photo may have been deleted while they were made, after the sizes it had were: then those that were stored are
  // deleted too, unless a row has started using the photo again since, which stores it again (see `Photos`).
  const deleted = !(await files.exists(key))
  if (deleted) await forgetPhoto(photos, log, key)
  if (failed) throw failed.error
  return deleted ? 'missing' : 'made'
}

// Stores the photo that was sent, if there's one, in `folder`, with its sizes, and returns it, or null when there's
// none.
export async function storePhoto(photos: Pick<Photos, 'store'>, photo: SizedPhoto | null, folder: PhotoFolder): Promise<NewPhoto | null> {
  return photo && photos.store(photo, folder)
}

// Deletes a photo (or a flyer) that was stored, if there's one, unless something uses it, e.g. one that was replaced or
// removed, or one that was stored for a request that failed. Never while a transaction holds its lock (see `Photos`).
// If that fails, the error is only logged, so that the request it's part of can still succeed.
export async function forgetPhoto(photos: Pick<Photos, 'deleteUnused'>, log: FastifyBaseLogger, key: string | null | undefined) {
  if (!key) return
  await photos.deleteUnused(key).catch((error: unknown) => {
    log.error({ err: error, key }, 'Failed to delete a photo that is not used anymore')
  })
}
