import { createHash } from 'node:crypto'
import type { Locator, Page, Request, TestInfo } from '@playwright/test'
import { addDays, quebecInstant } from '../../client/src/quebec-time.ts'
import { drag, moveWithKeyboard, pickUp } from './drag.ts'
import { test, expect, adminMenu, logIn } from './fixtures.ts'

// The sessions and their sets: the seeded ones (see seed-data.ts), searched and listed on their artists' and collectives'
// pages, and sessions that tests add, change and delete, in Québec time, whatever the browser's time zone.

// The rows of a page or a table that have `text`, and what a page says of `label`.
const rowsOf = (within: Page | Locator, text: string) => within.getByRole('row').filter({ hasText: text })
// A set's duration and its status, in its row, whose first cell has the handle that reorders the sets.
const durationOf = (row: Locator) => row.getByRole('cell').nth(1)
const statusOf = (row: Locator) => row.getByRole('cell').nth(6)
// What the session's record, or the content of its event on RA, which is within it, says for `label`.
const recordValue = (page: Page, record: string, label: string) =>
  page.getByLabel(record, { exact: true }).locator(':scope > dt', { hasText: new RegExp(`^${label}$`) }).locator('+ dd')
const value = (page: Page, label: string) => recordValue(page, 'Session', label)
// The date or the time a session starts or ends at, in its form.
const timeInput = (page: Page, when: 'Début' | 'Fin', part: 'date' | 'heure') => page.getByRole('group', { name: when, exact: true }).getByLabel(part, { exact: true })
const raValue = (page: Page, label: string) => recordValue(page, "Contenu de l'événement RA", label)
// Holds back the server's answers to the requests to `url`, until what this returns is called, and lets the requests go
// through as usual afterwards.
async function holdBack(page: Page, url: string): Promise<() => Promise<void>> {
  let answer!: () => void
  const answered = new Promise<void>((resolve) => (answer = resolve))
  await page.route(url, async (route) => {
    await answered
    await route.continue()
  })
  return async () => {
    answer()
    await page.unroute(url)
  }
}

test('the seeded sessions are listed, searched and filtered, and on the pages of their artists and collectives', async ({ page }) => {
  await logIn(page, { at: '/admin/sessions?status=all' })
  const search = page.getByRole('searchbox', { name: 'Rechercher' })
  await search.fill('onde commune takeover')
  // Its name is the one its type gives it.
  const row = rowsOf(page, 'ONDE COMMUNE TAKEOVER')
  await expect(row.getByRole('link', { name: 'Takeover', exact: true })).toBeVisible()
  await expect(row).toContainText('20 h – 23 h')
  await expect(row).toContainText('Clémentine Brûlée · Fréquence Boréale · Kwame Asante')
  await expect(row).toContainText('jouée')

  // The one whose date isn't known yet.
  await search.fill('ondine')
  const undated = rowsOf(page, 'LES SŒURS ONDES TAKEOVER')
  await expect(undated).toContainText('date à déterminer')
  await expect(undated).toContainText('3 h')
  await undated.getByRole('link', { name: 'date à déterminer' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'LES SŒURS ONDES TAKEOVER' })).toBeVisible()
  const sets = page.getByRole('table', { name: 'Sets' })
  // In their order, by their durations.
  await expect(sets.getByRole('row').nth(1)).toContainText('Ondine')
  await expect(durationOf(rowsOf(sets, 'Ondine'))).toHaveText('1 h')
  await expect(durationOf(rowsOf(sets, 'Écume'))).toHaveText('à déterminer')
  await page.goBack()

  // The one over three days, which says the day it ends on, in the list and on its page.
  await search.fill('marathon modulaire')
  const marathon = rowsOf(page, 'MARATHON MODULAIRE')
  await expect(marathon).toContainText(/18 h – \S+\. \d+ \S+, \d+ h/)
  await marathon.getByRole('link').first().click()
  await expect(value(page, 'Quand')).toHaveText(/^du .+ à 18 h au .+ à \d+ h$/)
  await expect(value(page, 'Durée')).toHaveText('31 h')
  await page.goBack()

  // The cancelled one.
  await search.fill('sable mouvant')
  await page.getByRole('group', { name: 'Statut' }).getByRole('button', { name: /^annulées/ }).click()
  await expect(rowsOf(page, 'Les Nuits Basses')).toContainText('annulée')
  // Which stays announced.
  await expect(rowsOf(page, 'Les Nuits Basses')).toContainText('annoncée')

  // Those of the other types, among which a synth meetup, which has no sets.
  await page.getByRole('group', { name: 'Statut' }).getByRole('button', { name: /^toutes/ }).click()
  await search.fill('synth meetup')
  await expect(rowsOf(page, 'SYNTH MEETUPS')).toContainText('Synth meetup')
  // Which has the description its type gives it, and a flyer.
  await rowsOf(page, 'SYNTH MEETUPS').getByRole('link').first().click()
  await expect(value(page, 'Description')).toContainText('Rencontres hebdomadaires de création sonore et audiovisuelle')
  await expect(value(page, 'Flyer').getByRole('img', { name: 'Flyer de SYNTH MEETUPS' })).toHaveJSProperty('naturalWidth', 64)
  // Its event on RA has a lineup, though it has no sets.
  await value(page, 'Événement RA').getByRole('button', { name: 'créer' }).click()
  await expect(raValue(page, 'Line-up')).toHaveText(/^OPEN JAM/)
  await page.getByRole('button', { name: 'annuler' }).click()
  // The form shows the same one, from the client's copy of the server's.
  const described = await value(page, 'Description').textContent()
  await page.getByRole('button', { name: 'modifier' }).click()
  await expect(page.getByLabel('Description', { exact: true })).toHaveAttribute('placeholder', described!)
  await page.getByRole('button', { name: 'annuler' }).click()
  await page.goBack()
  await search.fill('live performance')
  await expect(rowsOf(page, 'LIVE PERFORMANCE')).toContainText('Ondine')

  await search.fill('onde commune takeover')
  await row.getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'ONDE COMMUNE TAKEOVER' })).toBeVisible()
  await expect(value(page, 'Nom')).toHaveText('ONDE COMMUNE TAKEOVER')
  // With its own description, and its flyer.
  await expect(value(page, 'Description')).toContainText('Trois artistes, trois heures')
  await expect(value(page, 'Flyer').getByRole('img', { name: 'Flyer de ONDE COMMUNE TAKEOVER' })).toHaveJSProperty('naturalWidth', 64)
  const sessionPage = new URL(page.url()).pathname
  await expect(durationOf(rowsOf(sets, 'Kwame Asante'))).toHaveText('1 h')

  // His page lists his set, but not the session's other sets.
  await sets.getByRole('link', { name: 'Kwame Asante', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kwame Asante', exact: true })).toBeVisible()
  const his = page.getByRole('table', { name: 'Sets' })
  await expect(rowsOf(his, 'ONDE COMMUNE TAKEOVER').getByRole('cell').nth(1)).toHaveText('1 h')
  await expect(his.locator(`a[href="${sessionPage}"]`)).toHaveCount(1)
  await expect(his).not.toContainText('Clémentine Brûlée')

  // And so does the page of the collective whose takeover it is.
  await page.goto(sessionPage)
  await value(page, 'Takeover de').getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Onde Commune', exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Sessions' }).locator(`a[href="${sessionPage}"]`)).toBeVisible()
  // Which keeps it from being deleted.
  await expect(page.getByRole('button', { name: 'supprimer le collectif' })).toHaveAttribute('aria-disabled', 'true')
})

test("a seeded session's page shows the content of its event on RA, its performers from its sets that aren't cancelled, once asked", async ({ page }) => {
  await logIn(page, { at: '/admin/sessions' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('guest mixes')
  // The soonest, which is the seeded one.
  await rowsOf(page, 'GUEST MIXES').first().getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'GUEST MIXES' })).toBeVisible()
  await value(page, 'Événement RA').getByRole('button', { name: 'créer' }).click()
  await expect(raValue(page, 'Titre')).toHaveText(/^GUEST MIXES/)
  await expect(raValue(page, 'Quand')).toHaveText(await value(page, 'Quand').innerText())
  await expect(raValue(page, 'Line-up').locator('span')).toHaveText('Clémentine Brûlée\nClément Brûlé\nKwame Asante')
  await expect(raValue(page, 'Salle').getByRole('link')).toHaveAttribute('href', 'https://ra.co/clubs/288529')
  await expect(raValue(page, 'Description')).toHaveText(/^LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC/)
  await expect(page.getByRole('button', { name: 'copier le line-up' })).toBeVisible()
})

test('a seeded session says when its sets add up to more than it', async ({ page }) => {
  await logIn(page, { at: '/admin/sessions' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('soirée à revoir')
  await rowsOf(page, 'SOIRÉE À REVOIR').getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'SOIRÉE À REVOIR' })).toBeVisible()
  // As a warning.
  const warning = page.getByText(/Les sets durent /)
  await expect(warning).toHaveText('\u26a0\ufe0e Les sets durent 2 h 15, plus que la session (2 h).')
  await expect(warning).toHaveClass(/admin-warning/)
})

test("a control that can't be used says why in a tooltip, right under it, while hovered, focused or tapped", async ({ page, isMobile }) => {
  // Les Nuits Basses' takeover, which is cancelled, so sets can't be added to it.
  await logIn(page, { at: '/admin/sessions?status=cancelled' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('les nuits basses')
  await rowsOf(page, 'LES NUITS BASSES TAKEOVER').getByRole('link').first().click()
  const add = page.getByRole('button', { name: 'ajouter un set' })
  const why = 'La session est annulée\u00a0: on ne peut pas lui ajouter de set.'
  await expect(add).toHaveAccessibleDescription(why)
  const tooltip = page.getByRole('tooltip').filter({ visible: true })
  await expect(tooltip).toHaveCount(0)

  if (isMobile) {
    // Tapping it shows its tooltip, by force, since Playwright waits for an aria-disabled button to be enabled, and
    // tapping something else hides it.
    await add.tap({ force: true })
    await expect(tooltip).toHaveText(why)
    await page.getByRole('heading', { level: 1 }).tap()
    await expect(tooltip).toHaveCount(0)
    return
  }

  // Hovering it shows its tooltip, right under it, and so does the keyboard's focus, until Escape.
  await add.hover({ force: true })
  await expect(tooltip).toHaveText(why)
  const [addBox, tipBox] = [await add.boundingBox(), await tooltip.boundingBox()]
  expect(Math.abs(tipBox!.y - (addBox!.y + addBox!.height))).toBeLessThan(1)
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)
  // Clicking it with the mouse doesn't keep it once the mouse is gone.
  await add.click({ force: true })
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)
  // With the keyboard, from the heading of the sets, just before it.
  await page.getByRole('heading', { name: 'Sets', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(add).toBeFocused()
  await expect(tooltip).toHaveText(why)
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await expect(add).toBeFocused()
})

// With Collectif Béton's takeover, BÉTON 140, which comes from its application (see seed-data.ts).
test("a seeded takeover links to the application it comes from, whose page links back to it", async ({ page }) => {
  await logIn(page, { at: '/admin/sessions?status=all' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('béton 140')
  await rowsOf(page, 'BÉTON 140').getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'BÉTON 140' })).toBeVisible()
  await value(page, 'Candidature').getByRole('link', { name: /^reçue le / }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Candidature de Collectif Béton' })).toBeVisible()
  const sessions = page.getByRole('table', { name: 'Sessions' })
  await expect(rowsOf(sessions, 'BÉTON 140')).toContainText('jouée')
  await rowsOf(sessions, 'BÉTON 140').getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1, name: 'BÉTON 140' })).toBeVisible()
})

// With Collectif Béton's takeover, BÉTON 140, whose artists are Mathis, Rosalie, Kofi and Yasmine, in that order, and whose
// second set is Mathis and Rosalie's (see seed-data.ts). Nothing is saved.
test("a takeover's set form offers its collective's artists first, in its order, but not its performers, on its page and on « nouvelle session »", async ({ page }) => {
  // The first options of the open combobox of `form`, each its name then what it's marked with.
  const firstOptions = (form: Locator, count: number) => async () => (await form.getByRole('option').allTextContents()).slice(0, count)

  await logIn(page, { at: '/admin/sessions?status=all' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('béton 140')
  await rowsOf(page, 'BÉTON 140').getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'BÉTON 140' })).toBeVisible()
  await page.getByRole('button', { name: 'modifier : Set de Mathis et Rosalie' }).click()
  const set = page.getByRole('region', { name: 'Set de Mathis et Rosalie' })
  const picker = set.getByRole('combobox', { name: 'Ajouter un artiste' })
  await picker.click()
  // Not Mathis and Rosalie, who are in the set.
  await expect.poll(firstOptions(set, 2)).toEqual(['KofiCollectif Béton', 'YasmineCollectif Béton'])
  // The guest of its first set is offered as in other sets.
  await expect(set.getByRole('option', { name: /^DJ Poutine/ })).toHaveCount(1)
  await expect(set.getByRole('option', { name: /^DJ Poutine/ })).not.toContainText('Collectif Béton')
  // Its artists whose names have an « o » come first, ahead of those whose names start with one, e.g. Ondine.
  await picker.fill('o')
  await expect.poll(firstOptions(set, 1)).toEqual(['KofiCollectif Béton'])
  await expect(set.getByRole('option', { name: /^Ondine/ })).toHaveCount(1)
  await picker.press('Escape')
  await set.getByRole('button', { name: 'annuler' }).click()

  // As its collective is picked on « nouvelle session ».
  await page.goto('/admin/sessions/nouvelle')
  await page.getByRole('radio', { name: 'Takeover' }).check()
  await page.getByRole('combobox', { name: 'Collectif' }).fill('Collectif Béton')
  await page.getByRole('option', { name: /^Collectif Béton/ }).click()
  await page.getByRole('button', { name: 'ajouter un set' }).click()
  const newSet = page.getByRole('region', { name: 'Nouveau set' })
  await newSet.getByRole('combobox', { name: 'Ajouter un artiste' }).click()
  await expect.poll(firstOptions(newSet, 4)).toEqual(['MathisCollectif Béton', 'RosalieCollectif Béton', 'KofiCollectif Béton', 'YasmineCollectif Béton'])
})

test('a takeover and its set are given the applications they come from in their forms, which link to them, until they are taken away', async ({ page }, testInfo) => {
  const { unique, day } = own(testInfo)
  await logIn(page)
  const mine = await addOwnCollective(page, unique)
  const collectives = await addOwnApplication(page, { collectiveId: mine.collective.id, dates: [day] })
  const artists = await addOwnApplication(page, { artistId: mine.artist.id, dates: [day] })
  const fields = { start: `${day}T21:00-04:00`, durationMinutes: 120, type: 'takeover', takeover: mine.collective.id, application: null, name: `E2E ${unique}`, raEvent: null, description: '' }
  const created = await page.request.post('/api/admin/sessions', { multipart: { session: JSON.stringify(fields) } })
  expect(created.ok()).toBe(true)
  const id: string = (await created.json()).session.id
  const set = { performers: [{ id: mine.artist.id }], durationMinutes: 60, performanceTypes: [], otherPerformanceType: '', genres: [], soundcloudTrack: null, youtubeVideo: null, application: null }
  expect((await page.request.post(`/api/admin/sessions/${id}/sets`, { data: set })).ok()).toBe(true)
  await mockEvents(page)

  // The takeover's, among its collective's.
  await page.goto(`/admin/sessions/${id}`)
  await expect(value(page, 'Candidature')).toHaveText('-')
  await page.getByRole('button', { name: 'modifier', exact: true }).click()
  const picker = page.getByRole('combobox', { name: 'Candidature' })
  await expect(picker).toHaveValue('Aucune candidature')
  await picker.click()
  await page.getByRole('option', { name: /^Reçue le / }).click()
  await page.getByRole('button', { name: 'enregistrer' }).click()
  await expect(value(page, 'Candidature').getByRole('link')).toHaveAttribute('href', `/admin/candidatures/${collectives}`)

  // The set's, among its performer's.
  const sets = page.getByRole('table', { name: 'Sets' })
  await sets.getByRole('button', { name: /^modifier : / }).click()
  await picker.click()
  await page.getByRole('option', { name: new RegExp(`^${mine.artist.name}, reçue le `) }).click()
  await page.getByRole('button', { name: 'enregistrer' }).click()
  await sets.getByRole('link', { name: /^Candidature reçue le / }).click()
  await expect(page).toHaveURL(`/admin/candidatures/${artists}`)
  const listed = page.getByRole('table', { name: 'Sets' })
  await expect(listed.getByRole('row')).toHaveCount(2)
  await expect(listed).toContainText('1 h')
  await expect(page.getByText(/^La candidature sera supprimée/)).toContainText('Les sets associés restent.')
  await listed.getByRole('link', { name: `E2E ${unique}` }).click()

  // Taken away.
  await sets.getByRole('button', { name: /^modifier : / }).click()
  await picker.click()
  await page.getByRole('option', { name: 'Aucune candidature' }).click()
  await page.getByRole('button', { name: 'enregistrer' }).click()
  await expect(sets.getByRole('link', { name: /^Candidature/ })).toHaveCount(0)

  expect((await page.request.delete(`/api/admin/sessions/${id}`)).ok()).toBe(true)
  await deleteOwn(page, mine)
})

test("an artist's sets, and a collective's takeover, are added from the pages of the applications they come from", async ({ page, hasTouch }, testInfo) => {
  const { unique, day, otherDay } = own(testInfo)
  await logIn(page)
  const mine = await addOwnCollective(page, unique)
  const fields = { dates: [day], timeSlots: [{ start: '20:00', end: '23:00' }], otherPerformanceType: 'Synthé' }
  const artists = await addOwnApplication(page, { artistId: mine.artist.id, ...fields })
  const collectives = await addOwnApplication(page, { collectiveId: mine.collective.id, ...fields })
  await mockEvents(page)
  const name = `E2E ${unique}`
  const sets = page.getByRole('table', { name: 'Sets' })
  const sessionPicker = page.getByRole('combobox', { name: 'Session' })

  // A new session, with the artist's set, whose duration isn't known yet, under when they'd like to play.
  await page.goto(`/admin/candidatures/${artists}`)
  await page.getByRole('button', { name: 'créer un set' }).click()
  await sessionPicker.click()
  await page.getByRole('option', { name: 'nouvelle session' }).click()
  await page.getByRole('button', { name: 'créer le set' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Nouvelle session' })).toBeVisible()
  const reminder = page.getByRole('region', { name: 'Candidature' })
  await expect(reminder.getByRole('listitem')).toHaveText([longDay(day)])
  await expect(reminder).toContainText('20:00 à 23:00')
  await expect(durationOf(rowsOf(sets, mine.artist.name))).toHaveText('à déterminer')
  await expect(rowsOf(sets, mine.artist.name)).toContainText('DJ, autre : Synthé')
  await timeInput(page, 'Début', 'date').fill(day)
  await timeInput(page, 'Début', 'heure').fill('20:00')
  await timeInput(page, 'Fin', 'heure').fill('23:00')
  await page.getByRole('radio', { name: 'Autre' }).check()
  await page.getByLabel('Nom').fill(name)
  await page.getByRole('button', { name: 'ajouter la session' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  const sessionPage = new URL(page.url()).pathname
  await expect(durationOf(rowsOf(sets, mine.artist.name))).toHaveText('à déterminer')
  await expect(sets.getByRole('link', { name: /^Candidature reçue le / })).toHaveAttribute('href', `/admin/candidatures/${artists}`)

  // Another one, in that session, which is on the day the artist would like to play.
  await page.goto(`/admin/candidatures/${artists}`)
  await page.getByRole('button', { name: 'créer un set' }).click()
  await sessionPicker.fill(unique)
  const option = page.getByRole('option', { name: new RegExp(`^${name},`) })
  await expect(option).toContainText('20 h – 23 h · date souhaitée')
  await option.click()
  await page.getByRole('button', { name: 'créer le set' }).click()
  await expect(page).toHaveURL(`${sessionPage}?application=${artists}`)
  const newSet = page.getByRole('region', { name: 'Nouveau set' })
  await expect(newSet.getByRole('heading', { name: 'Nouveau set' })).toBeFocused()
  await expect(newSet.getByRole('heading', { name: 'Nouveau set' })).toBeInViewport()
  await expect(newSet.getByRole('combobox', { name: 'Candidature' })).toHaveValue(new RegExp(`^${mine.artist.name}, reçue le `))
  // An hour, after the first one, whose duration doesn't count.
  await expect(newSet.getByRole('group', { name: 'Durée' }).getByLabel('heures')).toHaveValue('1')
  await newSet.getByRole('button', { name: 'ajouter le set' }).click()
  await expect(page).toHaveURL(sessionPage)
  await expect(sets.getByRole('row')).toHaveCount(3)
  const durations = sets.getByRole('row').locator('td:nth-child(2)')
  await expect(durations).toHaveText(['à déterminer', '1 h'])
  // The first one moved down with the keyboard, where it shows as soon as it's dropped, while that's saved: the server's
  // answer is held back meanwhile. Its handle, greyed out until then, keeps the focus throughout, though the row is put
  // back in the page.
  const handleOf = (row: number) => sets.getByRole('row').nth(row).getByRole('button', { name: /^réordonner : / })
  const answerMove = await holdBack(page, '**/api/admin/sets/*/position')
  await moveWithKeyboard(page, handleOf(1), 1)
  await expect(durations).toHaveText(['1 h', 'à déterminer'])
  await expect(handleOf(2)).toHaveAttribute('aria-disabled', 'true')
  await expect(handleOf(2)).toBeFocused()
  await answerMove()
  await expect(handleOf(2)).not.toHaveAttribute('aria-disabled')
  await expect(handleOf(2)).toBeFocused()
  // Which the session keeps, and which the page doesn't open again.
  await page.reload()
  await expect(sets.getByRole('row')).toHaveCount(3)
  await expect(durations).toHaveText(['1 h', 'à déterminer'])
  await expect(page.getByRole('heading', { name: 'Nouveau set' })).toHaveCount(0)
  // Moved back up by dragging it, with the mouse, or with a finger on touch screens, with a single request.
  const moves: unknown[] = []
  const recordMove = (request: Request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/position')) moves.push(request.postDataJSON())
  }
  page.on('request', recordMove)
  await drag(page, handleOf(2), sets.getByRole('row').nth(1), { touch: hasTouch })
  await expect(durations).toHaveText(['à déterminer', '1 h'])
  await expect(handleOf(1)).not.toHaveAttribute('aria-disabled')
  page.off('request', recordMove)
  expect(moves).toEqual([{ position: 0 }])
  await page.goto(`/admin/candidatures/${artists}`)
  await expect(page.getByRole('table', { name: 'Sets' }).getByRole('row')).toHaveCount(3)

  // The collective's takeover, from its application.
  await page.goto(`/admin/candidatures/${collectives}`)
  await page.getByRole('link', { name: 'créer une session' }).click()
  await expect(page.getByRole('combobox', { name: 'Collectif' })).toHaveValue(mine.collective.name)
  await expect(page.getByRole('combobox', { name: 'Candidature' })).toHaveValue(/^Reçue le /)
  await timeInput(page, 'Début', 'date').fill(otherDay)
  await timeInput(page, 'Début', 'heure').fill('20:00')
  await timeInput(page, 'Fin', 'heure').fill('23:00')
  await page.getByLabel('Nom').fill(`${name} TAKEOVER`)
  await page.getByRole('button', { name: 'ajouter la session' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `${name} TAKEOVER` })).toBeVisible()
  await expect(value(page, 'Candidature').getByRole('link')).toHaveAttribute('href', `/admin/candidatures/${collectives}`)
  const takeoverPage = new URL(page.url()).pathname

  for (const path of [sessionPage, takeoverPage]) expect((await page.request.delete(`/api${path}`)).ok()).toBe(true)
  await deleteOwn(page, mine)
})

// What a test's own entities are named after, two days for its sessions, from 2100 to 2899, in July, when clocks don't
// change, and a YouTube video id of 11 characters. They're derived from its unique name, so that other tests' sessions,
// even those left from a run that failed, are very unlikely to have them.
function own(testInfo: TestInfo) {
  const unique = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`
  const hash = createHash('sha256').update(unique).digest()
  const day = (offset: number) => `${2100 + (hash.readUInt32BE(offset) % 800)}-07-${String(1 + (hash.readUInt32BE(offset + 4) % 28)).padStart(2, '0')}`
  return { unique, day: day(0), otherDay: day(8), youtubeVideo: hash.toString('base64url').slice(0, 11) }
}

// Adds a collective of the test's own, with an artist of its own whom the server creates with it, through the API, with
// the session, once there's one, and returns their names and ids.
async function addOwnCollective(page: Page, unique: string) {
  await expect(adminMenu(page)).toBeVisible()
  const name = `Collectif e2e ${unique}`
  const artist = `Artiste e2e ${unique}`
  const collective = { name, members: [{ name: artist }], email: `e2e-${unique}@example.com` }
  const created = await page.request.post('/api/admin/collectives', { multipart: { collective: JSON.stringify(collective) } })
  expect(created.ok()).toBe(true)
  const { id, members } = (await created.json()).collective
  return { collective: { name, id: id as string }, artist: { name: artist, id: members[0].id as string } }
}

// Adds an application, as a DJ, for an artist or a collective of the test's own, through the API, with `fields` (its
// owner's id, its days, and those that change), and returns its id. It's deleted with its owner.
async function addOwnApplication(page: Page, fields: ({ artistId: string } | { collectiveId: string }) & { dates: string[] } & Record<string, unknown>) {
  const application = { timeSlots: [], performanceTypes: ['dj'], otherPerformanceType: '', details: '', ...fields }
  const created = await page.request.post('/api/admin/applications', { data: application })
  expect(created.ok()).toBe(true)
  return (await created.json()).application.id as string
}

async function deleteOwn(page: Page, { collective, artist }: Awaited<ReturnType<typeof addOwnCollective>>) {
  expect((await page.request.delete(`/api/admin/collectives/${collective.id}`)).ok()).toBe(true)
  expect((await page.request.delete(`/api/admin/artists/${artist.id}`)).ok()).toBe(true)
}

// Parking Radio's events on RA, as the server would read them, which the session form is given instead, so that it
// doesn't depend on RA. Their numbers are close to each other, as Parking Radio's often are.
async function mockEvents(page: Page) {
  const event = (id: string, start: string) => ({
    id,
    title: 'GUEST MIXES',
    category: 'other',
    start,
    end: null,
    venue: null,
    city: null,
    lineup: [],
    url: `https://ra.co/events/${id}`,
    flyer: null,
  })
  const events = { promoterUrl: 'https://ra.co/promoters/183980', upcoming: [], past: [event('1234568', '2026-10-17T21:00:00-04:00'), event('1234567', '2026-10-10T21:00:00-04:00')] }
  await page.route((url) => url.pathname === '/api/events', (route) => route.fulfill({ json: events }))
}

// E.g. "samedi 14 novembre 2026", for a day as "YYYY-MM-DD".
function longDay(day: string): string {
  return new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day))
}

test("a collective's takeover is added from its page, overnight, with its sets, then moved, one of its sets deleted, cancelled and deleted", async ({ page, isMobile, hasTouch }, testInfo) => {
  const { unique, day, otherDay, youtubeVideo } = own(testInfo)
  await logIn(page)
  const mine = await addOwnCollective(page, unique)
  const name = `E2E ${unique}`
  await mockEvents(page)

  // From the collective's page, as its takeover already, whose name it gives.
  await page.goto(`/admin/artistes/collectifs/${mine.collective.id}`)
  await page.getByRole('link', { name: 'nouvelle session' }).click()
  await expect(page.getByRole('heading', { name: 'Nouvelle session' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Takeover' })).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'Collectif' })).toHaveValue(mine.collective.name)
  await expect(page.getByLabel('Nom')).toHaveAttribute('placeholder', `${mine.collective.name.toUpperCase()} TAKEOVER`)
  await timeInput(page, 'Début', 'date').fill(day)
  await timeInput(page, 'Début', 'heure').fill('23:00')
  // The end's date starts as the start's.
  await expect(timeInput(page, 'Fin', 'date')).toHaveValue(day)
  await timeInput(page, 'Fin', 'heure').fill('01:30')
  await expect(page.getByRole('status')).toHaveCount(0)
  await timeInput(page, 'Fin', 'date').fill(addDays(day, 1))
  await expect(page.getByRole('status')).toHaveText('Dure 2 h 30.')
  await page.getByLabel('Nom').fill(name)
  // Its event on RA, found by its number, exactly.
  await page.getByRole('combobox', { name: 'Événement RA' }).fill('1234567')
  await expect(page.getByRole('option')).toHaveCount(1)
  await page.getByRole('option', { name: /^GUEST MIXES, sam\. 10 oct\. 2026/ }).click()
  await expect(page.getByRole('link', { name: 'https://ra.co/events/1234567' })).toBeVisible()

  // Its sets, listed in its form until it's added, each for an hour, of the 2 h 30 the session lasts, unless it's changed,
  // the second with the same video. Both are called by their performer, the same one, so they're told apart by their rows.
  const listed = page.getByRole('table', { name: 'Sets' })
  const newSet = page.getByRole('region', { name: 'Nouveau set' })
  const hours = (form: Locator) => form.getByRole('group', { name: 'Durée' }).getByLabel('heures')
  await page.getByRole('button', { name: 'ajouter un set' }).click()
  await expect(hours(newSet)).toHaveValue('1')
  await newSet.getByRole('combobox', { name: 'Ajouter un artiste' }).fill(mine.artist.name)
  await newSet.getByRole('option', { name: mine.artist.name }).click()
  await newSet.getByLabel('DJ').check()
  await newSet.getByLabel('YouTube').fill(`https://youtu.be/${youtubeVideo}`)
  // SoundCloud can't be asked, since the SoundCloud app's credentials aren't entered in the tests' server.
  await newSet.getByLabel('SoundCloud').fill('https://soundcloud.com/parkingdotradio/e2e')
  await newSet.getByRole('button', { name: 'ajouter le set' }).click()
  await expect(listed.getByRole('row')).toHaveCount(2)
  await page.getByRole('button', { name: 'ajouter un set' }).click()
  await expect(hours(newSet)).toHaveValue('1')
  await newSet.getByRole('combobox', { name: 'Ajouter un artiste' }).fill(mine.artist.name)
  await newSet.getByRole('option', { name: mine.artist.name }).click()
  await newSet.getByLabel('YouTube').fill(youtubeVideo)
  await newSet.getByRole('button', { name: 'ajouter le set' }).click()
  await expect(listed.getByRole('row')).toHaveCount(3)
  // The first one moved after the second one, which has no SoundCloud link, with the keyboard, its handle keeping the
  // focus, though the browser loses it as the row is put back in the page. They're told apart by what the first one's
  // performer does, in the cell after the handle's, the duration's and the performers'.
  const performance = (row: number) => listed.getByRole('row').nth(row).getByRole('cell').nth(3)
  await expect(performance(1)).toHaveText('DJ')
  // On touch screens, the handles, big enough for a finger, stay within their rows, so that they never overlap, and are
  // about as high as the rows' first lines.
  if (hasTouch) {
    const handles = await listed.locator('tbody tr').evaluateAll((rows) =>
      rows.map((row) => {
        const handle = row.querySelector('.admin-handle')!.getBoundingClientRect()
        const { top, bottom } = row.getBoundingClientRect()
        const text = document.createRange()
        text.selectNodeContents(row.querySelectorAll('td')[1])
        const line = text.getClientRects()[0]
        const offset = Math.abs((handle.top + handle.bottom) / 2 - (line.top + line.bottom) / 2)
        return { within: handle.top >= top - 0.5 && handle.bottom <= bottom + 0.5, offset }
      }),
    )
    for (const { within, offset } of handles) {
      expect(within).toBe(true)
      expect(offset).toBeLessThan(6)
    }
  }
  await moveWithKeyboard(page, listed.getByRole('row').nth(1).getByRole('button', { name: /^réordonner : / }), 1)
  await expect(performance(2)).toHaveText('DJ')
  await expect(listed.getByRole('row').nth(2).getByRole('button', { name: /^réordonner : / })).toBeFocused()

  // The server refuses the set it can't add, which the error names, and nothing is saved until it can add them all.
  await page.getByRole('button', { name: 'ajouter la session' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    `Le set de ${mine.artist.name} n'a pas pu être ajouté : The credentials of the SoundCloud app have not been entered yet`,
  )
  await listed.getByRole('row').nth(2).getByRole('button', { name: /^modifier : / }).click()
  const listedSet = page.getByRole('region', { name: `Set de ${mine.artist.name}` })
  await listedSet.getByLabel('SoundCloud').fill('')
  await listedSet.getByRole('button', { name: 'enregistrer' }).click()
  await page.getByRole('button', { name: 'ajouter la session' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    `Le set de ${mine.artist.name} n'a pas pu être ajouté : This YouTube video is another set's (Set de ${mine.artist.name})`,
  )
  await listed.getByRole('row').nth(1).getByRole('button', { name: /^retirer : / }).click()
  await expect(listed.getByRole('row')).toHaveCount(2)
  await page.getByRole('button', { name: 'ajouter la session' }).click()

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(value(page, 'Quand')).toHaveText(`${longDay(day)}, de 23 h à 1 h 30 le lendemain`)
  await expect(value(page, 'Événement RA').getByRole('link')).toHaveAttribute('href', 'https://ra.co/events/1234567')
  const sessionPage = new URL(page.url()).pathname
  const sets = page.getByRole('table', { name: 'Sets' })
  await expect(sets.getByRole('row')).toHaveCount(2)
  await expect(durationOf(sets.getByRole('row').nth(1))).toHaveText('1 h')
  await expect(sets.getByRole('row').nth(1)).toContainText('DJ')

  // The next one, added from its page, for an hour, after it, and the server refuses another set's video, naming that set.
  await page.getByRole('button', { name: 'ajouter un set' }).click()
  await expect(hours(newSet)).toHaveValue('1')
  await page.getByRole('combobox', { name: 'Ajouter un artiste' }).fill(mine.artist.name)
  await page.getByRole('option', { name: mine.artist.name }).click()
  await page.getByLabel('YouTube').fill(youtubeVideo)
  await page.getByRole('button', { name: 'ajouter le set' }).click()
  await expect(page.getByRole('alert')).toContainText(`(Set de ${mine.artist.name})`)
  await page.getByLabel('YouTube').fill('')
  await page.getByRole('button', { name: 'ajouter le set' }).click()
  await expect(sets.getByRole('row')).toHaveCount(3)
  await expect(durationOf(sets.getByRole('row').nth(2))).toHaveText('1 h')

  // The first one marked joué from its dropdown, which gets the focus back once it's saved: the server's answer is held
  // back until the browser has taken the focus away, while the dropdown is disabled.
  const first = sets.getByRole('row').nth(1).getByRole('combobox', { name: /^Statut : / })
  const answerStatus = await holdBack(page, '**/api/admin/sets/*/status')
  await first.focus()
  await first.selectOption({ label: 'joué' })
  await expect(first).toBeDisabled()
  await expect(first).not.toBeFocused()
  await answerStatus()
  await expect(first).toBeEnabled()
  await expect(first).toHaveValue('done')
  await expect(first).toBeFocused()
  // Picked up, its row keeps the color of its status, and is put back.
  const pickedUp = sets.getByRole('row').nth(1)
  await pickUp(page, pickedUp.getByRole('button', { name: /^réordonner : / }))
  await expect(pickedUp).toHaveAttribute('data-dragging')
  await expect(pickedUp).toHaveCSS('background-color', 'rgb(245, 245, 245)')
  await page.keyboard.press('Escape')
  await expect(pickedUp).not.toHaveAttribute('data-dragging')

  // Moved to another day, its end with it, its sets in their order.
  await page.getByRole('button', { name: 'modifier', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Événement RA' })).toHaveValue('GUEST MIXES, sam. 10 oct. 2026')
  await timeInput(page, 'Début', 'date').fill(otherDay)
  await expect(timeInput(page, 'Fin', 'date')).toHaveValue(addDays(otherDay, 1))
  await page.getByRole('button', { name: 'enregistrer' }).click()
  await expect(value(page, 'Quand')).toHaveText(`${longDay(otherDay)}, de 23 h à 1 h 30 le lendemain`)
  // Its event on RA kept.
  await expect(value(page, 'Événement RA').getByRole('link')).toHaveAttribute('href', 'https://ra.co/events/1234567')
  await expect(first).toHaveValue('done')

  // Announced, which says who announced it.
  const announcement = page.getByRole('group', { name: 'Annonce' })
  await announcement.getByRole('button', { name: 'annoncée', exact: true }).click()
  await expect(announcement.getByRole('button', { name: 'annoncée', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/^Annonce changée par /)).toBeVisible()

  // Listed in the section, found by its name, among the announced sessions, and on the artist's page.
  await adminMenu(page).getByRole('link', { name: 'sessions' }).click()
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill(unique)
  const row = page.getByRole('row').filter({ has: page.locator(`a[href="${sessionPage}"]`) })
  await expect(row).toContainText(mine.artist.name)
  await expect(row).toContainText('annoncée')
  const announced = page.getByRole('group', { name: 'Annonce' })
  await announced.getByRole('button', { name: /^non annoncées/ }).click()
  await expect(row).toHaveCount(0)
  await announced.getByRole('button', { name: /^annoncées/ }).click()
  await expect(row).toHaveCount(1)
  await page.goto(`/admin/artistes/${mine.artist.id}`)
  await expect(page.getByRole('table', { name: 'Sets' }).getByRole('row')).toHaveCount(3)

  // The second set deleted with the × of its row, once confirmed, which makes the session jouée, since its other set is
  // joué.
  await page.goto(sessionPage)
  page.once('dialog', (dialog) => dialog.accept())
  await sets.getByRole('row').nth(2).getByRole('button', { name: /^supprimer : / }).click()
  await expect(sets.getByRole('row')).toHaveCount(2)
  await expect(page.getByRole('group', { name: 'Statut', exact: true }).getByRole('button', { name: 'jouée' })).toHaveAttribute('aria-pressed', 'true')

  // Cancelled, with its set, once confirmed.
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('group', { name: 'Statut', exact: true }).getByRole('button', { name: 'annulée' }).click()
  await expect(page.getByRole('group', { name: 'Statut', exact: true }).getByRole('button', { name: 'annulée' })).toHaveAttribute('aria-pressed', 'true')
  await expect(statusOf(sets.getByRole('row').nth(1))).toHaveText('annulé')
  // It stays announced, until it's un-announced.
  await expect(announcement.getByRole('button', { name: 'annoncée', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Tapped on phones, since clicking leaves the mouse where it was, over what the page later scrolls under it.
  const unannounce = announcement.getByRole('button', { name: 'non annoncée' })
  await (isMobile ? unannounce.tap() : unannounce.click())
  await expect(announcement.getByRole('button', { name: 'non annoncée' })).toHaveAttribute('aria-pressed', 'true')
  // Its set can't be un-cancelled, which the page says above the sets, its status written out, and sets can't be added
  // to it, which the button says, greyed out.
  await expect(page.getByText('La session est annulée\u00a0: on ne peut pas rétablir ses sets.')).toBeVisible()
  await expect(sets.getByRole('combobox')).toHaveCount(0)
  const add = page.getByRole('button', { name: 'ajouter un set' })
  await expect(add).toHaveAttribute('aria-disabled', 'true')
  // By force, since Playwright waits for an aria-disabled button to be enabled before clicking or tapping it. Tapping it
  // shows its tooltip, while clicking it with the mouse only shows it while the mouse hovers it.
  const tooltip = page.getByRole('tooltip').filter({ visible: true })
  if (isMobile) {
    await add.tap({ force: true })
    await expect(tooltip).toHaveText('La session est annulée\u00a0: on ne peut pas lui ajouter de set.')
  } else {
    await add.click({ force: true })
    await expect(tooltip).toHaveText('La session est annulée\u00a0: on ne peut pas lui ajouter de set.')
    await page.mouse.move(0, 0)
    await expect(tooltip).toHaveCount(0)
  }
  await expect(page.getByRole('heading', { name: 'Nouveau set' })).toHaveCount(0)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'supprimer la session' }).click()
  await expect(page).toHaveURL('/admin/sessions')
  await expect(page.locator(`a[href="${sessionPage}"]`)).toHaveCount(0)

  await deleteOwn(page, mine)
})

test("a set is moved to another session from its row, which says where it went, and can't be moved to a cancelled one", async ({ page }, testInfo) => {
  const { unique, day, otherDay } = own(testInfo)
  await logIn(page)
  await expect(adminMenu(page)).toBeVisible()
  const performer = `Artiste e2e ${unique}`
  const artist = await page.request.post('/api/admin/artists', { multipart: { artist: JSON.stringify({ name: performer }) } })
  expect(artist.ok()).toBe(true)
  const artistId: string = (await artist.json()).artist.id
  const set = { performers: [{ id: artistId }], durationMinutes: 60, performanceTypes: ['dj'], otherPerformanceType: '', genres: [], soundcloudTrack: null, youtubeVideo: null, application: null }
  // Two sessions of the test's own, on days of their own, the first with two sets, the second, of an hour, with one.
  const addSession = async (name: string, start: string, durationMinutes: number, sets: object[]) => {
    const fields = { start, durationMinutes, type: 'other', takeover: null, application: null, name, raEvent: null, description: '', sets }
    const created = await page.request.post('/api/admin/sessions', { multipart: { session: JSON.stringify(fields) } })
    expect(created.ok()).toBe(true)
    return (await created.json()).session as { id: string; sets: { id: string }[] }
  }
  const leaving = await addSession(`E2E ${unique} DÉPART`, `${day}T20:00-04:00`, 120, [set, set])
  const joined = await addSession(`E2E ${unique} ARRIVÉE`, `${otherDay}T21:00-04:00`, 60, [set])
  expect((await page.request.put(`/api/admin/sets/${leaving.sets[0].id}/status`, { data: { status: 'done' } })).ok()).toBe(true)

  // The second set, moved to the other session, which makes the first one jouée, since its other set is joué.
  await page.goto(`/admin/sessions/${leaving.id}`)
  const sets = page.getByRole('table', { name: 'Sets' })
  await sets.getByRole('row').nth(2).getByRole('button', { name: /^déplacer : / }).click()
  await expect(page.getByRole('heading', { level: 3, name: `Déplacer le set de ${performer}` })).toBeVisible()
  const picker = page.getByRole('combobox', { name: 'Session' })
  await expect(picker).toBeFocused()
  await picker.fill(`${unique} ARRIVÉE`)
  await page.getByRole('option', { name: new RegExp(`^E2E ${unique} ARRIVÉE, `) }).click()
  await page.getByRole('button', { name: 'déplacer', exact: true }).click()
  await expect(sets.getByRole('row')).toHaveCount(2)
  await expect(page.getByRole('group', { name: 'Statut', exact: true }).getByRole('button', { name: 'jouée' })).toHaveAttribute('aria-pressed', 'true')
  const notice = page.getByText(/a été déplacé dans la session/)
  await expect(notice).toContainText(`Le set de ${performer} a été déplacé dans la session E2E ${unique} ARRIVÉE, `)

  // There, after its set, whose page says that its sets now add up to more than it.
  await notice.getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1, name: `E2E ${unique} ARRIVÉE` })).toBeVisible()
  await expect(sets.getByRole('row')).toHaveCount(3)
  await expect(page.getByText(/^\u26a0\ufe0e Les sets durent 2 h, plus que la session \(1 h\)\.$/)).toBeVisible()

  // Once that session is cancelled, the set that's left can't be moved there, which its button says.
  expect((await page.request.put(`/api/admin/sessions/${joined.id}/status`, { data: { status: 'cancelled' } })).ok()).toBe(true)
  await page.goto(`/admin/sessions/${leaving.id}`)
  await sets.getByRole('button', { name: /^déplacer : / }).click()
  await picker.fill(`${unique} ARRIVÉE`)
  await page.getByRole('option', { name: new RegExp(`^E2E ${unique} ARRIVÉE, .* · annulée$`) }).click()
  const move = page.getByRole('button', { name: 'déplacer', exact: true })
  await expect(move).toHaveAttribute('aria-disabled', 'true')
  await expect(move).toHaveAccessibleDescription('La session est annulée\u00a0: on ne peut pas y déplacer le set.')
  await page.getByRole('button', { name: 'annuler' }).click()
  await expect(sets.getByRole('button', { name: /^déplacer : / })).toBeFocused()

  for (const id of [leaving.id, joined.id]) expect((await page.request.delete(`/api/admin/sessions/${id}`)).ok()).toBe(true)
  expect((await page.request.delete(`/api/admin/artists/${artistId}`)).ok()).toBe(true)
})

test.describe('in another time zone', () => {
  test.use({ timezoneId: 'Asia/Tokyo' })

  test("a session's times are entered and shown in Québec time", async ({ page }, testInfo) => {
    const { day } = own(testInfo)
    await logIn(page, { at: '/admin/sessions/nouvelle' })
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('Asia/Tokyo')

    await timeInput(page, 'Début', 'date').fill(day)
    await timeInput(page, 'Début', 'heure').fill('21:00')
    await timeInput(page, 'Fin', 'heure').fill('22:00')
    await page.getByRole('radio', { name: 'Guest mixes' }).check()
    await page.getByRole('button', { name: 'ajouter la session' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'GUEST MIXES' })).toBeVisible()
    await expect(value(page, 'Quand')).toHaveText(`${longDay(day)}, de 21 h à 22 h`)
    const id = new URL(page.url()).pathname.split('/').pop()
    const { session } = await (await page.request.get(`/api/admin/sessions/${id}`)).json()
    // The API gives it in Québec time too, with its offset.
    expect(session.start).toMatch(new RegExp(`^${day}T21:00:00[+-]\\d{2}:\\d{2}$`))
    expect(Date.parse(session.start)).toBe(quebecInstant(day, '21:00')!.getTime())

    expect((await page.request.delete(`/api/admin/sessions/${id}`)).ok()).toBe(true)
  })
})

test("a session's event on RA is published from the panel under its « Événement RA », then saved once the bookmarklet leads back to it", async ({ page }, testInfo) => {
  const { unique, day } = own(testInfo)
  await logIn(page)
  await expect(adminMenu(page)).toBeVisible()
  const fields = { start: `${day}T21:00-04:00`, durationMinutes: 120, type: 'other', takeover: null, application: null, name: `E2E ${unique}`, raEvent: null, description: 'Une soirée.' }
  const created = await page.request.post('/api/admin/sessions', { multipart: { session: JSON.stringify(fields) } })
  expect(created.ok()).toBe(true)
  const id: string = (await created.json()).session.id
  await mockEvents(page)

  // The server under test isn't production, so publishing warns that the event will be created on RA all the same.
  const createButton = () => value(page, 'Événement RA').getByRole('button', { name: 'créer' })
  await page.goto(`/admin/sessions/${id}`)
  await createButton().click()
  await expect(page.getByText("Attention : l'événement sera vraiment créé sur RA, à partir d'une session de DEV.")).toBeVisible()
  await expect(raValue(page, 'Line-up').locator('span')).toHaveText(`E2E ${unique}`)
  // RA's form opens in a new tab, with the event in its fragment, which these tests only read, since they never reach RA.
  await page.evaluate(() => {
    window.open = (url) => {
      document.body.dataset.opened = String(url)
      return null
    }
  })
  await page.getByRole('button', { name: 'Publier sur RA' }).click()
  const opened = new URL((await page.locator('body').getAttribute('data-opened'))!)
  expect(opened.origin + opened.pathname).toBe('https://ra.co/pro/event/create')
  const sent = JSON.parse(decodeURIComponent(opened.hash.slice('#parking-radio='.length)))
  expect(sent).toMatchObject({ site: new URL(page.url()).origin, environment: 'development', session: id, event: { title: `E2E ${unique}`, start: `${day}T21:00:00-04:00`, content: 'Une soirée.' } })

  // The bookmarklet leads back with the event it created, which is only saved with « enregistrer ».
  await page.goto(`/admin/sessions/${id}?raEvent=2400123`)
  await expect(page.getByText("L'événement RA n° 2400123 vient d'être créé sur RA : enregistrez-le dans la session.")).toBeVisible()
  await expect(page.getByRole('textbox', { name: "Lien de l'événement RA" })).toHaveValue('https://ra.co/events/2400123')
  await page.getByRole('button', { name: 'enregistrer' }).click()
  await expect(page.getByRole('textbox', { name: "Lien de l'événement RA" })).toHaveCount(0)
  await expect(value(page, 'Événement RA').getByRole('link')).toHaveAttribute('href', 'https://ra.co/events/2400123')
  await expect(page).toHaveURL(new RegExp(`/admin/sessions/${id}$`))
  await expect(createButton()).toHaveCount(0)

  expect((await page.request.delete(`/api/admin/sessions/${id}`)).ok()).toBe(true)
})
