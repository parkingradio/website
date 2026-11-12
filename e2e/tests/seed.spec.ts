import { SEED_ARTISTS, SEED_COLLECTIVES, SEED_SESSIONS } from '../seed-data.ts'
import { seed } from '../seed.ts'
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

test('the seeded sets and sessions come from the seeded applications that seed-data.ts says, which list them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'seeding is the same whatever the screen')
  await logIn(page)
  await expect(adminMenu(page)).toBeVisible()
  const { sessions } = await (await page.request.get('/api/admin/sessions')).json()
  const linked = (items: { application: { id: string } | null }[]) => items.filter((item) => item.application !== null).map((item) => item.application!.id)
  const sessionsLinks = linked(sessions)
  const setsLinks = linked(sessions.flatMap((session: { sets: [] }) => session.sets))
  expect(sessionsLinks).toHaveLength(SEED_SESSIONS.filter((session) => session.application).length)
  expect(setsLinks).toHaveLength(SEED_SESSIONS.flatMap((session) => session.sets).filter((set) => set.application).length)
  for (const id of new Set([...sessionsLinks, ...setsLinks])) {
    const { application } = await (await page.request.get(`/api/admin/applications/${id}`)).json()
    const count = (links: string[]) => links.filter((linkedId) => linkedId === id).length
    expect(application.sessions).toHaveLength(count(sessionsLinks))
    expect(application.sets).toHaveLength(count(setsLinks))
  }
})
