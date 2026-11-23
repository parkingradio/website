import type { Page } from '@playwright/test'
import { addDays, quebecDayAndTime, quebecInstant } from '../../client/src/quebec-time.ts'
import { test, expect, adminMenu, logIn, longDay, own, withCalendar } from './fixtures.ts'
import type { CalendarExtra } from './fixtures.ts'

// The studio's calendar: a session of the test's own, in the month and on its day, and occupations, quiet time and
// conflicts, which the tests fake, since the server under test has no feeds (see `withCalendar`). The browser is in
// another time zone than Québec's, whose days and times the page shows all the same.

test.use({ timezoneId: 'Asia/Tokyo' })

// A day of the month, and the day under it.
const dayCell = (page: Page, day: string) => page.locator('.calendar-month td').filter({ has: page.getByRole('button', { name: longDay(day), exact: true }) })
const chosenDay = (page: Page, day: string) => page.getByRole('region', { name: longDay(day) })

test("a session is in its month, and on its day, which leads to a new session's form on that day", async ({ page }, testInfo) => {
  const { unique, day } = own(testInfo)
  await logIn(page)
  await expect(adminMenu(page)).toBeVisible()
  // From 21 h to 1 h the next day.
  const fields = { start: `${day}T21:00-04:00`, durationMinutes: 240, type: 'other', takeover: null, application: null, name: `E2E ${unique}`, raEvent: null, description: '' }
  const created = await page.request.post('/api/admin/sessions', { multipart: { session: JSON.stringify(fields) } })
  expect(created.ok()).toBe(true)
  const id: string = (await created.json()).session.id

  const month = day.slice(0, 7)
  await page.goto(`/admin/calendrier?month=${month}`)
  await expect(page.getByRole('heading', { name: `juillet ${day.slice(0, 4)}` })).toBeVisible()
  const cell = dayCell(page, day)
  await expect(cell).toContainText('21 h – 1 h')
  await expect(cell.getByRole('link', { name: `E2E ${unique}` })).toHaveAttribute('href', `/admin/sessions/${id}`)
  await expect(dayCell(page, addDays(day, 1))).toContainText("jusqu'à 1 h")

  // Chosen with the keyboard, from the month's first day, which has the grid's stop, today not being in it.
  const first = page.getByRole('button', { name: longDay(`${month}-01`), exact: true })
  await expect(first).toHaveAttribute('tabindex', '0')
  await first.focus()
  const days = Number(day.slice(8)) - 1
  for (let i = 0; i < Math.floor(days / 7); i++) await page.keyboard.press('ArrowDown')
  for (let i = 0; i < days % 7; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/admin/calendrier?month=${month}&day=${day}`)
  const chosen = chosenDay(page, day)
  await expect(chosen.getByRole('listitem')).toHaveText([`session21 h – 1 hE2E ${unique}`])

  await chosen.getByRole('link', { name: 'nouvelle session ce jour →' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Nouvelle session' })).toBeVisible()
  for (const when of ['Début', 'Fin']) await expect(page.getByRole('group', { name: when, exact: true }).getByLabel('date', { exact: true })).toHaveValue(day)
  // Back to the month, with its day chosen.
  await page.goBack()
  await expect(chosenDay(page, day)).toBeVisible()
  await expect(page.getByRole('button', { name: longDay(day), exact: true })).toHaveAttribute('aria-pressed', 'true')

  // The seeded session without a date needs settling, and the sessions come from the site, the rest from Configuration.
  await page.getByRole('region', { name: 'À régler' }).getByRole('button', { name: /sans date/ }).click()
  await expect(page.getByRole('region', { name: 'À régler' }).getByRole('link', { name: 'LES SŒURS ONDES TAKEOVER' })).toBeVisible()
  const sources = page.getByRole('region', { name: 'Sources' })
  await expect(sources.getByRole('link', { name: 'Sessions' })).toHaveAttribute('href', '/admin/sessions')
  await expect(sources.getByRole('link', { name: 'Configuration' }).first()).toHaveAttribute('href', '/admin/configuration')

  expect((await page.request.delete(`/api/admin/sessions/${id}`)).ok()).toBe(true)
})

test('occupations, quiet time and their conflicts are shown in the month, on their day, in "À régler" and in the menu', async ({ page }, testInfo) => {
  const { unique } = own(testInfo)
  // Three days from today in Québec, in the 365 days that conflicts are found in, or four, so that the next day is in
  // its month too.
  const third = addDays(quebecDayAndTime(new Date()).day, 3)
  const day = addDays(third, 1).slice(0, 7) === third.slice(0, 7) ? third : addDays(third, 1)
  const at = (on: string, time: string) => quebecInstant(on, time)!.toISOString()
  const feed = (id: string, name: string, kind: 'occupation' | 'quiet-time', error: string | null) => ({
    id,
    name,
    kind,
    createdBy: 'admin@example.com',
    createdAt: at(day, '00:00'),
    readAt: at(addDays(day, -3), '00:00'),
    error,
  })
  const occupation = { feed: `team-${unique}`, start: at(day, '10:00'), end: at(day, '16:00'), wholeDay: false, title: `RÉPARATION ${unique}` }
  const stay = { feed: `stays-${unique}`, start: at(day, '12:00'), end: at(addDays(day, 1), '11:00'), wholeDay: false }
  const extra: CalendarExtra = {
    feeds: [feed(`team-${unique}`, 'Équipe e2e', 'occupation', null), feed(`stays-${unique}`, 'Séjours e2e', 'quiet-time', "The link's server answered with 503")],
    occupations: [occupation],
    quietTimes: [stay],
    // The occupation and the stay, in the order of things: by start.
    conflicts: [{ start: stay.start, end: occupation.end, things: [{ kind: 'occupation', ...occupation }, { kind: 'quiet-time', ...stay }] }],
  }
  await withCalendar(page, extra)
  await logIn(page, { at: `/admin/calendrier?day=${day}` })

  // In the month, each "conflit" on the day they overlap, and the stay's end the next day, without it.
  const cell = dayCell(page, day)
  await expect(cell).toContainText(`10 h – 16 hoccupation : RÉPARATION ${unique}conflit`)
  await expect(cell).toContainText('12 h – 11 hsilenceconflit')
  await expect(dayCell(page, addDays(day, 1)).locator('.calendar-quiet-time')).toHaveText("jusqu'à 11 hsilence")

  const chosen = chosenDay(page, day)
  // Quiet time first.
  await expect(chosen.getByRole('listitem')).toHaveText([
    `silence12 h – 11 hcalendrier « Séjours e2e »conflit avec l'occupation RÉPARATION ${unique}`,
    `occupation10 h – 16 hRÉPARATION ${unique} (calendrier « Équipe e2e »)conflit avec le silence du calendrier « Séjours e2e »`,
  ])

  const issues = page.getByRole('region', { name: 'À régler' })
  await expect(issues).toContainText("⚠ La dernière lecture du calendrier « Séjours e2e » a échoué : The link's server answered with 503.")
  await issues.getByRole('button', { name: /1 conflit/ }).click()
  await expect(page).toHaveURL(/[?&]issues=open/)
  await expect(issues.getByRole('listitem').first()).toContainText(`occupation : RÉPARATION ${unique}, à changer dans le calendrier « Équipe e2e »`)
  await expect(issues.getByRole('listitem').first()).toContainText('silence, à changer dans le calendrier « Séjours e2e »')

  const sources = page.getByRole('region', { name: 'Sources' })
  await expect(sources).toContainText('Équipe e2e Lu le')
  await expect(sources).toContainText("La dernière lecture a échoué : The link's server answered with 503")

  // The menu's badge, on another page, which leads back to the conflicts.
  await adminMenu(page).getByRole('link', { name: 'sessions' }).click()
  const calendar = adminMenu(page).getByRole('link', { name: 'calendrier, 1 conflit' })
  await expect(calendar).toHaveAttribute('href', '/admin/calendrier?issues=open')
  await calendar.click()
  await expect(issues.getByRole('button', { name: /1 conflit/ })).toHaveAttribute('aria-expanded', 'true')
})
