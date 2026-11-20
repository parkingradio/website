import { afterAll, beforeAll, expect, it } from 'vitest'
import { collectivesStore } from '../collectives/store.js'
import { AdminCollectiveProfile } from '../collectives/profile.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsStore } from '../sessions/store.js'
import { storedImages } from './backfill.js'
import { photoKey } from './keys.js'
import type { PhotoFolder } from './keys.js'
import { AdminArtistProfile } from './profile.js'
import { artistsStore, validateProfile } from './store.js'

// The photos and flyers whose missing sizes are made when the server starts (see artists/backfill.ts).

let database: TestDatabase

beforeAll(async () => {
  database = await testDatabase()
})

afterAll(async () => {
  await database?.drop()
})

it("lists every photo and flyer the server keeps, sessions' flyers first, the latest first", async () => {
  const artists = artistsStore(database.db)
  const createdBy = 'admin@example.com'
  // Photos that aren't stored, under the keys of made-up content: only their keys are listed.
  const photo = (folder: PhotoFolder, content: string) => ({
    key: photoKey({ body: Buffer.from(content), type: 'image/jpeg' }, folder),
    type: 'image/jpeg',
    keep: async () => {},
  })
  const ana = await artists.create({ ...validateProfile({ name: 'Ana' }, AdminArtistProfile), photo: photo('artists', 'ana'), createdBy })
  await artists.create({ ...validateProfile({ name: 'Brume' }, AdminArtistProfile), photo: null, createdBy })
  const ondes = await collectivesStore(database.db).create({
    ...validateProfile({ name: 'Les Ondes', members: [{ id: ana.id }] }, AdminCollectiveProfile),
    photo: photo('collectives', 'ondes'),
    createdBy,
  })
  const sessions = sessionsStore(database.db)
  const session = (start: string, flyer: string | null) =>
    sessions.create(
      {
        startAt: new Date(start),
        durationMinutes: 60,
        type: 'synth-meetup',
        takeoverId: null,
        applicationId: null,
        name: '',
        raEventId: null,
        description: '',
        flyer: flyer ? photo('sessions', flyer) : null,
        createdBy,
      },
      [],
    )
  const earlier = await session('2026-01-10T21:00-05:00', 'earlier')
  await session('2026-01-11T21:00-05:00', null)
  const later = await session('2026-01-12T21:00-05:00', 'later')

  expect(await storedImages(database.db)).toEqual([
    { of: 'session', id: later.id, key: photo('sessions', 'later').key },
    { of: 'session', id: earlier.id, key: photo('sessions', 'earlier').key },
    { of: 'artist', id: ana.id, key: photo('artists', 'ana').key },
    { of: 'collective', id: ondes.id, key: photo('collectives', 'ondes').key },
  ])
})
