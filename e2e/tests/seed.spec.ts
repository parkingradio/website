import { SEED_ARTISTS, SEED_COLLECTIVES } from '../seed-data.ts'
import { seed } from '../seed.ts'
import { test, expect, admin } from './fixtures.ts'

// The seed that global-setup.ts ran, which every test relies on.

test('the server is seeded, and seeding it again changes nothing', async ({ baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'seeding is the same whatever the screen')
  expect(await seed({ url: baseURL!, credentials: admin })).toEqual({
    seeded: [],
    skipped: [...SEED_ARTISTS, ...SEED_COLLECTIVES].map((seeded) => seeded.profile.name),
    sessions: 0,
  })
})
