import { createHash } from 'node:crypto'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { addDays, quebecInstant } from '../../client/src/quebec-time.ts'
import { test, expect, adminMenu, logIn } from './fixtures.ts'

// The sessions and their sets: the seeded ones (see seed-data.ts), searched and listed on their artists' and collectives'
// pages, and sessions that tests add, change and delete, in Québec time, whatever the browser's time zone.

// The rows of a page or a table that have `text`, and what a page says of `label`.
const rowsOf = (within: Page | Locator, text: string) => within.getByRole('row').filter({ hasText: text })
const value = (page: Page, label: string) => page.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('+ dd')

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
  await expect(rowsOf(sets, 'Ondine')).toContainText('+0 h – +1 h')
  await expect(rowsOf(sets, 'Marée')).toContainText('+1 h – +2 h')
  await expect(rowsOf(sets, 'Écume')).toContainText('horaire à déterminer (1 h)')
  await page.goBack()

  // The cancelled one.
  await search.fill('sable mouvant')
  await page.getByRole('group', { name: 'Statut' }).getByRole('button', { name: /^annulées/ }).click()
  await expect(rowsOf(page, 'Les Nuits Basses')).toContainText('annulée')

  // Those of the other types, among which a synth meetup, which has no sets.
  await page.getByRole('group', { name: 'Statut' }).getByRole('button', { name: /^toutes/ }).click()
  await search.fill('synth meetup')
  await expect(rowsOf(page, 'SYNTH MEETUPS')).toContainText('Synth meetup')
  // Which has the description its type gives it, and a flyer.
  await rowsOf(page, 'SYNTH MEETUPS').getByRole('link').first().click()
  await expect(value(page, 'Description')).toContainText('Rencontres hebdomadaires de création sonore et audiovisuelle')
  await expect(value(page, 'Flyer').getByRole('img', { name: 'Flyer de SYNTH MEETUPS' })).toHaveJSProperty('naturalWidth', 64)
  // The form shows the same one, from the client's copy of the server's.
  const described = await value(page, 'Description').textContent()
  await page.getByRole('button', { name: 'modifier' }).click()
  await expect(page.getByLabel('Description')).toHaveAttribute('placeholder', described!)
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
  await expect(rowsOf(sets, 'Kwame Asante')).toContainText('22 h – 23 h')

  // His page lists his set, but not the session's other sets.
  await sets.getByRole('link', { name: 'Kwame Asante', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kwame Asante', exact: true })).toBeVisible()
  const his = page.getByRole('table', { name: 'Sets' })
  await expect(rowsOf(his, 'ONDE COMMUNE TAKEOVER')).toContainText('22 h – 23 h')
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

test('a seeded session marks its sets that overlap, and those that end after it, saying why in a tooltip', async ({ page, isMobile }) => {
  await logIn(page, { at: '/admin/sessions' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('soirée à revoir')
  await rowsOf(page, 'SOIRÉE À REVOIR').getByRole('link').first().click()
  // By their performers' links, since the tooltips of the rows' marks name the sets they overlap.
  const sets = page.getByRole('table', { name: 'Sets' })
  const mark = (artist: string) =>
    sets
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: artist, exact: true }) })
      .getByRole('button', { name: 'avertissement' })
  await expect(mark('Fréquence Boréale')).toHaveAccessibleDescription('Chevauche le set de Ondine, 20 h 30 – 21 h 30.')
  await expect(mark('Ondine')).toHaveAccessibleDescription('Chevauche le set de Fréquence Boréale, 20 h – 21 h.')
  await expect(mark('Jah Pierre')).toHaveAccessibleDescription('Finit après la session.')
  const tooltip = page.getByRole('tooltip').filter({ visible: true })
  await expect(tooltip).toHaveCount(0)
  // The mark doesn't make its row taller.
  const heights = await mark('Jah Pierre').evaluate((mark) => {
    const row = mark.closest('tr')!
    const marked = row.getBoundingClientRect().height
    mark.style.display = 'none'
    const unmarked = row.getBoundingClientRect().height
    mark.style.display = ''
    return { marked, unmarked }
  })
  expect(heights.marked).toBe(heights.unmarked)

  if (isMobile) {
    // Tapping the mark shows its tooltip, and tapping something else hides it.
    await mark('Jah Pierre').tap()
    await expect(tooltip).toHaveText('Finit après la session.')
    await page.getByRole('heading', { level: 1 }).tap()
    await expect(tooltip).toHaveCount(0)
    return
  }

  // Hovering the mark shows its tooltip, right under it, and so does the keyboard's focus, until Escape.
  await mark('Jah Pierre').hover()
  await expect(tooltip).toHaveText('Finit après la session.')
  const [markBox, tipBox] = [await mark('Jah Pierre').boundingBox(), await tooltip.boundingBox()]
  expect(Math.abs(tipBox!.y - (markBox!.y + markBox!.height))).toBeLessThan(1)
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)
  // Clicking it with the mouse doesn't keep it once the mouse is gone.
  await mark('Jah Pierre').click()
  await page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)
  await sets.getByRole('button', { name: /^supprimer : Set de Ondine/ }).focus()
  await page.keyboard.press('Tab')
  await expect(mark('Jah Pierre')).toBeFocused()
  await expect(tooltip).toHaveText('Finit après la session.')
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await expect(mark('Jah Pierre')).toBeFocused()
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

test("a collective's takeover is added from its page, until the next day, with its sets, then moved, one of its sets deleted, cancelled and deleted", async ({ page, isMobile }, testInfo) => {
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
  await page.getByLabel('Date', { exact: true }).fill(day)
  await page.getByLabel('Début').fill('23:00')
  await page.getByLabel('Fin').fill('01:30')
  await expect(page.getByRole('status')).toHaveText(`Dure 2 h 30, finit le lendemain, ${longDay(addDays(day, 1))}.`)
  await page.getByLabel('Nom').fill(name)
  // Its event on RA, found by its number, exactly.
  await page.getByRole('combobox', { name: 'Événement RA' }).fill('1234567')
  await expect(page.getByRole('option')).toHaveCount(1)
  await page.getByRole('option', { name: /^GUEST MIXES, sam\. 10 oct\. 2026/ }).click()
  await expect(page.getByRole('link', { name: 'https://ra.co/events/1234567' })).toBeVisible()
  await page.getByRole('button', { name: 'ajouter la session' }).click()

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(value(page, 'Quand')).toHaveText(`${longDay(day)}, de 23 h à 1 h 30 le lendemain`)
  await expect(value(page, 'Événement RA').getByRole('link')).toHaveAttribute('href', 'https://ra.co/events/1234567')
  const sessionPage = new URL(page.url()).pathname

  // A set at the session's start, for an hour, unless it's changed.
  await page.getByRole('button', { name: 'ajouter un set' }).click()
  await expect(page.getByLabel('Début')).toHaveValue('23:00')
  await expect(page.getByLabel('Fin')).toHaveValue('00:00')
  await page.getByRole('combobox', { name: 'Ajouter un artiste' }).fill(mine.artist.name)
  await page.getByRole('option', { name: mine.artist.name }).click()
  await page.getByLabel('DJ').check()
  await page.getByLabel('YouTube').fill(`https://youtu.be/${youtubeVideo}`)
  // SoundCloud can't be asked, since the SoundCloud app's credentials aren't entered in the tests' server.
  await page.getByLabel('SoundCloud').fill('https://soundcloud.com/parkingdotradio/e2e')
  await page.getByRole('button', { name: 'ajouter le set' }).click()
  await expect(page.getByRole('alert')).toContainText("Le set n'a pas pu être ajouté : The credentials of the SoundCloud app have not been entered yet")
  await page.getByLabel('SoundCloud').fill('')
  await page.getByRole('button', { name: 'ajouter le set' }).click()
  const sets = page.getByRole('table', { name: 'Sets' })
  await expect(sets.getByRole('row')).toHaveCount(2)
  await expect(sets.getByRole('row').nth(1)).toContainText('23 h – 0 h')
  await expect(sets.getByRole('row').nth(1)).toContainText('DJ')

  // The next one starts when it ends, and the server refuses another set's video, naming that set.
  await page.getByRole('button', { name: 'ajouter un set' }).click()
  await expect(page.getByLabel('Début')).toHaveValue('00:00')
  await expect(page.getByLabel('Fin')).toHaveValue('01:00')
  await page.getByRole('combobox', { name: 'Ajouter un artiste' }).fill(mine.artist.name)
  await page.getByRole('option', { name: mine.artist.name }).click()
  await page.getByLabel('YouTube').fill(youtubeVideo)
  await page.getByRole('button', { name: 'ajouter le set' }).click()
  await expect(page.getByRole('alert')).toContainText(`(Set de ${mine.artist.name}, 23 h – 0 h)`)
  await page.getByLabel('YouTube').fill('')
  await page.getByRole('button', { name: 'ajouter le set' }).click()
  await expect(sets.getByRole('row')).toHaveCount(3)
  await expect(sets.getByRole('row').nth(2)).toContainText('0 h – 1 h')

  const first = page.getByRole('group', { name: `Statut : Set de ${mine.artist.name}, 23 h – 0 h` })
  await first.getByRole('button', { name: 'joué' }).click()
  await expect(first.getByRole('button', { name: 'joué' })).toHaveAttribute('aria-pressed', 'true')

  // Moved to another day, with its sets.
  await page.getByRole('button', { name: 'modifier', exact: true }).click()
  await expect(page.getByText('Ses sets se déplacent avec elle.')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Événement RA' })).toHaveValue('GUEST MIXES, sam. 10 oct. 2026')
  await page.getByLabel('Date', { exact: true }).fill(otherDay)
  await page.getByRole('button', { name: 'enregistrer' }).click()
  await expect(value(page, 'Quand')).toHaveText(`${longDay(otherDay)}, de 23 h à 1 h 30 le lendemain`)
  // Its event on RA kept.
  await expect(value(page, 'Événement RA').getByRole('link')).toHaveAttribute('href', 'https://ra.co/events/1234567')
  await expect(sets.getByRole('row').nth(1)).toContainText('23 h – 0 h')

  // Listed in the section, found by its name, and on the artist's page.
  await adminMenu(page).getByRole('link', { name: 'sessions' }).click()
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill(unique)
  await expect(page.getByRole('row').filter({ has: page.locator(`a[href="${sessionPage}"]`) })).toContainText(mine.artist.name)
  await page.goto(`/admin/artistes/${mine.artist.id}`)
  await expect(page.getByRole('table', { name: 'Sets' }).getByRole('row')).toHaveCount(3)

  // The second set deleted with the × of its row, once confirmed.
  await page.goto(sessionPage)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: `supprimer : Set de ${mine.artist.name}, 0 h – 1 h` }).click()
  await expect(sets.getByRole('row')).toHaveCount(2)

  // Cancelled, with its set, once confirmed.
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('group', { name: 'Statut', exact: true }).getByRole('button', { name: 'annulée' }).click()
  await expect(page.getByRole('group', { name: 'Statut', exact: true }).getByRole('button', { name: 'annulée' })).toHaveAttribute('aria-pressed', 'true')
  await expect(sets.getByRole('button', { name: 'annulé', pressed: true })).toHaveCount(1)
  // Its set can't be un-cancelled, and sets can't be added to it, which their buttons say, greyed out.
  const planned = sets.getByRole('button', { name: 'planifié' })
  await expect(planned).toHaveAttribute('aria-disabled', 'true')
  await expect(planned).toHaveAccessibleDescription('La session est annulée\u00a0: on ne peut pas rétablir ses sets.')
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

test.describe('in another time zone', () => {
  test.use({ timezoneId: 'Asia/Tokyo' })

  test("a session's times are entered and shown in Québec time", async ({ page }, testInfo) => {
    const { day } = own(testInfo)
    await logIn(page, { at: '/admin/sessions/nouvelle' })
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('Asia/Tokyo')

    await page.getByLabel('Date', { exact: true }).fill(day)
    await page.getByLabel('Début').fill('21:00')
    await page.getByLabel('Fin').fill('22:00')
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
