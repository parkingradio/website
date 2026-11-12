import { SEED_ARTISTS, SEED_COLLECTIVES, SEED_SESSIONS } from '../seed-data.ts'
import { day, seed } from '../seed.ts'
import { test, expect, admin, adminMenu, logIn } from './fixtures.ts'

// The seed that global-setup.ts ran, which every test relies on.

test('the server is seeded, and seeding it again changes nothing', async ({ baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'seeding is the same whatever the screen')
  expect(await seed({ url: baseURL!, credentials: admin })).toEqual({
    seeded: [],
    skipped: [...SEED_ARTISTS, ...SEED_COLLECTIVES].map((seeded) => seeded.profile.name),
    sessions: 0,
  })
})

// What a set or a session that comes from an application is, with that application: its takeover's collective, or its
// performers, by their names, and the application's days.
type Link = { collectiveId?: string; artistIds?: string[]; names: string; days: number[] | string[] }

test('the seeded sets and sessions come from the seeded applications that seed-data.ts says, which list them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'seeding is the same whatever the screen')
  // Artists and collectives are named by their email in seed-data.ts, or by their name for those without one.
  const profiles = [...SEED_ARTISTS, ...SEED_COLLECTIVES].map(({ profile }) => profile)
  const nameOf = (key: string) => (key.includes('@') ? profiles.find(({ email }) => email?.toLowerCase() === key.toLowerCase())!.name : key)
  const describe = ({ names, days }: Link) => `${names}: ${days.join(' ')}`
  const expected = [
    ...SEED_SESSIONS.filter((session) => session.application).map((session) => ({ names: nameOf(session.takeover!), days: session.application! })),
    ...SEED_SESSIONS.flatMap((session) => session.sets)
      .filter((set) => set.application)
      .map((set) => ({ names: set.performers.map(nameOf).join(', '), days: set.application! })),
  ].map(({ names, days }) => describe({ names, days: days.map(day) }))

  await logIn(page)
  await expect(adminMenu(page)).toBeVisible()
  const { sessions } = await (await page.request.get('/api/admin/sessions')).json()
  type Item = { application: { id: string } | null }
  type Found = Item & { id: string; takeover: { id: string; name: string } | null; sets: (Item & { id: string; performers: { id: string; name: string }[] })[] }
  // With the application's id, and the set's or the session's.
  const found: (Link & { id: string; of: string })[] = []
  for (const session of sessions as Found[]) {
    if (session.application) found.push({ id: session.application.id, of: session.id, collectiveId: session.takeover!.id, names: session.takeover!.name, days: [] })
    for (const { id, application, performers } of session.sets) {
      if (application) found.push({ id: application.id, of: id, artistIds: performers.map(({ id }) => id), names: performers.map(({ name }) => name).join(', '), days: [] })
    }
  }
  // Each one is its collective's, or one of its performers', application, with the days seed-data.ts says.
  for (const link of found) {
    const { application } = await (await page.request.get(`/api/admin/applications/${link.id}`)).json()
    if (link.collectiveId) expect(application.collectiveId).toBe(link.collectiveId)
    else expect(link.artistIds).toContain(application.artistId)
    link.days = application.dates
    // Which lists it.
    const listed: { id: string }[] = link.collectiveId ? application.sessions : application.sets
    expect(listed.map(({ id }) => id)).toContain(link.of)
  }
  expect(found.map(describe).sort()).toEqual(expected.sort())
})
