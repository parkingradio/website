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

// An instant, at a time of a day in Québec.
const at = (day: string, time: string) => quebecInstant(day, time)!.toISOString()

// Three days from today in Québec, in the 365 days that conflicts are found in, or four, so that the next day is in its
// month too.
function soon(): string {
  const third = addDays(quebecDayAndTime(new Date()).day, 3)
  return addDays(third, 1).slice(0, 7) === third.slice(0, 7) ? third : addDays(third, 1)
}

// A test's own feeds, read three days before `day`, the second one having failed its last read, and a repair and a stay
// on `day` that overlap, with their conflict, the stay without a title.
function ownCalendar(unique: string, day: string) {
  const readAt = at(addDays(day, -3), '00:00')
  const feed = (id: string, name: string, error: string | null) => ({
    id,
    name,
    link: `https://example.com/${id}.ics`,
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
  const stay = { feedId: `stays-${unique}`, start: at(day, '12:00'), end: at(addDays(day, 1), '11:00'), wholeDay: false, title: '' }
  const extra: CalendarExtra = {
    feeds: [feed(`team-${unique}`, team, null), feed(`stays-${unique}`, stays, "The link can't be read: its server fails (503)")],
    occupations: [repair, stay],
    // The repair and the stay, in the order of things: by start.
    conflicts: [{ start: stay.start, end: repair.end, things: [{ kind: 'occupation', ...repair }, { kind: 'occupation', ...stay }] }],
  }
  return { extra, team, stays }
}

// Eight occupations of an hour each on `day`, of `unique`'s first feed, from 12 h, so that its chosen day is longer than
// a phone's screen, and its week, in the month, too long on wider screens to leave room for the chosen day's heading.
const busy = (unique: string, day: string) =>
  Array.from({ length: 8 }, (_, i) => ({ feedId: `team-${unique}`, start: at(day, `${12 + i}:00`), end: at(day, `${13 + i}:00`), wholeDay: false, title: `OCCUPÉ ${i + 1}` }))

// E.g. "ven. 13 nov.", as the page writes a day in a list's row, and "ven. 13", in a thing's times in brief.
const dayInYear = (day: string) => new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day))
const weekdayAndNumber = (day: string) => new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day))

// Whether the page scrolls sideways, which it shouldn't, on phones too.
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

// The narrowest phones the admin pages are made for, which the mobile project's is wider than.
const NARROW = { width: 360, height: 800 }

// Where the navigation bar, which stays at the top of the screen, ends.
async function underTheBar(page: Page): Promise<number> {
  const bar = (await page.locator('.navbar').boundingBox())!
  return bar.y + bar.height
}

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
  const undated = issues.getByRole('link', { name: /^à déterminer\s?LES SŒURS ONDES TAKEOVER · / })
  await expect(undated).toHaveAttribute('href', /^\/admin\/sessions\//)
  await undated.click()
  await expect(page.getByRole('heading', { level: 1, name: 'LES SŒURS ONDES TAKEOVER' })).toBeVisible()

  for (const added of [id, newId]) expect((await page.request.delete(`/api/admin/sessions/${added}`)).ok()).toBe(true)
})

test('occupations and their conflicts are shown in the month, on their day, in "À régler" and in the menu', async ({ page }, testInfo) => {
  const { unique } = own(testInfo)
  const day = soon()
  const { extra, team, stays } = ownCalendar(unique, day)
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
  // A row of its own, by the things' names alone, which shows its day, chosen.
  const row = issues.getByRole('listitem').first().getByRole('button')
  await expect(row).toContainText(`RÉPARATION ${unique} et ${stays}`)
  await expect(row).not.toContainText(team)
  await row.click()
  await expect(dayButton(page, day)).toBeFocused()

  // The menu's badge, on another page, which leads back to the conflicts.
  await adminMenu(page).getByRole('link', { name: 'sessions' }).click()
  const calendar = adminMenu(page).getByRole('link', { name: 'calendrier, 1 conflit' })
  await expect(calendar).toHaveAttribute('href', '/admin/calendrier?issues=open')
  await calendar.click()
  await expect(issues.getByRole('button', { name: /1 conflit/ })).toHaveAttribute('aria-expanded', 'true')
})

test('the list has each thing once, from today, in columns, which shows its day in the month', async ({ page, isMobile }, testInfo) => {
  const { unique } = own(testInfo)
  if (isMobile) await page.setViewportSize(NARROW)
  const today = quebecDayAndTime(new Date()).day
  const day = soon()
  const { extra, team, stays } = ownCalendar(unique, day)
  // Closed for three whole days, ten days from today, and an occupation near the list's end, whose title, a link, has
  // no spaces.
  const closed = addDays(today, 10)
  const far = addDays(today, 350)
  const link = `https://example.com/${'tres-long-'.repeat(12)}${unique}`
  extra.occupations.push(
    { feedId: `team-${unique}`, start: at(closed, '00:00'), end: at(addDays(closed, 3), '00:00'), wholeDay: true, title: `FERMÉ ${unique}` },
    { feedId: `team-${unique}`, start: at(far, '10:00'), end: at(far, '12:00'), wholeDay: false, title: link },
    ...busy(unique, far),
  )
  await withCalendar(page, extra)
  await logIn(page, { at: '/admin/calendrier?view=list' })

  const list = page.getByRole('region', { name: 'À venir' })
  const rows = list.getByRole('button')
  await expect(rows.filter({ hasText: unique }).filter({ hasNotText: 'OCCUPÉ' })).toHaveText([
    `${dayInYear(day)} occupation 10 h – 16 h RÉPARATION ${unique}, calendrier ${team} · conflit avec ${stays}`,
    `${dayInYear(day)} occupation 12 h – 11 h ${stays} · conflit avec RÉPARATION ${unique}`,
    `${dayInYear(closed)} occupation → ${weekdayAndNumber(addDays(closed, 2))} FERMÉ ${unique}, calendrier ${team}`,
    `${dayInYear(far)} occupation 10 h – 12 h ${link}, calendrier ${team}`,
  ])
  // The seeded marathon, once, over three days, whose last day depends on the clocks changing in between, and the seeded
  // takeover that was cancelled.
  const marathon = rows.filter({ hasText: 'MARATHON MODULAIRE' })
  await expect(marathon).toHaveCount(1)
  await expect(marathon).toContainText(/\s18\sh\s→\s\S+\.\s\d+\s/)
  await expect(rows.filter({ hasText: 'LES NUITS BASSES TAKEOVER' })).toContainText('LES NUITS BASSES TAKEOVER annulée')
  await expect(list).toContainText(`La liste s'arrête au ${longDay(addDays(today, 364))}.`)
  expect(await scrollsSideways(page)).toBe(false)

  // The last row, far down the list, shows its day, chosen, in the month, with the focus on it, in view under the bar,
  // and on a phone, where there's room for both, the chosen day's heading in view too.
  const last = rows.filter({ hasText: link })
  await last.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await (isMobile ? last.tap() : last.click())
  await expect(page).toHaveURL(`/admin/calendrier?month=${far.slice(0, 7)}&day=${far}`)
  await expect(dayButton(page, far)).toBeFocused()
  if (isMobile) await expect(chosenDay(page, far).getByRole('heading', { name: longDay(far) })).toBeInViewport({ ratio: 1 })
  expect((await dayCell(page, far).boundingBox())!.y).toBeGreaterThanOrEqual(await underTheBar(page))
  await expect(chosenDay(page, far)).toContainText(link)
  // Back to the list, where it was, which the browser puts back once the page shows it at once, while it's read again,
  // which the test waits for, so that it doesn't end while its fake answers.
  const reread = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/admin/calendar')
  await page.goBack()
  await expect(page).toHaveURL('/admin/calendrier?view=list')
  await expect(last).toBeInViewport({ ratio: 0.9 })
  await reread
})

test('on phones, the month marks what takes each day, with a "+" as large as a finger, and choosing a day brings it into view', async ({ page, isMobile }, testInfo) => {
  const { unique } = own(testInfo)
  if (isMobile) await page.setViewportSize(NARROW)
  const day = soon()
  const month = day.slice(0, 7)
  // A day of the grid's first week other than the test's own, its Sunday or else the Monday after, which is busy.
  const sunday = addDays(`${month}-01`, -new Date(`${month}-01`).getUTCDay())
  const first = sunday !== day ? sunday : addDays(day, 1)
  const { extra } = ownCalendar(unique, day)
  extra.occupations.push(...busy(unique, first))
  await withCalendar(page, extra)
  await logIn(page, { at: `/admin/calendrier?month=${month}` })

  const marks = dayCell(page, day).locator('.calendar-marks')
  await expect(dayCell(page, day)).toContainText(`RÉPARATION ${unique}`)
  expect(await scrollsSideways(page)).toBe(false)
  if (isMobile) {
    // Its marks show, and its words are there for screen readers only.
    await expect(marks).toBeVisible()
    const words = (await dayCell(page, day).locator('.calendar-things').boundingBox())!
    expect(words.width * words.height).toBeLessThanOrEqual(1)
    // A "+" of at least 24 × 24 px, which overlaps neither its day's number nor the next day's, next to it, on a
    // two-digit day from today on that isn't a Saturday.
    const today = quebecDayAndTime(new Date()).day
    const twoDigits = Array.from({ length: 19 }, (_, i) => `${month}-${10 + i}`).find((each) => each >= today && new Date(each).getUTCDay() !== 6)!
    const plus = (await page.getByRole('button', { name: `nouvelle session le ${longDay(twoDigits)}` }).boundingBox())!
    expect(plus.width).toBeGreaterThanOrEqual(24)
    expect(plus.height).toBeGreaterThanOrEqual(24)
    for (const number of [twoDigits, addDays(twoDigits, 1)]) {
      const box = (await dayButton(page, number).boundingBox())!
      const overlaps = plus.x < box.x + box.width && box.x < plus.x + plus.width && plus.y < box.y + box.height && box.y < plus.y + plus.height
      expect(overlaps).toBe(false)
    }
  } else {
    await expect(marks).toBeHidden()
  }

  // The busy day, in the grid's first week, at the bottom of the screen, while the chosen day is under the month, out of
  // view, tapped or clicked where it is, so that only the page scrolls: toward the chosen day's heading, all of it on a
  // phone, where there's room, but keeping the day in view under the bar.
  await page.locator('.calendar-month tbody tr').first().evaluate((week) => week.scrollIntoView({ block: 'end' }))
  const scrolled = await page.evaluate(() => window.scrollY)
  const number = (await dayButton(page, first).boundingBox())!
  const [x, y] = [number.x + number.width / 2, number.y + number.height / 2]
  await (isMobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y))
  if (isMobile) await expect(chosenDay(page, first).getByRole('heading', { name: longDay(first) })).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled)
  expect((await dayCell(page, first).boundingBox())!.y).toBeGreaterThanOrEqual(await underTheBar(page))

  // The form for a new session fits too.
  const add = page.getByRole('button', { name: `nouvelle session le ${longDay(day)}` })
  await (isMobile ? add.tap() : add.click())
  await expect(page.getByRole('form', { name: 'Nouvelle session' })).toBeVisible()
  expect(await scrollsSideways(page)).toBe(false)
})
