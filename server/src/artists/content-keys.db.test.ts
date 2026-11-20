import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buffer } from 'node:stream/consumers'
import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { AdminCollectiveProfile } from '../collectives/profile.js'
import { collectivesStore } from '../collectives/store.js'
import { privateBucket } from '../core/private-bucket.js'
import type { PrivateFiles } from '../core/private-bucket.js'
import { artists, collectives, sessions } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsStore } from '../sessions/store.js'
import { storedImages } from './backfill.js'
import { contentKeysMigration } from './content-keys.js'
import { AdminArtistProfile } from './profile.js'
import { PHOTO_WIDTHS, sizeKey } from './sizes.js'
import { artistsStore, photoColumns, photoKey, privatePhotos, validateProfile } from './store.js'
import type { PhotoFolder } from './store.js'
import { keptFiles, testImage } from './test-photos.js'

// Moving the photos and flyers kept under random keys to the keys made from their content, when the server starts (see
// artists/content-keys.ts).

let database: TestDatabase
let directory: string
let files: PrivateFiles
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
const logger = log as unknown as FastifyBaseLogger
const createdBy = 'admin@example.com'
const UPDATED_AT = new Date('2026-01-01T12:00:00Z')
let jpeg: Buffer
let png: Buffer

beforeAll(async () => {
  database = await testDatabase()
  jpeg = await testImage('jpeg', 640, 480)
  png = await testImage('png', 480, 640)
})

afterAll(async () => {
  await database?.drop()
})

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'content-keys-'))
  files = privateBucket({ directory })
  vi.clearAllMocks()
})

afterEach(async () => {
  await database.db.delete(sessions)
  await database.db.delete(collectives)
  await database.db.delete(artists)
  await rm(directory, { recursive: true, force: true })
})

const kept = () => keptFiles(directory)
const read = async (key: string) => buffer((await files.read(key))!)
const contentKey = (folder: PhotoFolder, body: Buffer, type: string) => photoKey({ body, type }, folder)

// A key from before, with the photo and the sizes it's given stored under it, which only need to be told apart from
// those that would be made again.
async function legacy(folder: string, body: Buffer | null, type: string, widths: readonly number[] = PHOTO_WIDTHS) {
  const key = `${folder}/${randomUUID()}.${type === 'image/png' ? 'png' : 'jpg'}`
  if (body) await files.put(key, body, type)
  for (const width of widths) await files.put(sizeKey(key, width as 320 | 1280), Buffer.from(`${key} at ${width}`), 'image/webp')
  return { key, type }
}

async function artist(name: string, photo: { key: string; type: string } | null) {
  const { id } = await artistsStore(database.db).create({ ...validateProfile({ name }, AdminArtistProfile), photo: null, createdBy })
  await database.db
    .update(artists)
    .set({ ...photoColumns(photo), updatedBy: createdBy, updatedAt: UPDATED_AT })
    .where(eq(artists.id, id))
  return id
}

async function session(photo: { key: string; type: string }) {
  const { id } = await sessionsStore(database.db).create(
    { startAt: null, durationMinutes: 60, type: 'synth-meetup', takeoverId: null, applicationId: null, name: '', raEventId: null, description: '', flyer: null, createdBy },
    [],
  )
  await database.db.update(sessions).set({ flyerKey: photo.key, flyerType: photo.type, updatedBy: createdBy, updatedAt: UPDATED_AT }).where(eq(sessions.id, id))
  return id
}

const keyOf = async (table: typeof artists | typeof collectives, id: string) =>
  (await database.db.select({ key: table.photoKey }).from(table).where(eq(table.id, id)))[0].key
const flyerOf = async (id: string) => (await database.db.select().from(sessions).where(eq(sessions.id, id)))[0]

function migrate(through = files, stopping = () => false) {
  const photos = privatePhotos(through, database.db, logger)
  return contentKeysMigration(() => storedImages(database.db), database.db, photos, logger)(stopping)
}

it('moves every photo and flyer to the key made from its content, with the sizes it has, merging those that are the same', async () => {
  const ana = await artist('Ana', await legacy('artists', jpeg, 'image/jpeg'))
  // A collective whose photo is under `artists/`, from when it was an artist.
  const { id: ondes } = await collectivesStore(database.db).create({
    ...validateProfile({ name: 'Les Ondes', members: [{ id: ana }] }, AdminCollectiveProfile),
    photo: null,
    createdBy,
  })
  const ondesPhoto = await legacy('artists', png, 'image/png')
  await database.db.update(collectives).set({ photoKey: ondesPhoto.key, photoType: ondesPhoto.type }).where(eq(collectives.id, ondes))
  // The same flyer for two sessions, one of them with only one size, and one that can't be read, which has none.
  const first = await legacy('sessions', png, 'image/png', [320])
  const second = await legacy('sessions', png, 'image/png')
  const cut = await legacy('sessions', jpeg.subarray(0, jpeg.length / 2), 'image/jpeg', [])
  const firstSession = await session(first)
  const secondSession = await session(second)
  const cutSession = await session(cut)
  // One that's missing from the bucket.
  const lost = await artist('Brume', await legacy('artists', null, 'image/jpeg', []))
  const lostKey = await keyOf(artists, lost)

  await migrate()

  const flyer = contentKey('sessions', png, 'image/png')
  const cutFlyer = contentKey('sessions', jpeg.subarray(0, jpeg.length / 2), 'image/jpeg')
  expect(await keyOf(artists, ana)).toBe(contentKey('artists', jpeg, 'image/jpeg'))
  expect(await keyOf(collectives, ondes)).toBe(contentKey('collectives', png, 'image/png'))
  for (const id of [firstSession, secondSession]) {
    expect(await flyerOf(id)).toMatchObject({ flyerKey: flyer, flyerType: 'image/png', updatedBy: createdBy, updatedAt: UPDATED_AT })
  }
  expect((await flyerOf(cutSession)).flyerKey).toBe(cutFlyer)
  expect(await keyOf(artists, lost)).toBe(lostKey)
  // The old files are gone, and the sizes are those it had, not made again.
  expect(await kept()).toEqual(
    [
      ...[contentKey('artists', jpeg, 'image/jpeg'), contentKey('collectives', png, 'image/png'), flyer].flatMap((key) => [key, sizeKey(key, 320), sizeKey(key, 1280)]),
      cutFlyer,
    ].sort(),
  )
  expect(await read(contentKey('artists', jpeg, 'image/jpeg'))).toEqual(jpeg)
  expect((await read(sizeKey(contentKey('collectives', png, 'image/png'), 1280))).toString()).toBe(`${ondesPhoto.key} at 1280`)
  // The first session's size, and the second's that the first didn't have.
  expect((await read(sizeKey(flyer, 320))).toString()).toBe(`${first.key} at 320`)
  expect((await read(sizeKey(flyer, 1280))).toString()).toBe(`${second.key} at 1280`)

  expect(log.info).toHaveBeenCalledWith({ images: 6 }, 'Moving photos and flyers to keys made from their content')
  expect(log.warn).toHaveBeenCalledExactlyOnceWith({ of: 'artist', id: lost, key: lostKey }, 'A photo or flyer to move to a key made from its content is missing')
  expect(log.info).toHaveBeenLastCalledWith({ moved: 5, changed: 0, missing: 1, failed: 0, left: 1 }, 'Moved photos and flyers to keys made from their content')
  expect(log.error).not.toHaveBeenCalled()

  // The next time, only the one that's missing is left.
  vi.clearAllMocks()
  await migrate()
  expect(log.info).toHaveBeenCalledWith({ images: 1 }, 'Moving photos and flyers to keys made from their content')
  expect(log.info).toHaveBeenLastCalledWith({ moved: 0, changed: 0, missing: 1, failed: 0, left: 1 }, 'Moved photos and flyers to keys made from their content')
})

it("leaves a row whose photo changed meanwhile as it is, and deletes the photo it stored unless something uses it", async () => {
  const replaced = await legacy('artists', jpeg, 'image/jpeg')
  const ana = await artist('Ana', replaced)
  const removed = await legacy('artists', png, 'image/png')
  const brume = await artist('Brume', removed)
  // Another artist already has Brume's photo under the key made from its content.
  const cleo = await artist('Cléo', null)
  const pngKey = contentKey('artists', png, 'image/png')
  await files.put(pngKey, png, 'image/png')
  await database.db.update(artists).set({ photoKey: pngKey, photoType: 'image/png' }).where(eq(artists.id, cleo))

  // Each one is replaced, or removed, as it's read, as an admin would meanwhile.
  const changing: PrivateFiles = {
    ...files,
    read: async (key) => {
      if (key === replaced.key) await database.db.update(artists).set({ photoKey: 'artists/other.jpg' }).where(eq(artists.id, ana))
      if (key === removed.key) await database.db.update(artists).set({ photoKey: null, photoType: null }).where(eq(artists.id, brume))
      return files.read(key)
    },
  }
  await migrate(changing)

  expect(await keyOf(artists, ana)).toBe('artists/other.jpg')
  expect(await keyOf(artists, brume)).toBeNull()
  // The one it stored for Ana is deleted, but not Cléo's.
  expect(await files.exists(contentKey('artists', jpeg, 'image/jpeg'))).toBe(false)
  expect(await files.exists(pngKey)).toBe(true)
  expect(log.info).toHaveBeenLastCalledWith(expect.objectContaining({ moved: 0, changed: 2 }), 'Moved photos and flyers to keys made from their content')
})

it('logs the photos it fails to move, and goes on with the others', async () => {
  const failing = await legacy('artists', jpeg, 'image/jpeg')
  const ana = await artist('Ana', failing)
  const brume = await artist('Brume', await legacy('artists', png, 'image/png'))
  await migrate({ ...files, put: async (key, ...rest) => (key.endsWith('.jpg') ? Promise.reject(new Error('S3 is down')) : files.put(key, ...rest)) })

  expect(await keyOf(artists, ana)).toBe(failing.key)
  expect(await keyOf(artists, brume)).toBe(contentKey('artists', png, 'image/png'))
  expect(log.error).toHaveBeenCalledWith(
    expect.objectContaining({ of: 'artist', id: ana, key: failing.key, err: expect.any(Error) }),
    'Failed to move a photo or flyer to a key made from its content',
  )
  expect(log.info).toHaveBeenLastCalledWith({ moved: 1, changed: 0, missing: 0, failed: 1, left: 1 }, 'Moved photos and flyers to keys made from their content')
})

it('stops before the next photo once it is asked to', async () => {
  const ana = await artist('Ana', await legacy('artists', jpeg, 'image/jpeg'))
  const brume = await artist('Brume', await legacy('artists', png, 'image/png'))
  let moving = 0
  await migrate(files, () => moving++ > 0)
  const moved = [await keyOf(artists, ana), await keyOf(artists, brume)].filter((key) => key!.length > 60)
  expect(moved).toHaveLength(1)
  expect(log.info).toHaveBeenLastCalledWith({ moved: 1, changed: 0, missing: 0, failed: 0 }, 'Stopped moving photos and flyers to keys made from their content')
})

it('logs, rather than throws, when it fails to list the photos', async () => {
  const photos = privatePhotos(files, database.db, logger)
  await contentKeysMigration(async () => Promise.reject(new Error('The database is down')), database.db, photos, logger)(() => false)
  expect(log.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Failed to move photos and flyers to keys made from their content')
})
