import type { Locator, Page } from '@playwright/test'
import { SEED_SESSIONS } from '../seed-data.ts'
import { PREVIEW_SUFFIX } from '../../server/src/radio/stand-in-tracks.ts'
import { addDays, QUEBEC_TIME_ZONE, quebecDayAndTime, quebecInstant } from '../../client/src/quebec-time.ts'
import { drag, pickUp } from './drag.ts'
import { test, expect, adminMenu, logIn, NARROW, scrollsSideways } from './fixtures.ts'
import type { Schemas } from './fixtures.ts'

// The radio's rotation of sets, which global-setup.ts seeds. There's only one, so every test that reads it or saves it is
// here, one after the other, and the one that saves it, on desktop only, puts the seeded one back. The mobile project's
// tests run alongside the desktop project's, so they only check what saving leaves as it is: the skipped set, and that a
// set is on air. Which one is on air moves along with time, so no test relies on it.

test.describe.configure({ mode: 'serial' })

const ROTATION = '/api/admin/radio/rotation'

const getRotation = async (page: Page): Promise<Schemas['RadioRotation']> => (await page.request.get(ROTATION)).json()

test("the radio's rotation of sets has the seeded sets that seed-data.ts puts in it, in order, around, the others can be added", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'seeding is the same whatever the screen')
  await logIn(page)
  await expect(adminMenu(page)).toBeVisible()
  const sets = SEED_SESSIONS.flatMap((session) => session.sets).filter((set) => set.soundcloudTrack)
  const inRotation = sets.filter((set) => set.rotation)
  // Told apart by their videos, from the play head, which moves along with time: the seeded order, around.
  const rotation = await getRotation(page)
  const videos = inRotation.map((set) => set.youtubeVideo)
  const at = videos.indexOf(rotation.sets[0].youtubeVideo!.id)
  expect(rotation.sets.map((set) => set.youtubeVideo!.id)).toEqual([...videos.slice(at), ...videos.slice(0, at)])
  // Those whose track the stand-in for SoundCloud only lets a preview be played of are skipped.
  const previews = new Set(inRotation.filter((set) => set.soundcloudTrack!.endsWith(PREVIEW_SUFFIX)).map((set) => set.youtubeVideo))
  expect(rotation.sets.map((set) => set.skipped)).toEqual(rotation.sets.map((set) => (previews.has(set.youtubeVideo!.id) ? ['preview'] : [])))
  const candidates: { sets: Schemas['RotationCandidate'][] } = await (await page.request.get('/api/admin/radio/rotation/candidates')).json()
  expect(candidates.sets.map((set) => set.youtubeVideo!.id)).toEqual(expect.arrayContaining(sets.filter((set) => !set.rotation).map((set) => set.youtubeVideo)))
})

// How far into the set of the row `row` the radio is, on the row under the play head.
const progress = (row: Locator) => row.getByRole('progressbar', { name: 'Avancement du set' })

// The rows of the sets, without the days between them.
const shownSets = (page: Page) => page.locator('.rotation-sets > li[data-set]')

test('Rotation radio lists the sets from the one on air, with why the skipped one is skipped, and the legacy page is next to it in the menu', async ({ page }) => {
  await logIn(page, { at: '/admin/rotation' })
  await expect(page.getByRole('heading', { level: 1, name: 'Rotation radio' })).toBeVisible()

  // The play head, over the set on air, which shows how far into it the radio is.
  await expect(page.locator('.rotation-head')).toHaveText('▶ en ondes')
  await expect(progress(shownSets(page).first())).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(1)
  // Which screen readers are told.
  await expect(shownSets(page).first().locator('.visually-hidden')).toHaveText('en ondes')
  const kwame = shownSets(page).filter({ hasText: 'Kwame Asante' })
  await expect(kwame).toContainText('Pas diffusé\u00a0: seul un extrait de 30 secondes de la piste peut être joué.')
  await expect(kwame).toHaveClass('rotation-set-skipped')
  await expect(kwame.getByRole('link', { name: 'Kwame Asante' })).toHaveAttribute('href', /^\/admin\/artistes\//)
  await expect(kwame.getByRole('link', { name: /^ONDE COMMUNE TAKEOVER, / })).toHaveAttribute('href', /^\/admin\/sessions\//)

  await adminMenu(page).getByRole('link', { name: 'rotation radio (legacy)' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Rotation radio (legacy)' })).toBeVisible()
  await expect(page).toHaveURL('/admin/rotation-legacy')
})

// How far apart what's laid out side by side, or one under the other, can be found, in pixels, for rounding.
const TOLERANCE = 2

type Box = { x: number; y: number; width: number; height: number }
// Where the elements of the row `row` that `selectors` select, the first of each, are drawn, read at once, so that they're
// of the same render, even if the set on air ends meanwhile.
const boxesIn = (row: Locator, selectors: string[]): Promise<Box[]> =>
  row.evaluate(
    (row, selectors) =>
      selectors.map((selector) => {
        const { x, y, width, height } = row.querySelector(selector)!.getBoundingClientRect()
        return { x, y, width, height }
      }),
    selectors,
  )

const genresOf = (row: Locator) => row.locator('.rotation-genres')

// That the genres of the row `row` are in a column of their own, after its session and before what `after` selects, and
// where they are.
async function beside(row: Locator, after: string) {
  const [session, genres, next] = await boxesIn(row, ['.rotation-set-session', '.rotation-genres', after])
  expect(session.x + session.width).toBeLessThanOrEqual(genres.x + TOLERANCE)
  expect(genres.x + genres.width).toBeLessThanOrEqual(next.x + TOLERANCE)
  return genres
}

test("Rotation radio shows each set's genres in a column of their own, after what the set is, also while it's changed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'phones show them under the session, which the mobile project checks')
  await logIn(page, { at: '/admin/rotation' })
  const clementine = shownSets(page).filter({ hasText: 'Clémentine Brûlée' })
  // Screen readers read them as text, with the commas that aren't shown.
  await expect(genresOf(clementine)).toHaveText('techno, acid')
  const genres = await beside(clementine, '.rotation-set-length')

  // Lined up from row to row, two of them fitting on a line.
  const talia = shownSets(page).filter({ hasText: 'Talia' })
  const [taliaGenres, tech, deep] = await boxesIn(talia, ['.rotation-genres', '.rotation-genre:first-child', '.rotation-genre:last-child'])
  expect(Math.abs(taliaGenres.x - genres.x)).toBeLessThanOrEqual(TOLERANCE)
  expect(Math.abs(tech.y - deep.y)).toBeLessThanOrEqual(TOLERANCE)
  // More go on more lines, which leave the session under the performers.
  const miro = shownSets(page).filter({ hasText: 'MIRO VELANE' })
  await expect(miro.locator('.rotation-genre')).toHaveCount(4)
  const [performers, session, miroGenres, first, last] = await boxesIn(miro, [
    '.rotation-set-performers',
    '.rotation-set-session',
    '.rotation-genres',
    '.rotation-genre:first-child',
    '.rotation-genre:last-child',
  ])
  expect(last.y).toBeGreaterThan(first.y + TOLERANCE)
  expect(session.y - (performers.y + performers.height)).toBeLessThanOrEqual(TOLERANCE)
  expect(session.y + session.height).toBeLessThan(miroGenres.y + miroGenres.height)

  // The same while the rotation is changed, before the « × » that takes the set out.
  await page.getByRole('button', { name: 'modifier' }).click()
  const item = page.locator('.admin-ordered > li').filter({ hasText: 'Clémentine Brûlée' })
  await expect(genresOf(item)).toHaveText('techno, acid')
  await beside(item, '[data-action="remove"]')

  // The sets that can be added, found by their genres, which they show after their session, alone or with other fields.
  const picker = page.getByRole('combobox', { name: 'Ajouter un set' })
  await picker.click()
  await picker.fill('ambient')
  await expect(page.getByRole('option')).toHaveText([/^Set de ORVALGUEST MIXES, .* · ambient, techno$/])
  await picker.fill('house guest')
  await expect(page.getByRole('option')).toHaveText([/^Set de KALMARGUEST MIXES, .* · house, minimal$/])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'annuler' }).click()
})

test("on phones, a set's genres are under its session, in the list and while it's changed, within the screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'wider screens show them in a column of their own')
  await page.setViewportSize(NARROW)
  await logIn(page, { at: '/admin/rotation' })
  // Kwame's set, which is skipped, so that saving the rotation, which the desktop project does meanwhile, leaves it.
  const under = async (row: Locator) => {
    await expect(genresOf(row)).toHaveText('afro house, amapiano')
    const [session, genres] = await boxesIn(row, ['.rotation-set-session', '.rotation-genres'])
    expect(genres.y).toBeGreaterThanOrEqual(session.y + session.height - TOLERANCE)
    expect(Math.abs(genres.x - session.x)).toBeLessThanOrEqual(TOLERANCE)
    expect(await scrollsSideways(page)).toBe(false)
  }
  await under(shownSets(page).filter({ hasText: 'Kwame Asante' }))
  await page.getByRole('button', { name: 'modifier' }).click()
  await under(page.locator('.admin-ordered > li').filter({ hasText: 'Kwame Asante' }))
  await page.getByRole('button', { name: 'annuler' }).click()
})

// What a set being changed is called: its performers.
const performersOf = (item: Locator) => item.locator('.rotation-set-performers').evaluate((performers) => performers.textContent!)

// For each of the rows `rows`, when its set goes on air, or would once the rotation being changed is saved, without the
// day, or '' when it has no time, and whether it's skipped, which it says.
const timesOf = (rows: Locator) =>
  rows.evaluateAll((rows) =>
    rows.map((row) => ({ time: row.querySelector('.rotation-set-time')!.textContent!, skipped: row.textContent!.includes('Pas diffusé') })),
  )
const A_TIME = /^\d\d\s*h\s*\d\d$/

test('while the rotation is changed, each set that can be played says when it would go on air, at phone width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the desktop project checks the times against those of the rotation once saved')
  await logIn(page, { at: '/admin/rotation' })
  await page.getByRole('button', { name: 'modifier' }).click()
  const items = page.locator('.admin-ordered > li')
  await expect(items.first()).toBeVisible()
  // Every set that isn't skipped has been read, so it has its length, and so a time.
  const times = await timesOf(items)
  expect(times.map(({ time }) => time)).toEqual(times.map(({ skipped }) => (skipped ? '' : expect.stringMatching(A_TIME))))
  expect(await timesOf(items.filter({ hasText: 'Kwame Asante' }))).toEqual([{ time: '', skipped: true }])
  expect(await scrollsSideways(page)).toBe(false)
  await page.getByRole('button', { name: 'annuler' }).click()
})

// The day as the rotation shows it, e.g. « dimanche 29 novembre ».
const dayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: QUEBEC_TIME_ZONE })

test('while the rotation is changed, the day is a line above the first set of that day, left blank while a set is moved', async ({ page }, testInfo) => {
  const touch = testInfo.project.name === 'mobile'
  if (touch) await page.setViewportSize(NARROW)
  await logIn(page)
  await expect(adminMenu(page)).toBeVisible()
  // The browser's clock, stopped at the last 23:45 in Québec, so that the sets after one put under the play head, which
  // starts then, are on the next day. Not later than the server's clock, which would have the page load the rotation again
  // every few seconds, once the set on air has ended by the browser's clock. Set once logged in, so that Turnstile's frame
  // doesn't get it, and before the page is loaded, so that the timers it sets, which still run in real time, can be
  // cleared.
  const now = quebecDayAndTime(new Date())
  let today = now.day
  if (now.time < '23:45') today = addDays(today, -1)
  await page.clock.setFixedTime(quebecInstant(today, '23:45')!)
  await page.goto('/admin/rotation')
  await page.getByRole('button', { name: 'modifier' }).click()
  const items = page.locator('.admin-ordered > li')
  // The set on air, first, taken out, so that the one under the play head is another, which starts now, by the browser's
  // clock.
  await expect(progress(items.first())).toBeVisible()
  const count = await items.count()
  await items.first().getByRole('button', { name: /^retirer / }).click()
  await expect(items).toHaveCount(count - 1)

  // The next day, above the box of the first set of that day, the one after the set under the play head that can be
  // played, outside it, as the rotation's day lines are, but in its row, which the play head isn't drawn over. Which sets
  // they are, by their places.
  const tomorrow = dayFormat.format(quebecInstant(addDays(today, 1), '12:00')!)
  const lined = async () => {
    const [head, next] = (await timesOf(items)).flatMap(({ skipped }, i) => (skipped ? [] : [i]))
    await expect(page.locator('.admin-ordered .rotation-day')).toHaveText([tomorrow])
    const row = (i: number) => `.admin-ordered > li:nth-child(${i + 1})`
    const [day, box, headBox, line] = await boxesIn(page.locator('.rotation-edit'), [
      `${row(next)} > .rotation-day`,
      `${row(next)} > .admin-ordered-item`,
      `${row(head)} > .admin-ordered-item`,
      '.rotation-head',
    ])
    expect(day.y + day.height).toBeLessThanOrEqual(box.y + TOLERANCE)
    expect(Math.abs(day.x - box.x)).toBeLessThanOrEqual(TOLERANCE)
    expect(Math.abs(line.y - headBox.y)).toBeLessThanOrEqual(TOLERANCE)
    expect(await scrollsSideways(page)).toBe(false)
    return { head, next }
  }
  const before = await lined()

  // While a set is being moved, here with the keyboard, the day isn't shown, but its line keeps its place, until the set
  // is put back.
  const dayOf = items.nth(before.next).locator('.rotation-day')
  const spacing = async () => {
    const [day, box] = await boxesIn(items.nth(before.next), ['.rotation-day', '.admin-ordered-item'])
    return { height: day.height, above: box.y - day.y }
  }
  const shown = await spacing()
  await pickUp(page, items.nth(before.next).getByRole('button', { name: /^réordonner / }))
  await expect(dayOf).toBeHidden()
  expect(await spacing()).toEqual(shown)
  await page.keyboard.press('Escape')
  await expect(dayOf).toBeVisible()

  // The set of that day, dragged to the first place, under the play head, which then starts it now: the day is worked out
  // again once it's dropped, above the set that was under the play head.
  const [moved, was] = await Promise.all([performersOf(items.nth(before.next)), performersOf(items.nth(before.head))])
  // The first set, and the one dragged there, both on the screen, but out of where the page scrolls while a set is dragged
  // near its edges, even on phones with the skipped set in between.
  await items.first().evaluate((row) => window.scrollBy(0, row.getBoundingClientRect().top - 180))
  await drag(page, items.nth(before.next).getByRole('button', { name: /^réordonner / }), items.first(), { touch })
  expect(await performersOf(items.first())).toBe(moved)
  const after = await lined()
  expect(after.head).toBe(0)
  expect(await performersOf(items.nth(after.next))).toBe(was)
  await page.getByRole('button', { name: 'annuler' }).click()
})

test('a set is added, one taken out, and another moved, then the rotation is saved once confirmed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'there is only one rotation, which the mobile project reads meanwhile')
  await logIn(page, { at: '/admin/rotation' })
  await expect(adminMenu(page)).toBeVisible()
  const seeded = await getRotation(page)
  try {
    await page.getByRole('button', { name: 'modifier' }).click()
    const items = page.locator('.admin-ordered > li')
    await expect(items).toHaveCount(seeded.sets.length)
    // The first set, which is on air, is the one on air once it's saved.
    await expect(page.locator('.rotation-head')).toHaveText('▶ en ondes')
    await expect(progress(items.first())).toBeVisible()

    // One of the sets that can be added, found by its performer, at the end.
    const picker = page.getByRole('combobox', { name: 'Ajouter un set' })
    await picker.click()
    await picker.fill('orval')
    await page.getByRole('option', { name: /^Set de ORVAL/ }).click()
    await expect(items).toHaveCount(seeded.sets.length + 1)
    await expect(picker).toBeFocused()
    expect(await performersOf(items.last())).toBe('ORVAL')
    // Its track, read as it's added, which the stand-in for SoundCloud gives as it is on SoundCloud (see
    // server/src/radio/stand-in-tracks.ts), lasts 56:35.
    await expect(items.last()).toContainText(' · 57\u00a0min')

    // Neither the set on air, which is first, nor the skipped one, which the mobile project checks.
    let out = 1
    while ((await performersOf(items.nth(out))) === 'Kwame Asante') out++
    const removed = await performersOf(items.nth(out))
    await items.nth(out).getByRole('button', { name: /^retirer / }).click()
    await expect(items).toHaveCount(seeded.sets.length)

    // ORVAL's set, dragged up a place with the mouse.
    const last = seeded.sets.length - 1
    await drag(page, items.nth(last).getByRole('button', { name: /^réordonner Set de ORVAL/ }), items.nth(last - 1), { touch: false })
    expect(await performersOf(items.nth(last - 1))).toBe('ORVAL')
    const changed = await Promise.all((await items.all()).map(performersOf))

    // When each set would go on air: each one that can be played, ORVAL's included, whose length is known once its track
    // is read.
    const projected = await timesOf(items)
    expect(projected.map(({ time }) => time)).toEqual(projected.map(({ skipped }) => (skipped ? '' : expect.stringMatching(A_TIME))))

    await page.getByRole('button', { name: 'enregistrer' }).click()
    // In a dialog over the page, which Escape closes, going back to the list.
    const dialog = page.getByRole('dialog', { name: 'Enregistrer la rotation' })
    await expect(dialog.getByRole('button', { name: 'confirmer' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'enregistrer' })).toBeFocused()
    await page.getByRole('button', { name: 'enregistrer' }).click()
    // It says that the set on air, which stays, goes on.
    await expect(dialog).toHaveAccessibleDescription("Le set en cours continue\u00a0: les changements s'appliquent dès le set suivant.")
    await expect(dialog.getByRole('button', { name: 'confirmer' })).toBeFocused()
    await dialog.getByRole('button', { name: 'confirmer' }).click()
    await expect(page.getByText('La rotation a été enregistrée.')).toBeVisible()
    await expect(dialog).toBeHidden()

    // As it was changed, in the order shown.
    const saved = await getRotation(page)
    expect(saved.sets.map((set) => set.performers.map((performer) => performer.name).join(', '))).toEqual(changed)
    await expect(shownSets(page)).toHaveCount(seeded.sets.length)
    await expect(shownSets(page).filter({ hasText: 'ORVAL' })).toHaveCount(1)
    await expect(shownSets(page).filter({ hasText: removed })).toHaveCount(0)
    // When each set goes on air, as it was worked out while it was changed, the set on air having gone on.
    const shown = await timesOf(shownSets(page))
    expect(shown).toEqual(projected)
  } finally {
    // The seeded rotation, in its order, for the tests that come after.
    const restored = await page.request.put(ROTATION, { data: { sets: seeded.sets.map((set) => set.id) } })
    expect(restored.ok()).toBe(true)
  }
})

// How the confirmation names a set within a sentence, with `article`, e.g. "le set de Aurore et Brume", as the page does
// (see `setInSentence` in client/src/pages/admin/describe.ts, which can't be imported here).
const inSentence = (set: Schemas['RotationSet'], article: string) => {
  const names = set.performers.map((performer) => performer.name)
  return `${article} set${names.length > 0 ? ` de ${names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : names[0]}` : ''}`
}

test('another set, dragged first, goes on air right away once the rotation is saved', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'there is only one rotation, which the mobile project reads meanwhile')
  await logIn(page, { at: '/admin/rotation' })
  await expect(adminMenu(page)).toBeVisible()
  const seeded = await getRotation(page)
  try {
    await page.getByRole('button', { name: 'modifier' }).click()
    const items = page.locator('.admin-ordered > li')
    await expect(items).toHaveCount(seeded.sets.length)
    // The first set after the one on air that can be played, which comes next.
    const next = seeded.sets.findIndex((set, i) => i > 0 && set.skipped.length === 0)
    await drag(page, items.nth(next).getByRole('button', { name: /^réordonner / }), items.first(), { touch: false })
    expect(await performersOf(items.first())).toBe(seeded.sets[next].performers.map((performer) => performer.name).join(', '))
    // Under the play head, from its start once it's saved.
    await expect(progress(items.first())).toHaveAttribute('aria-valuenow', '0')

    await page.getByRole('button', { name: 'enregistrer' }).click()
    const dialog = page.getByRole('dialog', { name: 'Enregistrer la rotation' })
    await expect(dialog).toHaveAccessibleDescription(
      `${inSentence(seeded.sets[next], 'Le')} passera tout de suite en ondes, à la place ${inSentence(seeded.sets[0], 'du')}.`,
    )
    await dialog.getByRole('button', { name: 'confirmer' }).click()
    await expect(page.getByText('La rotation a été enregistrée.')).toBeVisible()

    // On air, from its start, and first.
    const saved = await getRotation(page)
    expect(saved.current?.setId).toBe(seeded.sets[next].id)
    expect(Date.parse(saved.current!.startedAt)).toBeGreaterThan(Date.parse(seeded.current!.startedAt))
    await expect(progress(shownSets(page).first())).toBeVisible()
    await expect(shownSets(page).first()).toContainText(seeded.sets[next].performers[0].name)
  } finally {
    const restored = await page.request.put(ROTATION, { data: { sets: seeded.sets.map((set) => set.id) } })
    expect(restored.ok()).toBe(true)
  }
})
