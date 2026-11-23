import type { Page } from '@playwright/test'
import { addDays, quebecDayAndTime, quebecInstant } from '../../client/src/quebec-time.ts'
import { test, expect, adminMenu, logIn, longDay, own, withCalendar } from './fixtures.ts'
import type { CalendarExtra } from './fixtures.ts'

// The studio's calendar: a session of the test's own, in the month and on its day, and occupations and conflicts,
// which the tests fake, since the server under test has no feeds (see `withCalendar`). The browser is in
// another time zone than Québec's, whose days and times the page shows all the same.

test.use({ timezoneId: 'Asia/Tokyo' })

// A day of the month, its button, and the day under it.
const dayButton = (page: Page, day: string) => page.getByRole('button', { name: longDay(day), exact: true })
const dayCell = (page: Page, day: string) => page.locator('.calendar-month td').filter({ has: dayButton(page, day) })
const chosenDay = (page: Page, day: string) => page.getByRole('region', { name: longDay(day) })

test('a session is in its month, and on its day, where a new session is added', async ({ page }, testInfo) => {
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
  const first = dayButton(page, `${month}-01`)
  await expect(first).toHaveAttribute('tabindex', '0')
  await first.focus()
  const days = Number(day.slice(8)) - 1
  for (let i = 0; i < Math.floor(days / 7); i++) await page.keyboard.press('ArrowDown')
  for (let i = 0; i < days % 7; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/admin/calendrier?month=${month}&day=${day}`)
  const chosen = chosenDay(page, day)
  await expect(chosen.getByRole('listitem')).toHaveText([`session21 h – 1 hE2E ${unique}`])

  // Its "+", after it, opens the form for a new session on it, with the focus on its heading, then its start.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: `nouvelle session le ${longDay(day)}` })).toBeFocused()
  await page.keyboard.press('Enter')
  const form = chosen.getByRole('form', { name: 'Nouvelle session' })
  await expect(form.getByRole('heading', { name: 'Nouvelle session' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(form.getByLabel('Début')).toBeFocused()
  await form.getByLabel('Début').fill('18:00')
  await form.getByLabel('Fin').fill('22:00')
  await form.getByRole('radio', { name: 'Autre' }).check()
  await form.getByLabel('Nom').fill(`E2E NEW ${unique}`)
  // The server refuses it while it overlaps the other session, which it names.
  await form.getByRole('button', { name: 'créer' }).click()
  const alert = form.getByRole('alert')
  await expect(alert).toContainText("La session n'a pas pu être ajoutée")
  await expect(alert.getByRole('link', { name: new RegExp(`^E2E ${unique}, `) })).toHaveAttribute('href', `/admin/sessions/${id}`)
  // Up to when the other starts.
  await form.getByLabel('Fin').fill('21:00')
  await form.getByRole('button', { name: 'créer' }).click()
  // The page stays, with the form closed, the day chosen and the focus on it, and shows the new session there.
  await expect(chosen.getByRole('status')).toHaveText(`La session E2E NEW ${unique} a été ajoutée.`)
  await expect(page).toHaveURL(`/admin/calendrier?month=${month}&day=${day}`)
  await expect(chosen.getByRole('form')).toHaveCount(0)
  await expect(dayButton(page, day)).toBeFocused()
  await expect(chosen.getByRole('listitem')).toHaveText([`session18 h – 21 hE2E NEW ${unique}`, `session21 h – 1 hE2E ${unique}`])
  await expect(dayCell(page, day)).toContainText('18 h – 21 h')
  // Its link leads to its page.
  const link = chosen.getByRole('link', { name: `E2E NEW ${unique}` })
  const newId = (await link.getAttribute('href'))!.split('/').at(-1)!
  await link.click()
  await expect(page.getByLabel('Session', { exact: true })).toContainText(`${longDay(day)}, de 18 h à 21 h`)
  await page.goBack()

  // The seeded session without a date needs settling, and leads to its page.
  const issues = page.getByRole('region', { name: 'À régler' })
  await issues.getByRole('button', { name: /sans date/ }).click()
  await expect(issues.getByRole('link', { name: /^lui donner une date\s?, LES SŒURS ONDES TAKEOVER$/ })).toHaveAttribute('href', /^\/admin\/sessions\//)

  for (const added of [id, newId]) expect((await page.request.delete(`/api/admin/sessions/${added}`)).ok()).toBe(true)
})

test('occupations and their conflicts are shown in the month, on their day, in "À régler" and in the menu', async ({ page }, testInfo) => {
  const { unique } = own(testInfo)
  // Three days from today in Québec, in the 365 days that conflicts are found in, or four, so that the next day is in
  // its month too.
  const third = addDays(quebecDayAndTime(new Date()).day, 3)
  const day = addDays(third, 1).slice(0, 7) === third.slice(0, 7) ? third : addDays(third, 1)
  const at = (on: string, time: string) => quebecInstant(on, time)!.toISOString()
  const readAt = at(addDays(day, -3), '00:00')
  const feed = (id: string, name: string, privateTitles: boolean, error: string | null) => ({
    id,
    name,
    link: `https://example.com/${id}.ics`,
    privateTitles,
    createdBy: 'admin@example.com',
    createdAt: readAt,
    updatedBy: null,
    updatedAt: null,
    readAt,
    error,
  })
  const team = `Équipe ${unique}`
  const stays = `Séjours ${unique}`
  const repair = { feedId: `team-${unique}`, start: at(day, '10:00'), end: at(day, '16:00'), wholeDay: false, title: `RÉPARATION ${unique}` }
  // A stay, from a feed whose titles are private.
  const stay = { feedId: `stays-${unique}`, start: at(day, '12:00'), end: at(addDays(day, 1), '11:00'), wholeDay: false, title: null }
  const extra: CalendarExtra = {
    feeds: [feed(`team-${unique}`, team, false, null), feed(`stays-${unique}`, stays, true, "The link can't be read: its server fails (503)")],
    occupations: [repair, stay],
    // The repair and the stay, in the order of things: by start.
    conflicts: [{ start: stay.start, end: repair.end, things: [{ kind: 'occupation', ...repair }, { kind: 'occupation', ...stay }] }],
  }
  await withCalendar(page, extra)
  await logIn(page, { at: `/admin/calendrier?day=${day}` })

  // In the month, each "conflit" on the day they overlap, and the stay's end the next day, without it, then free time.
  const cell = dayCell(page, day)
  await expect(cell).toContainText(`10 h – 16 hoccupation : RÉPARATION ${unique}, calendrier ${team}conflit`)
  await expect(cell).toContainText(`12 h – 11 hoccupation : ${stays}conflit`)
  const next = dayCell(page, addDays(day, 1))
  await expect(next.locator('.calendar-occupation')).toHaveText(`jusqu'à 11 hoccupation : ${stays}`)
  await expect(next.locator('.calendar-free')).toHaveText('dispo dès 11 h')
  // Which the day's button reads, as its description, whose spaces can be non-breaking ones, and where the browser can
  // put one before the separator's comma.
  const description = new RegExp(`10 h – 16 h occupation : RÉPARATION ${unique}, calendrier ${team} conflit`.replaceAll(' ', '\\s').replace(',', '\\s?,'), 'i')
  await expect(dayButton(page, day)).toHaveAccessibleDescription(description)

  const chosen = chosenDay(page, day)
  // By start, among the test's own things, whatever else takes the day.
  await expect(chosen.getByRole('listitem').filter({ hasText: unique })).toHaveText([
    `occupation10 h – 16 hRÉPARATION ${unique}, calendrier ${team}conflit avec l'occupation ${stays}`,
    `occupation12 h – 11 h${stays}conflit avec l'occupation RÉPARATION ${unique} (${team})`,
  ])

  const issues = page.getByRole('region', { name: 'À régler' })
  await expect(issues).toContainText(`⚠ Des conflits peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier « ${stays} » a échoué : The link can't be read: its server fails (503). Voir Configuration.`)
  await expect(issues.getByRole('link', { name: 'Configuration' })).toHaveAttribute('href', '/admin/configuration')
  await issues.getByRole('button', { name: /1 conflit/ }).click()
  await expect(page).toHaveURL(/[?&]issues=open/)
  await expect(issues.getByRole('listitem').first()).toContainText(`occupation : RÉPARATION ${unique}, calendrier ${team}occupation : ${stays}`)
  // Which shows its day, chosen.
  await issues.getByRole('button', { name: /^voir le jour\s?, / }).click()
  await expect(dayButton(page, day)).toBeFocused()

  // The menu's badge, on another page, which leads back to the conflicts.
  await adminMenu(page).getByRole('link', { name: 'sessions' }).click()
  const calendar = adminMenu(page).getByRole('link', { name: 'calendrier, 1 conflit' })
  await expect(calendar).toHaveAttribute('href', '/admin/calendrier?issues=open')
  await calendar.click()
  await expect(issues.getByRole('button', { name: /1 conflit/ })).toHaveAttribute('aria-expanded', 'true')
})
