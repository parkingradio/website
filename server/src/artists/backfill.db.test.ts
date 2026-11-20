import { afterAll, beforeAll, expect, it } from 'vitest'
import { collectivesStore } from '../collectives/store.js'
import { AdminCollectiveProfile } from '../collectives/profile.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsStore } from '../sessions/store.js'
import { storedImages } from './backfill.js'
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
  const photo = (photoKey: string) => ({ photoKey, photoType: 'image/jpeg' })
  const ana = await artists.create({ ...validateProfile({ name: 'Ana' }, AdminArtistProfile), ...photo('artists/ana.jpg'), createdBy })
  await artists.create({ ...validateProfile({ name: 'Brume' }, AdminArtistProfile), photoKey: null, photoType: null, createdBy })
  const ondes = await collectivesStore(database.db).create({
    ...validateProfile({ name: 'Les Ondes', members: [{ id: ana.id }] }, AdminCollectiveProfile),
    ...photo('collectives/ondes.png'),
    createdBy,
  })
  const sessions = sessionsStore(database.db)
  const session = (start: string, flyerKey: string | null) =>
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
        ...(flyerKey ? { flyerKey, flyerType: 'image/png' } : { flyerKey: null, flyerType: null }),
        createdBy,
      },
      [],
    )
  const earlier = await session('2026-01-10T21:00-05:00', 'sessions/earlier.png')
  await session('2026-01-11T21:00-05:00', null)
  const later = await session('2026-01-12T21:00-05:00', 'sessions/later.png')

  expect(await storedImages(database.db)).toEqual([
    { of: 'session', id: later.id, key: 'sessions/later.png' },
    { of: 'session', id: earlier.id, key: 'sessions/earlier.png' },
    { of: 'artist', id: ana.id, key: 'artists/ana.jpg' },
    { of: 'collective', id: ondes.id, key: 'collectives/ondes.png' },
  ])
})
