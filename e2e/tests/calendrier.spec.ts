import type { Locator, Page } from '@playwright/test'
import { addDays, quebecDayAndTime, quebecInstant } from '../../client/src/quebec-time.ts'
import { test, expect, adminMenu, fillTime, logIn, longDay, NARROW, own, scrollsSideways, withCalendar } from './fixtures.ts'
import type { CalendarExtra } from './fixtures.ts'
import { centerOf } from './drag.ts'

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

// Why a test's feed's last read failed.
const FAILED = "The link can't be read: its server fails (503)"

// A test's own feed, of `kind`, read three days before `day`, or not yet, without `read`, its last read having failed
// when it has an `error`.
function ownFeed(id: string, name: string, day: string, { kind = 'occupations', error = null, read = true }: { kind?: 'occupations' | 'holds'; error?: string | null; read?: boolean } = {}) {
  const readAt = at(addDays(day, -3), '00:00')
  return { id, name, kind, link: `https://example.com/${id}.ics`, createdBy: 'admin@example.com', createdAt: readAt, updatedBy: null, updatedAt: null, readAt: read ? readAt : null, error }
}

// A test's own feeds, read three days before `day`, the second one having failed its last read, and a repair and a stay
// on `day` that overlap, with their conflict, the stay without a title.
function ownCalendar(unique: string, day: string) {
  const team = `Équipe ${unique}`
  const stays = `Séjours ${unique}`
  const repair = { feedId: `team-${unique}`, start: at(day, '10:00'), end: at(day, '16:00'), wholeDay: false, title: `RÉPARATION ${unique}` }
  const stay = { feedId: `stays-${unique}`, start: at(day, '12:00'), end: at(addDays(day, 1), '11:00'), wholeDay: false, title: '' }
  const extra: CalendarExtra = {
    feeds: [ownFeed(`team-${unique}`, team, day), ownFeed(`stays-${unique}`, stays, day, { error: FAILED })],
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

// Whether a target is as large as a finger needs, and whether two targets overlap, by their boxes.
type Box = { x: number; y: number; width: number; height: number }
const fingerSized = (box: Box) => box.width >= 24 && box.height >= 24
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

// Whether an entry of the month ends at the bottom of its day's cell, within its padding and border.
const reachesCellBottom = (entry: Locator) =>
  entry.evaluate((li) => {
    const cell = li.closest('td')!
    const style = getComputedStyle(cell)
    const bottom = cell.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth)
    return Math.abs(bottom - li.getBoundingClientRect().bottom) <= 1
  })

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
  const start = form.getByRole('group', { name: 'Début', exact: true })
  const end = form.getByRole('group', { name: 'Fin', exact: true })
  const slots = form.getByRole('group', { name: 'Plages horaires' })
  await expect(start.getByRole('spinbutton').first()).toBeFocused()
  // A time slot, under its times, fills them in, even while an hour is typed in part, and takes the focus, so that what's
  // typed in the hour once it has it again isn't the end of the hour typed before, e.g. "1" then "8", for 18.
  await page.keyboard.type('1')
  await slots.getByRole('button', { name: '13 h – 17 h' }).click()
  await expect(slots.getByRole('button', { name: '13 h – 17 h' })).toBeFocused()
  await expect(slots.getByRole('button', { name: '13 h – 17 h' })).toHaveAttribute('aria-pressed', 'true')
  await expect(start).toHaveText('\u206613 h 00\u2069')
  await expect(end).toHaveText('\u206617 h 00\u2069')
  await start.getByRole('spinbutton').first().click()
  await page.keyboard.type('19')
  await expect(start).toHaveText('\u206619 h 00\u2069')
  // In the 24-hour format, whatever the browser's settings, between marks that keep it left to right.
  await fillTime(start, '18:00')
  await fillTime(end, '22:00')
  await expect(start).toHaveText('\u206618 h 00\u2069')
  await expect(end).toHaveText('\u206622 h 00\u2069')
  await expect(slots.getByRole('button', { name: '18 h – 22 h' })).toHaveAttribute('aria-pressed', 'true')
  await form.getByRole('radio', { name: 'Autre' }).check()
  await form.getByLabel('Nom').fill(`E2E NEW ${unique}`)
  // The server refuses it while it overlaps the other session, which it names.
  await form.getByRole('button', { name: 'créer' }).click()
  const alert = form.getByRole('alert')
  await expect(alert).toContainText("La session n'a pas pu être ajoutée")
  await expect(alert.getByRole('link', { name: new RegExp(`^E2E ${unique}, `) })).toHaveAttribute('href', `/admin/sessions/${id}`)
  // Up to when the other starts.
  await fillTime(end, '21:00')
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

test('occupations and their conflicts are shown in the month, on their day, in "À régler" and in the menu', async ({ page, isMobile }, testInfo) => {
  const { unique } = own(testInfo)
  const day = soon()
  const { extra, team, stays } = ownCalendar(unique, day)
  await withCalendar(page, extra)
  await logIn(page, { at: `/admin/calendrier?day=${day}` })

  // In the month, each "conflit" on the day they overlap, the stay from its start, as it lasts more than 12 hours, and its
  // end the next day, without it.
  const cell = dayCell(page, day)
  await expect(cell).toContainText(`10 h – 16 hoccupation : RÉPARATION ${unique}, calendrier ${team}conflit`)
  await expect(cell).toContainText(`dès 12 hoccupation : ${stays}conflit`)
  const next = dayCell(page, addDays(day, 1))
  await expect(next.locator('.calendar-occupation')).toHaveText(`jusqu'à 11 hoccupation : ${stays}`)
  // The stay stretches down to the bottom of its first day, which it lasts until the end of, and not of the next. Phones
  // show marks in place of the words.
  if (!isMobile) {
    await expect.poll(() => reachesCellBottom(cell.locator('.calendar-occupation').filter({ hasText: stays }))).toBe(true)
    await expect.poll(() => reachesCellBottom(next.locator('.calendar-occupation'))).toBe(false)
  }
  // Which the day's button reads, as its description, whose spaces can be non-breaking ones, and where the browser can
  // put one before the separator's comma.
  const description = new RegExp(`10 h – 16 h occupation : RÉPARATION ${unique}, calendrier ${team} conflit`.replaceAll(' ', '\\s').replace(',', '\\s?,'), 'i')
  await expect(dayButton(page, day)).toHaveAccessibleDescription(description)

  const chosen = chosenDay(page, day)
  // By start, among the test's own things, whatever else takes the day.
  await expect(chosen.getByRole('listitem').filter({ hasText: unique })).toHaveText([
    `occupation10 h – 16 hRÉPARATION ${unique}, calendrier ${team}conflit avec l'occupation ${stays}`,
    `occupation12 h – ${dayInYear(addDays(day, 1))}, 11 h${stays}conflit avec l'occupation RÉPARATION ${unique} (${team})`,
  ])

  const issues = page.getByRole('region', { name: 'À régler' })
  await expect(issues).toContainText(`⚠ Des conflits peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier « ${stays} » a échoué : ${FAILED}. Voir Configuration.`)
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

// A session of a test's own, planned, from `start` to `end`, which the tests fake, as the server would refuse one where
// another test, run alongside, has its own.
function ownSession(id: string, title: string, start: string, end: string): NonNullable<CalendarExtra['sessions']>[number] {
  const durationMinutes = (Date.parse(end) - Date.parse(start)) / 60000
  return {
    id,
    start,
    end,
    durationMinutes,
    type: 'other',
    takeover: null,
    application: null,
    name: title,
    title,
    raEvent: null,
    description: '',
    effectiveDescription: '',
    hasFlyer: false,
    sets: [],
    createdAt: start,
    createdBy: 'admin@example.com',
    updatedBy: null,
    updatedAt: null,
    status: 'planned',
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    announced: false,
    announcedUpdatedBy: null,
    announcedUpdatedAt: null,
  }
}

test('available time shows where nothing takes the protected time, and the sessions outside it need settling', async ({ page, isMobile }, testInfo) => {
  const { unique } = own(testInfo)
  if (isMobile) await page.setViewportSize(NARROW)
  // Two days in the same month, a week or more before the nearest seeded session (see seed-data.ts), so that only the
  // test's own things take them.
  const day = soon()
  const next = addDays(day, 1)
  const [loft, blocks, team] = [`Loft ${unique}`, `Blocages ${unique}`, `Équipe ${unique}`]
  // Protected from 11 h to 18 h on `day`, around a meeting and a session, and from 15 h on the next day, by two holds
  // feeds, one whose last read failed and one not read yet, where a session from 13 h to 17 h is outside protected time.
  const inside = ownSession(`inside-${unique}`, `E2E ${unique}`, at(day, '15:00'), at(day, '17:00'))
  const outside = ownSession(`outside-${unique}`, `E2E OUT ${unique}`, at(next, '13:00'), at(next, '17:00'))
  await withCalendar(page, {
    feeds: [ownFeed(`loft-${unique}`, loft, day, { kind: 'holds', error: FAILED }), ownFeed(`blocks-${unique}`, blocks, day, { kind: 'holds', read: false }), ownFeed(`team-${unique}`, team, day)],
    occupations: [{ feedId: `team-${unique}`, start: at(day, '12:00'), end: at(day, '13:00'), wholeDay: false, title: `RÉUNION ${unique}` }],
    sessions: [inside, outside],
    availability: [
      { start: at(day, '11:00'), end: at(day, '12:00') },
      { start: at(day, '13:00'), end: at(day, '15:00') },
      { start: at(day, '17:00'), end: at(day, '18:00') },
      { start: at(next, '17:00'), end: at(addDays(next, 1), '00:00') },
    ],
    conflicts: [],
    unprotectedSessions: [{ id: outside.id, title: outside.title, start: outside.start!, end: outside.end! }],
  })
  await logIn(page, { at: `/admin/calendrier?month=${day.slice(0, 7)}` })

  // The fixture's stretches, as the server would give them, cut to each day, on a day with a session too. The month says
  // nothing of the session outside protected time.
  const available = (day: string) => dayCell(page, day).locator('.calendar-available')
  await expect(available(day)).toHaveText(['dispo 11 h – 12 h', 'dispo 13 h – 15 h', 'dispo 17 h – 18 h'])
  await expect(available(next)).toHaveText(['dispo dès 17 h'])
  // Which stretches down to the bottom of its day, which it lasts until the end of. Phones show marks in place of the
  // words.
  if (!isMobile) await expect.poll(() => reachesCellBottom(available(next))).toBe(true)
  await expect(dayCell(page, next)).not.toContainText('protégée')
  if (isMobile) await expect(dayCell(page, day).locator('.calendar-mark-available')).toBeVisible()

  // The holds feeds' warnings, and the session outside protected time, the only one, since the server under test has no
  // holds feed, whose row shows its day.
  const issues = page.getByRole('region', { name: 'À régler' })
  await expect(issues).toContainText(
    `⚠ Des plages disponibles et des sessions hors plage protégée peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier « ${loft} » a échoué : ${FAILED}. Voir Configuration.`,
  )
  await expect(issues).toContainText(`⚠ Le calendrier « ${blocks} » n'a pas encore été lu : des plages disponibles peuvent manquer, et des sessions être signalées à tort hors plage protégée.`)
  await issues.getByRole('button', { name: /1 hors plage protégée/ }).click()
  const row = issues.getByRole('listitem').filter({ hasText: outside.title }).getByRole('button')
  await expect(row).toContainText(dayInYear(next))
  await expect(row).toContainText(`13 h – 17 h · ${outside.title}`)
  await (isMobile ? row.tap() : row.click())
  await expect(page).toHaveURL(new RegExp(`[?&]day=${next}`))
  await expect(dayButton(page, next)).toBeFocused()
  await expect(chosenDay(page, next).getByRole('listitem').filter({ hasText: unique })).toHaveText([`session13 h – 17 h${outside.title}hors plage protégée`])
  await dayButton(page, day).click()
  await expect(chosenDay(page, day).getByRole('listitem').filter({ hasText: unique })).toHaveText([
    `occupation12 h – 13 hRÉUNION ${unique}, calendrier ${team}`,
    `session15 h – 17 h${inside.title}`,
  ])

  // The list says so too.
  await page.getByRole('button', { name: 'liste' }).click()
  await expect(page.getByRole('region', { name: 'À venir' }).getByRole('button').filter({ hasText: outside.title })).toHaveText(
    `${dayInYear(next)} session 13 h – 17 h ${outside.title} · hors plage protégée`,
  )
  expect(await scrollsSideways(page)).toBe(false)
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
    `${dayInYear(day)} occupation 12 h → ${weekdayAndNumber(addDays(day, 1))} ${stays} · conflit avec RÉPARATION ${unique}`,
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
    // The toolbar's first line has the views' buttons, and "↻" after them, and the month comes under it.
    const box = async (name: string, role: 'button' | 'group' = 'button') => (await page.getByRole(role, { name, exact: true }).boundingBox())!
    const [views, refresh, previous] = [await box('Vue', 'group'), await box('relire les calendriers externes'), await box('mois précédent')]
    expect(Math.abs(refresh.y + refresh.height / 2 - (views.y + views.height / 2))).toBeLessThan(2)
    expect(refresh.x).toBeGreaterThan(views.x + views.width)
    expect(previous.y).toBeGreaterThanOrEqual(views.y + views.height)
    // Its marks show, and its words are there for screen readers only.
    await expect(marks).toBeVisible()
    const words = (await dayCell(page, day).locator('.calendar-things').boundingBox())!
    expect(words.width * words.height).toBeLessThanOrEqual(1)
    // A "+" of at least 24 × 24 px, which overlaps neither its day's number nor the next day's, next to it, on a
    // two-digit day from today on that isn't a Saturday.
    const today = quebecDayAndTime(new Date()).day
    const twoDigits = Array.from({ length: 19 }, (_, i) => `${month}-${10 + i}`).find((each) => each >= today && new Date(each).getUTCDay() !== 6)!
    const plus = (await page.getByRole('button', { name: `nouvelle session le ${longDay(twoDigits)}` }).boundingBox())!
    expect(fingerSized(plus)).toBe(true)
    for (const number of [twoDigits, addDays(twoDigits, 1)]) expect(overlap(plus, (await dayButton(page, number).boundingBox())!)).toBe(false)
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

// Only reads the admin's links: "régénérer les liens", on Intégrations, would replace them under the other tests, and its
// unit tests and the server's integration tests cover it.
test("the legend says what each kind is, in tooltips, and links to the admin's own calendars", async ({ page, baseURL, isMobile }) => {
  if (isMobile) await page.setViewportSize(NARROW)
  await logIn(page, { at: '/admin/calendrier' })
  const legend = page.getByRole('list', { name: 'Légende' })
  const tooltip = page.getByRole('tooltip')

  // Once the links to the admin's calendars, which move the words, are there.
  await expect(legend.getByRole('link')).toHaveCount(3)
  const tips = {
    session: 'Toutes les sessions qui ont une date.',
    occupation: "Période où le studio n'est pas disponible pour des sessions.",
    disponible: 'Plage disponible au studio, protégée des occupations.',
    conflit: 'Une session ou une occupation qui chevauche une plage indisponible.',
  }
  for (const [name, tip] of Object.entries(tips)) {
    const button = legend.getByRole('button', { name })
    await (isMobile ? button.tap() : button.hover())
    await expect(tooltip).toHaveText(tip)
    // Tapped again, it hides its tooltip, which could cover the next one, on the legend's next row.
    if (isMobile) {
      await button.tap()
      await expect(tooltip).toHaveCount(0)
    }
  }

  // On phones, tapping a tooltip only hides it, even where it covers another word, e.g. session's, over "conflit".
  if (isMobile) {
    const conflit = legend.getByRole('button', { name: 'conflit' })
    await conflit.evaluate((word) => word.addEventListener('click', () => (word.dataset.clicked = '')))
    await legend.getByRole('button', { name: 'session' }).tap()
    const [tip, center] = [(await tooltip.boundingBox())!, await centerOf(conflit)]
    expect(overlap(tip, { ...center, width: 0, height: 0 }), 'the tooltip covers "conflit"').toBe(true)
    await tooltip.tap({ position: { x: center.x - tip.x, y: center.y - tip.y } })
    await expect(tooltip).toHaveCount(0)
    await expect(conflit).not.toHaveAttribute('data-clicked')
  }

  // On phones, its words and links are targets as large as a finger needs, none of which overlaps another, even on the
  // legend's next row.
  if (isMobile) {
    const boxes = await Promise.all((await legend.locator('button, a').all()).map(async (target) => (await target.boundingBox())!))
    expect(boxes.map(fingerSized)).toEqual(Array(7).fill(true))
    for (const [i, box] of boxes.entries()) for (const other of boxes.slice(i + 1)) expect(overlap(box, other)).toBe(false)
  }

  // Each calendar's path, and what it's the calendar of, which its link and its name say.
  for (const [path, of] of [['sessions', 'sessions'], ['occupations', 'occupations'], ['availability', 'disponibilités']]) {
    const icon = legend.getByRole('link', { name: `s'abonner au calendrier des ${of}` })
    await expect(icon).toBeVisible()
    const link = new URL((await icon.getAttribute('href'))!)
    expect([link.protocol, link.host, link.pathname]).toEqual(['webcal:', new URL(baseURL!).host, `/${path}.ics`])
    // The calendar it stands for, which the stack can give: the calendar of the sessions has the seed's, announced or not.
    const response = await page.request.get(`/${path}.ics${link.search}`)
    expect(response.status()).toBe(200)
    const body = await response.text()
    // The stack doesn't say which environment the server is, so it's development.
    expect(body).toContain(`X-WR-CALNAME:Parking Radio (development) · ${of}`)
    if (path === 'sessions') expect(body).toContain('SUMMARY:[UNANNOUNCED] ')
  }
  expect(await scrollsSideways(page)).toBe(false)
})
