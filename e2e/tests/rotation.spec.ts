import type { Locator, Page } from '@playwright/test'
import { SEED_SESSIONS } from '../seed-data.ts'
import { PREVIEW_SUFFIX } from '../../server/src/radio/stand-in-tracks.ts'
import { drag } from './drag.ts'
import { test, expect, adminMenu, logIn } from './fixtures.ts'
import type { Schemas } from './fixtures.ts'

// The radio's rotation of sets, which global-setup.ts seeds. There's only one, so every test that reads it or saves it is
// here, one after the other, and the one that saves it, on desktop only, puts the seeded one back. The mobile project's
// tests run alongside the desktop project's, so they only check what saving leaves as it is: the skipped set, and that a
// set is on air. Which one is on air moves along with time, so no test relies on it.

test.describe.configure({ mode: 'serial' })

const ROTATION = '/api/admin/radio/rotation'

const getRotation = async (page: Page): Promise<Schemas['RadioRotation']> => (await page.request.get(ROTATION)).json()

test("the radio's rotation of sets has the seeded sets that seed-data.ts puts in it, in order, the others can be added", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'seeding is the same whatever the screen')
  await logIn(page)
  await expect(adminMenu(page)).toBeVisible()
  const sets = SEED_SESSIONS.flatMap((session) => session.sets).filter((set) => set.soundcloudTrack)
  const inRotation = sets.filter((set) => set.rotation)
  // Told apart by their videos.
  const rotation = await getRotation(page)
  expect(rotation.sets.map((set) => set.youtubeVideo!.id)).toEqual(inRotation.map((set) => set.youtubeVideo))
  // Those whose track the stand-in for SoundCloud only lets a preview be played of are skipped.
  expect(rotation.sets.map((set) => set.skipped)).toEqual(inRotation.map((set) => (set.soundcloudTrack!.endsWith(PREVIEW_SUFFIX) ? ['preview'] : [])))
  const candidates: { sets: Schemas['RotationCandidate'][] } = await (await page.request.get('/api/admin/radio/rotation/candidates')).json()
  expect(candidates.sets.map((set) => set.youtubeVideo!.id)).toEqual(expect.arrayContaining(sets.filter((set) => !set.rotation).map((set) => set.youtubeVideo)))
})

// The rows of the sets, without the days between them.
const shownSets = (page: Page) => page.locator('.rotation-sets > li:not(.radio-tracks-day)')

test('Rotation radio lists the sets from the one on air, with why the skipped one is skipped, and the legacy page is next to it in the menu', async ({ page }) => {
  await logIn(page, { at: '/admin/rotation' })
  await expect(page.getByRole('heading', { level: 1, name: 'Rotation radio' })).toBeVisible()

  await expect(shownSets(page).first()).toContainText('en cours')
  await expect(page.getByText('en cours', { exact: true })).toHaveCount(1)
  const kwame = shownSets(page).filter({ hasText: 'Kwame Asante' })
  await expect(kwame).toContainText('Pas diffusé\u00a0: seul un extrait de 30 secondes de la piste peut être joué.')
  await expect(kwame).toHaveClass('rotation-set-skipped')
  await expect(kwame.getByRole('link', { name: 'Kwame Asante' })).toHaveAttribute('href', /^\/admin\/artistes\//)
  await expect(kwame.getByRole('link', { name: /^ONDE COMMUNE TAKEOVER, / })).toHaveAttribute('href', /^\/admin\/sessions\//)

  await adminMenu(page).getByRole('link', { name: 'rotation radio (legacy)' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Rotation radio (legacy)' })).toBeVisible()
  await expect(page).toHaveURL('/admin/rotation-legacy')
})

// What a set being changed is called: its performers.
const performersOf = (item: Locator) => item.locator('.admin-ordered-text').evaluate((text) => text.firstChild!.textContent!)

test('a set is added, one taken out, and another moved, then the rotation is saved once confirmed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'there is only one rotation, which the mobile project reads meanwhile')
  await logIn(page, { at: '/admin/rotation' })
  await expect(adminMenu(page)).toBeVisible()
  const seeded = await getRotation(page)
  try {
    await page.getByRole('button', { name: 'modifier' }).click()
    const items = page.locator('.admin-ordered > li')
    await expect(items).toHaveCount(seeded.sets.length)

    // One of the sets that can be added, found by its performer, at the end.
    const picker = page.getByRole('combobox', { name: 'Ajouter un set' })
    await picker.click()
    await picker.fill('orval')
    await page.getByRole('option', { name: /^Set de ORVAL/ }).click()
    await expect(items).toHaveCount(seeded.sets.length + 1)
    await expect(picker).toBeFocused()
    expect(await performersOf(items.last())).toBe('ORVAL')

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

    await page.getByRole('button', { name: 'enregistrer' }).click()
    await expect(page.getByText("Le changement s'applique tout de suite à la radio.")).toBeVisible()
    await page.getByRole('button', { name: 'confirmer' }).click()
    await expect(page.getByText('La rotation a été enregistrée.')).toBeVisible()

    // As it was changed, in the order shown.
    const saved = await getRotation(page)
    expect(saved.sets.map((set) => set.performers.map((performer) => performer.name).join(', '))).toEqual(changed)
    await expect(shownSets(page)).toHaveCount(seeded.sets.length)
    await expect(shownSets(page).filter({ hasText: 'ORVAL' })).toHaveCount(1)
    await expect(shownSets(page).filter({ hasText: removed })).toHaveCount(0)
  } finally {
    // The seeded rotation, in its order, for the tests that come after.
    const restored = await page.request.put(ROTATION, { data: { sets: seeded.sets.map((set) => set.id) } })
    expect(restored.ok()).toBe(true)
  }
})
