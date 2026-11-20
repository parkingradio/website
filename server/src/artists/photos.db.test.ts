import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { applyStore } from '../applications/apply-store.js'
import { validateApplication } from '../applications/store.js'
import { collectivesStore } from '../collectives/store.js'
import { AdminCollectiveProfile, ApplicantCollectiveProfile } from '../collectives/profile.js'
import { privateBucket } from '../core/private-bucket.js'
import type { PrivateFiles } from '../core/private-bucket.js'
import type { db as Database } from '../db/connection.js'
import { artists, collectives, sessions } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsStore } from '../sessions/store.js'
import type { PhotoFolder } from './keys.js'
import { AdminArtistProfile } from './profile.js'
import { PHOTO_WIDTHS, sizeKey } from './sizes.js'
import { artistsStore, completeSizes, forgetPhoto, privatePhotos, validateProfile, withSizes } from './store.js'
import type { NewPhoto, SizedPhoto } from './store.js'
import { keptFiles, testImage } from './test-photos.js'

// Photos and flyers are stored once, however many artists, collectives or sessions have them, and deleted once none has
// them anymore, never from under one that starts using them (see `Photos` in artists/store.ts).

let database: TestDatabase
let directory: string
let files: PrivateFiles
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
const logger = log as unknown as FastifyBaseLogger
const createdBy = 'admin@example.com'
let photo: SizedPhoto
let other: SizedPhoto

beforeAll(async () => {
  database = await testDatabase()
  photo = await withSizes({ body: await testImage('jpeg', 2000, 1000), type: 'image/jpeg' })
  other = await withSizes({ body: await testImage('png', 640, 480), type: 'image/png' })
})

afterAll(async () => {
  await database?.drop()
})

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'photos-'))
  files = privateBucket({ directory })
  vi.clearAllMocks()
})

afterEach(async () => {
  await database.db.delete(sessions)
  await database.db.delete(collectives)
  await database.db.delete(artists)
  await rm(directory, { recursive: true, force: true })
})

const photos = (through = files) => privatePhotos(through, database.db, logger)

// The files that are kept, by key.
const kept = () => keptFiles(directory)
const filesOf = (key: string) => [key, ...PHOTO_WIDTHS.map((width) => sizeKey(key, width))].sort()

const artist = (name: string, newPhoto: NewPhoto | null) =>
  artistsStore(database.db).create({ ...validateProfile({ name }, AdminArtistProfile), photo: newPhoto, createdBy })
const collective = (name: string, newPhoto: NewPhoto | null) =>
  collectivesStore(database.db).create({
    ...validateProfile({ name, members: [{ name: 'Une' }] }, AdminCollectiveProfile),
    photo: newPhoto,
    createdBy,
  })
const session = (flyer: NewPhoto | null) =>
  sessionsStore(database.db).create(
    {
      startAt: null,
      durationMinutes: 60,
      type: 'synth-meetup',
      takeoverId: null,
      applicationId: null,
      name: '',
      raEventId: null,
      description: '',
      flyer,
      createdBy,
    },
    [],
  )
const changes = (newPhoto: NewPhoto | null) => ({ photo: newPhoto, updatedBy: createdBy, updatedAt: new Date() })

// Whether a transaction waits for an advisory lock, i.e. for one that another transaction holds.
async function waitingForLock() {
  const { rows } = await database.db.execute<{ waiting: boolean }>(
    sql`select exists (select from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())) as waiting`,
  )
  return rows[0].waiting
}

// A promise, `opened`, that `open` resolves.
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { open, opened }
}

async function until(condition: () => Promise<boolean>) {
  for (let tries = 0; !(await condition()); tries++) {
    if (tries > 500) throw new Error('Waited too long')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

it("shares a session's flyer with the other sessions that have the same, and deletes it once none has it", async () => {
  const sessions = sessionsStore(database.db)
  const first = await session(await photos().store(photo, 'sessions'))
  const second = await session(await photos().store(photo, 'sessions'))
  expect(first.flyerKey).toBe(second.flyerKey)
  const key = first.flyerKey!
  expect(await kept()).toEqual(filesOf(key))

  // Removing it from one session keeps it for the other.
  await sessions.update(first.id, { flyer: null, updatedBy: createdBy, updatedAt: new Date() })
  await photos().deleteUnused(key)
  expect(await kept()).toEqual(filesOf(key))
  // Deleting the last one deletes it, with its sizes.
  await sessions.delete(second.id)
  await photos().deleteUnused(key)
  expect(await kept()).toEqual([])
})

it('keeps a photo that is replaced with the same one, and deletes the one that is replaced with another', async () => {
  const ana = await artist('Ana', await photos().store(photo, 'artists'))
  const store = artistsStore(database.db)
  const same = await store.update(ana.id, changes(await photos().store(photo, 'artists')))
  expect(same!.after.photoKey).toBe(same!.before.photoKey)
  await photos().deleteUnused(same!.before.photoKey!)
  expect(await kept()).toEqual(filesOf(ana.photoKey!))

  const replaced = await store.update(ana.id, changes(await photos().store(other, 'artists')))
  await photos().deleteUnused(replaced!.before.photoKey!)
  expect(await kept()).toEqual(filesOf(replaced!.after.photoKey!))
})

// For each folder, the table of its kind, and how a row of it is added with a photo.
const kinds: [PhotoFolder, typeof artists | typeof collectives | typeof sessions, (photo: NewPhoto) => Promise<{ id: string }>][] = [
  ['artists', artists, (newPhoto) => artist('Ana', newPhoto)],
  ['collectives', collectives, (newPhoto) => collective('Les Ondes', newPhoto)],
  ['sessions', sessions, (newPhoto) => session(newPhoto)],
]

it.each(kinds)('checks the rows of the kind of the folder, %s, before deleting a photo', async (folder, table, add) => {
  const first = await add(await photos().store(photo, folder))
  const stored = await photos().store(photo, folder)
  const second = await add(stored)
  await database.db.delete(table).where(eq(table.id, first.id))
  await photos().deleteUnused(stored.key)
  expect(await kept()).toEqual(filesOf(stored.key))
  await database.db.delete(table).where(eq(table.id, second.id))
  await photos().deleteUnused(stored.key)
  expect(await kept()).toEqual([])
})

it("doesn't delete a photo that a row starts using while it's deleted, once that row is saved", async () => {
  const stored = await photos().store(photo, 'artists')
  const [locked, released] = [gate(), gate()]
  // The artist's transaction holds the photos' lock once `keep` is done, until it's released.
  const adding = artist('Ana', {
    ...stored,
    keep: async (tx) => {
      await stored.keep(tx)
      locked.open()
      await released.opened
    },
  })
  try {
    await locked.opened
    const deleting = photos().deleteUnused(stored.key)
    await until(waitingForLock)
    released.open()
    expect((await adding).photoKey).toBe(stored.key)
    await deleting
  } finally {
    released.open()
  }
  expect(await kept()).toEqual(filesOf(stored.key))
})

it('stores again a photo that a row starts using while it is deleted, once it is', async () => {
  const stored = await photos().store(photo, 'artists')
  const [locked, released] = [gate(), gate()]
  // Deleting it holds the photos' lock, and waits to be released before it deletes anything.
  const pausing: PrivateFiles = {
    ...files,
    delete: async (key) => {
      locked.open()
      await released.opened
      return files.delete(key)
    },
  }
  const deleting = photos(pausing).deleteUnused(stored.key)
  try {
    await locked.opened
    const adding = artist('Ana', stored)
    await until(waitingForLock)
    released.open()
    await deleting
    expect((await adding).photoKey).toBe(stored.key)
  } finally {
    released.open()
  }
  expect(await kept()).toEqual(filesOf(stored.key))
})

it('stores again what was deleted between storing a photo and saving the row that uses it', async () => {
  const stored = await photos().store(photo, 'artists')
  // As a request that stopped using it would, in the meantime.
  await photos().deleteUnused(stored.key)
  expect(await kept()).toEqual([])
  expect((await artist('Ana', stored)).photoKey).toBe(stored.key)
  expect(await kept()).toEqual(filesOf(stored.key))
})

it('deletes a photo that it failed to store, unless something uses it', async () => {
  let puts = 0
  const failingOnce = photos({ ...files, put: async (...put) => (++puts === 2 ? Promise.reject(new Error('S3 is down')) : files.put(...put)) })
  await expect(failingOnce.store(photo, 'artists')).rejects.toThrow('S3 is down')
  expect(await kept()).toEqual([])

  const ana = await artist('Ana', await photos().store(photo, 'artists'))
  await files.delete(sizeKey(ana.photoKey!, 320))
  await expect(photos({ ...files, put: async () => Promise.reject(new Error('S3 is down')) }).store(photo, 'artists')).rejects.toThrow('S3 is down')
  expect(await kept()).toEqual([ana.photoKey!, sizeKey(ana.photoKey!, 1280)].sort())
  expect(log.error).not.toHaveBeenCalled()
})

it('rolls back a row whose photo it fails to keep, which can then be deleted, once the transaction is over', async () => {
  let down = false
  const switching: PrivateFiles = { ...files, put: async (...put) => (down ? Promise.reject(new Error('S3 is down')) : files.put(...put)) }
  const stored = await photos(switching).store(photo, 'artists')
  // Deleted meanwhile, and S3 fails to store it again.
  await files.delete(stored.key)
  down = true
  await expect(artist('Ana', stored)).rejects.toThrow('S3 is down')
  expect(await database.db.select().from(artists)).toEqual([])
  // As the routes do, once the transaction is over: it would wait for it otherwise.
  await forgetPhoto(photos(), logger, stored.key)
  expect(await kept()).toEqual([])
  expect(log.error).not.toHaveBeenCalled()
})

it('keeps the sizes it made of a photo that was deleted meanwhile, which a row still has', async () => {
  const stored = await photos().store(photo, 'artists')
  const ana = await artist('Ana', stored)
  await files.delete(sizeKey(stored.key, 320))
  // The photo is deleted as its size is made, which can't happen to a photo that's used, but as if it were stored again
  // right after.
  const deletingOnRead: PrivateFiles = {
    ...files,
    read: async (key) => {
      const read = await files.read(key)
      if (read) await files.delete(key)
      return read
    },
  }
  expect(await completeSizes(deletingOnRead, photos(), stored.key, logger)).toBe('missing')
  expect(await kept()).toEqual([sizeKey(stored.key, 1280), sizeKey(stored.key, 320)].sort())
  await artistsStore(database.db).delete(ana.id)
  await photos().deleteUnused(stored.key)
  expect(await kept()).toEqual([])
})

it("keeps the photos of a collective that applies, and its artists', which can be the same", async () => {
  const profile = { country: 'CA', city: 'Québec', genres: ['techno'], bio: 'Une bio.', links: { instagram: 'ondes' }, phone: '' }
  const member = (name: string, newPhoto: NewPhoto | null) => ({
    ...validateProfile({ ...profile, name }, AdminArtistProfile),
    photo: newPhoto,
  })
  const application = validateApplication({ dates: ['2027-01-15'], timeSlots: [], performanceTypes: ['dj'], otherPerformanceType: '', details: '' })
  const shared = await photos().store(photo, 'artists')
  const { collectiveId } = await applyStore(database.db as typeof Database).applyAsCollective(
    { ...validateProfile(
        { ...profile, name: 'Les Ondes', description: 'Une description.', email: 'ondes@example.com', phone: '418 555-0123' },
        ApplicantCollectiveProfile,
      ), photo: await photos().store(photo, 'collectives') },
    [member('Une', shared), member('Deux', shared), member('Trois', await photos().store(other, 'artists'))],
    application,
  )
  const [ondes] = await database.db.select().from(collectives).where(eq(collectives.id, collectiveId))
  const members = await database.db.select({ photoKey: artists.photoKey }).from(artists)
  expect(members.map(({ photoKey }) => photoKey).filter((key) => key === shared.key)).toHaveLength(2)
  expect(ondes.photoKey).toMatch(/^collectives\//)
  expect(await kept()).toHaveLength(9)
})
