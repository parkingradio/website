import type { Locator, Page } from '@playwright/test'
import { centerOf, drag, swipe } from './drag.ts'
import { test, expect, admin, adminMenu, logIn, NARROW, scrollsSideways, submitLogin, PHOTO } from './fixtures.ts'

// The admin pages: logging in and out, managing artists and collectives, which goes through every layer: a form with a
// photo, the database, the private bucket and back, then removing the photo, searching the seeded artists and
// collectives, and the applications of collectives.

test.describe('logging in', () => {
  test('a wrong password is refused, and the login form stays', async ({ page }) => {
    await logIn(page, { password: 'not-the-password' })
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(adminMenu(page)).toBeHidden()
  })

  test('the session lasts until logging out', async ({ page }) => {
    await logIn(page)
    // `/admin` shows its first section.
    await expect(page).toHaveURL('/admin/calendrier')
    await expect(adminMenu(page).getByText(admin.email)).toBeVisible()

    await page.reload()
    await expect(adminMenu(page)).toBeVisible()

    await adminMenu(page).getByRole('button', { name: 'se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  })

  test('logging in shows the page that was asked for', async ({ page }) => {
    await logIn(page, { at: '/admin/artistes' })
    await expect(page.getByRole('heading', { name: 'Artistes' })).toBeVisible()
    await expect(page).toHaveURL('/admin/artistes')
  })

  test('a session that ends while a page is open leads back to the login form, then to the page', async ({ page }) => {
    await logIn(page, { at: '/admin/artistes' })
    await expect(page.getByRole('heading', { name: 'Artistes' })).toBeVisible()

    // Logging out in another tab ends the session of both.
    const other = await page.context().newPage()
    await other.goto('/admin')
    await adminMenu(other).getByRole('button', { name: 'se déconnecter' }).click()
    await expect(other.getByRole('heading', { name: 'Connexion' })).toBeVisible()

    await adminMenu(page).getByRole('link', { name: 'candidatures' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page.getByText('La session a pris fin. Connectez-vous à nouveau pour continuer.')).toBeVisible()
    await expect(page).toHaveURL('/admin/candidatures')

    await submitLogin(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Candidatures' })).toBeVisible()
    await expect(page).toHaveURL('/admin/candidatures')
    // Once the applications and the artists are loaded.
    await expect(page.getByRole('group', { name: 'Statut' })).toBeVisible()
    await expect(page.getByRole('alert')).toBeHidden()
  })
})

test('an artist is added, shown, has their photo removed, and is deleted', async ({ page }, testInfo) => {
  // Tests run side by side on the same database, where artists' emails must be unique. Their names are too, so that the
  // test finds its own artist.
  const unique = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`
  const name = `Artiste e2e ${unique}`

  await logIn(page)
  await adminMenu(page).getByRole('link', { name: 'artistes' }).click()
  await page.getByRole('link', { name: 'ajouter un artiste' }).click()
  await expect(page.getByRole('heading', { name: 'Nouvel artiste' })).toBeVisible()

  await page.getByLabel("Nom d'artiste").fill(name)
  await page.getByLabel('Ville').fill('Montréal')
  await page.getByRole('group', { name: 'Tous les genres' }).getByRole('button', { name: 'house', exact: true }).click()
  await page.getByLabel('Bio', { exact: true }).fill('Une bio.')
  await page.getByLabel('SoundCloud').fill(`e2e-${unique}`)
  await page.getByLabel('Adresse e-mail').fill(`e2e-${unique}@example.com`)
  await page.getByLabel('Téléphone').fill('514 555 0100')
  await page.getByLabel('Photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PHOTO })
  await page.getByRole('button', { name: "ajouter l'artiste" }).click()

  // Their page, with their photo as the server keeps it.
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const photo = page.getByRole('img', { name: `Photo de ${name}`, exact: true })
  await expect(photo).toBeVisible()
  await expect(photo).toHaveJSProperty('naturalWidth', 1)
  await expect(page.getByText('Montréal')).toBeVisible()

  // The form shows the photo, with an × that removes it once the artist is saved.
  await page.getByRole('button', { name: 'modifier' }).click()
  await page.getByRole('button', { name: 'retirer la photo', exact: true }).click()
  await page.getByRole('button', { name: 'enregistrer' }).click()
  await expect(page.getByText('Pas de photo')).toBeVisible()

  // It's still gone once the artist is loaded again.
  await page.getByRole('link', { name: '← tous les artistes' }).click()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByText('Pas de photo')).toBeVisible()
  await expect(photo).toBeHidden()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: "supprimer l'artiste" }).click()
  await expect(page).toHaveURL('/admin/artistes')
  // Once the list is loaded, rather than while it's loading.
  await expect(page.getByRole('table').or(page.getByText('Aucun artiste ni collectif.'))).toBeVisible()
  await expect(page.getByRole('link', { name, exact: true })).toBeHidden()
})

// With the seeded artists, of whom two have close names.
test('artists are searched whatever the accents and a typo, and the search is still there when coming back', async ({ page }) => {
  const searched = page.getByRole('link', { name: 'Clémentine Brûlée', exact: true })
  const other = page.getByRole('link', { name: 'Clément Brûlé', exact: true })
  await logIn(page, { at: '/admin/artistes' })
  await expect(other).toBeVisible()

  const search = page.getByRole('searchbox', { name: 'Rechercher' })
  await search.fill('clementime brulee')
  await expect(searched).toBeVisible()
  await expect(other).toBeHidden()

  await searched.click()
  await expect(page.getByRole('heading', { name: 'Clémentine Brûlée', exact: true })).toBeVisible()
  await page.goBack()
  await expect(search).toHaveValue('clementime brulee')
  await expect(searched).toBeVisible()
  await expect(other).toBeHidden()
})

// With the seeded collectives (see seed-data.ts): Onde Commune, whose genres are its artists', and Les Nuits Basses, one of
// whose artists the server created with it.
test('collectives are listed and searched with the artists, and lead to their artists, who lead back to them', async ({ page }) => {
  await logIn(page, { at: '/admin/artistes' })
  const onde = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Onde Commune', exact: true }) })
  // Each artist's first genre, then each one's second, and so on.
  await expect(onde).toContainText('collectif')
  await expect(onde).toContainText('techno, deep house, afrobeat, acid, afro house, minimal, amapiano')

  // A collective is found by its artists' names, along with the artist.
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('sable mouvant')
  await expect(page.getByRole('link', { name: 'Sable Mouvant', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Les Nuits Basses', exact: true })).toBeVisible()
  await expect(onde).toBeHidden()

  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('')
  await onde.getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Onde Commune', exact: true })).toBeVisible()
  // At the server's 1280-pixel size, which doesn't enlarge it.
  await expect(page.getByRole('img', { name: 'Photo de Onde Commune', exact: true })).toHaveJSProperty('naturalWidth', 640)
  const members = page.locator('dt', { hasText: 'Artistes du collectif' }).locator('+ dd').getByRole('link')
  await expect(members).toHaveText(['Clémentine Brûlée', 'Fréquence Boréale', 'Kwame Asante'])

  await members.getByText('Kwame Asante').click()
  await expect(page.getByRole('heading', { name: 'Kwame Asante', exact: true })).toBeVisible()
  const collectives = page.locator('dt', { hasText: 'Collectifs' }).locator('+ dd').getByRole('link')
  await expect(collectives).toHaveText(['Les Nuits Basses', 'Onde Commune'])
})

// With the seeded applications of Onde Commune, of Les Nuits Basses and of Kwame Asante, who's in both, and whom searching
// for finds them (see seed-data.ts).
test("a collective's application is listed with its city and its artists' genres, and on its page, which goes through the list and leads to another one", async ({
  page,
}) => {
  await logIn(page, { at: '/admin/candidatures?status=all' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('kwame asante')
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Onde Commune', exact: true }) })
  await expect(row).toContainText('Onde Commune (collectif)')
  await expect(row).toContainText('Montréal, Canada')
  await expect(row).toContainText('techno, deep house, afrobeat, acid, afro house, minimal, amapiano')
  await expect(row).toContainText('DJ, autre : B2B2B')

  await row.getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: 'Candidature de Onde Commune', exact: true })).toBeVisible()
  await expect(page.getByText('Nous aimerions jouer toute la soirée, chacun son tour.')).toBeVisible()
  const genres = page.locator('dt', { hasText: 'Genres de ses artistes' }).locator('+ dd')
  await expect(genres).toHaveText('techno, deep house, afrobeat, acid, afro house, minimal, amapiano')

  // The most recently received first: Kwame's own, sent through the form as it was seeded, Les Nuits Basses', then this one.
  await expect(page.getByText('3 / 3')).toBeVisible()
  await page.getByRole('link', { name: '← précédente' }).click()
  await expect(page.getByRole('heading', { name: 'Candidature de Les Nuits Basses', exact: true })).toBeVisible()
  await expect(page.getByText('2 / 3')).toBeVisible()
  await page.getByRole('link', { name: '← candidatures' }).click()
  await expect(page.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('kwame asante')
  await page.goBack()
  await page.getByRole('link', { name: 'suivante →' }).click()
  await expect(page.getByRole('heading', { name: 'Candidature de Onde Commune', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Onde Commune', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Onde Commune', exact: true })).toBeVisible()
  const applications = page.getByRole('table', { name: 'Candidatures' })
  await expect(applications.getByRole('row')).toHaveCount(2)
  await expect(applications).toContainText('DJ, autre : B2B2B')

  await page.getByRole('link', { name: 'nouvelle candidature' }).click()
  await expect(page.getByRole('heading', { name: 'Nouvelle candidature' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Artiste ou collectif' })).toHaveValue('Onde Commune')
})

// With Collectif Béton, which applied through the "Appliquer" form (see seed-data.ts), which created its artists, with
// their profiles and the photo of the second one.
test('a collective that applied through the form has its artists, with their profiles, and its applications, whose status links to its takeover', async ({
  page,
}) => {
  await logIn(page, { at: '/admin/artistes' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('collectif beton')
  await page.getByRole('link', { name: 'Collectif Béton', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Collectif Béton', exact: true })).toBeVisible()
  await expect(page.getByText(/^collectif, inscrit par le formulaire/)).toBeVisible()
  const members = page.locator('dt', { hasText: 'Artistes du collectif' }).locator('+ dd').getByRole('link')
  await expect(members).toHaveText(['Mathis', 'Rosalie', 'Kofi', 'Yasmine'])
  await expect(page.locator('dt', { hasText: 'Genres de ses artistes' }).locator('+ dd')).toHaveText('hard techno, EBM / industriel')
  // The one it sent, and the one an admin added.
  const applications = page.getByRole('table', { name: 'Candidatures' })
  await expect(applications.getByRole('row')).toHaveCount(3)
  // The one an admin added is done, through its takeover, BÉTON 140, which its status leads to.
  await applications.getByRole('link', { name: /^jouée : BÉTON 140, / }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'BÉTON 140' })).toBeVisible()
  await page.goBack()

  await members.getByText('Rosalie').click()
  await expect(page.getByRole('heading', { name: 'Rosalie', exact: true })).toBeVisible()
  await expect(page.getByText(/^artiste, inscrit par le formulaire/)).toBeVisible()
  await expect(page.getByText('EBM, industriel et basses saturées.')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Photo de Rosalie' })).toBeVisible()
})

test('a collective is added with an artist picked and one added by name, shown, changed, and deleted without its artists', async ({
  page,
  hasTouch,
}, testInfo) => {
  // Like the artist above, everything the test creates has a name of its own, and so do its artists, so that the test
  // doesn't change the seeded artists, and finds its own.
  const unique = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`
  const name = `Collectif e2e ${unique}`
  const known = `Membre connu e2e ${unique}`
  const added = `Membre ajouté e2e ${unique}`

  await logIn(page)
  // The test's own artist is added through the API, with the session, once there's one.
  await expect(adminMenu(page)).toBeVisible()
  const created = await page.request.post('/api/admin/artists', { multipart: { artist: JSON.stringify({ name: known }) } })
  expect(created.ok()).toBe(true)
  const knownId: string = (await created.json()).artist.id

  await adminMenu(page).getByRole('link', { name: 'artistes' }).click()
  await page.getByRole('link', { name: 'ajouter un collectif' }).click()
  await expect(page.getByRole('heading', { name: 'Nouveau collectif' })).toBeVisible()
  await page.getByLabel('Nom du collectif').fill(name)
  await page.getByRole('combobox', { name: 'Ajouter un artiste connu' }).fill(known)
  await page.getByRole('option', { name: known, exact: true }).click()
  // Once added, they're no longer offered, and leaving the field with their name typed, as the next step does, doesn't
  // add them again (see its artists below).
  await page.getByRole('combobox', { name: 'Ajouter un artiste connu' }).fill(known)
  await expect(page.getByRole('listbox')).toHaveText('aucun résultat')
  await page.getByLabel('Ajouter un nouvel artiste').fill(added)
  await page.getByRole('button', { name: 'ajouter ce nouvel artiste au collectif' }).click()
  // Dragged first by its handle, with a finger on touch screens, where swiping from an artist's name scrolls the page
  // instead.
  const membersList = page.getByRole('group', { name: 'Artistes du collectif' }).getByRole('listitem')
  await expect(membersList).toHaveText([new RegExp(known), new RegExp(added)])
  if (hasTouch) {
    await membersList.first().scrollIntoViewIfNeeded()
    const from = await centerOf(membersList.first().getByText(known))
    const scrolled = await page.evaluate(() => window.scrollY)
    await swipe(page, from, { x: from.x, y: from.y - 150 })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled)
    await expect(membersList).toHaveText([new RegExp(known), new RegExp(added)])
  }
  await drag(page, page.getByRole('button', { name: `réordonner ${added}` }), membersList.first(), { touch: hasTouch })
  await expect(membersList).toHaveText([new RegExp(added), new RegExp(known)])
  await page.getByLabel('Adresse e-mail du contact').fill(`e2e-${unique}@example.com`)
  await page.getByLabel('Photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PHOTO })
  await page.getByRole('button', { name: 'ajouter le collectif' }).click()

  // Its page, with its artists in order, the one added by name created by the server.
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: `Photo de ${name}`, exact: true })).toHaveJSProperty('naturalWidth', 1)
  const members = page.locator('dt', { hasText: 'Artistes du collectif' }).locator('+ dd').getByRole('link')
  await expect(members).toHaveText([added, known])
  const addedId = (await members.first().getAttribute('href'))!.split('/').pop()!
  const collectivePage = page.url()

  // Their pages lead back to it.
  await members.getByText(known).click()
  await expect(page.getByRole('heading', { name: known, exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('href', new URL(collectivePage).pathname)
  await page.goBack()

  await page.getByRole('button', { name: 'modifier' }).click()
  await page.getByRole('button', { name: `retirer ${added}` }).click()
  await page.getByRole('button', { name: 'enregistrer' }).click()
  await expect(members).toHaveText([known])

  // An application for it, from its page, which Candidatures lists until the collective is deleted.
  await page.getByRole('link', { name: 'nouvelle candidature' }).click()
  await expect(page.getByRole('combobox', { name: 'Artiste ou collectif' })).toHaveValue(name)
  await page.getByLabel('Date 1').fill('2027-01-15')
  await page.getByRole('button', { name: 'créer la candidature' }).click()
  await expect(page.getByRole('heading', { name: `Candidature de ${name}`, exact: true })).toBeVisible()
  const applicationPage = new URL(page.url()).pathname
  // Whatever the list's parameters, which its links keep.
  const listed = page.locator(`a[href^="${applicationPage}?"]`)
  await adminMenu(page).getByRole('link', { name: 'candidatures' }).click()
  const row = page.getByRole('row').filter({ has: listed })
  await expect(row).toContainText(`${name} (collectif)`)
  // Accepted from the list, which then no longer shows it, since it shows the new ones.
  await row.getByRole('combobox').selectOption({ label: 'retenue' })
  await expect(listed).toHaveCount(0)
  await page.goBack()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('table', { name: 'Candidatures' })).toContainText('15 janv. 2027')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'supprimer le collectif' }).click()
  await expect(page).toHaveURL('/admin/artistes')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('link', { name, exact: true })).toBeHidden()

  // Its application is gone with it.
  await page.goto('/admin/candidatures?status=all')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(listed).toHaveCount(0)

  // Its artists stay, out of it.
  await page.goto(`/admin/artistes/${addedId}`)
  await expect(page.getByRole('heading', { name: added, exact: true })).toBeVisible()
  await page.goto(`/admin/artistes/${knownId}`)
  await expect(page.getByRole('heading', { name: known, exact: true })).toBeVisible()
  await expect(page.getByText('Collectifs', { exact: true })).toBeHidden()

  for (const id of [knownId, addedId]) expect((await page.request.delete(`/api/admin/artists/${id}`)).ok()).toBe(true)
})

// With the stand-in for Discord, which accepts any credentials in the right format (see "The chat" in the README). Tests
// side by side save the same ones, so that each finds what it saved whatever the order.
test("Discord's credentials are verified, then saved, and the token is never shown again", async ({ page }) => {
  const token = 'MTA5ODc2NTQzMjEwOTg3NjU0Mw.Gabc12.e2e-secret'
  await logIn(page, { at: '/admin/configuration' })
  await expect(page.getByRole('heading', { level: 2, name: 'Chat' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Connexion Discord' })).toBeVisible()
  // Among the forms of the other services' credentials, which have the same buttons.
  const form = page.locator('form').filter({ has: page.getByRole('textbox', { name: 'ID du salon Discord' }) })
  const channelId = form.getByRole('textbox', { name: 'ID du salon Discord' })
  const botToken = form.getByLabel('Token du bot Discord')

  await channelId.fill('1234567890123456789')
  await botToken.fill(token)
  await form.getByRole('button', { name: 'vérifier' }).click()
  await expect(form.getByRole('status', { name: 'Identifiants acceptés par Discord' })).toBeVisible()
  await form.getByRole('button', { name: 'enregistrer' }).click()
  await expect(form.getByRole('status', { name: 'Identifiants enregistrés' })).toBeVisible()
  await expect(page.getByText(`Bot « stand-in » → #chat. Changés par ${admin.email}`)).toBeVisible()

  await page.reload()
  await expect(channelId).toHaveValue('1234567890123456789')
  await expect(botToken).toHaveValue('')
  await expect(page.getByText(`Bot « stand-in » → #chat. Changés par ${admin.email}`)).toBeVisible()
  await expect(page.locator('body')).not.toContainText(token)
})

// How many lines `element`'s text takes.
const linesOf = (element: Locator) =>
  element.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return new Set([...range.getClientRects()].map(({ top }) => Math.round(top))).size
  })

// Whether `element` is within the screen's width.
const withinScreen = (element: Locator) =>
  element.evaluate((element) => {
    const { left, right } = element.getBoundingClientRect()
    return left >= 0 && right <= document.documentElement.clientWidth
  })

// Configuration, with calendar feeds, which the server under test has none of, since it can't read a feed of the tests'
// own (see `withCalendar`): the page is given three, one read, one whose last read failed, with a long message, and one
// not read yet, which leaves the server as it is for other tests. Gives their table, and the line under the failed one.
async function withFeeds(page: Page) {
  const added = { createdBy: admin.email, createdAt: '2026-11-07T16:30:00-05:00', updatedBy: null, updatedAt: null }
  const read = '2026-11-22T12:15:00-05:00'
  const feeds = [
    { ...added, id: 'e2e-team', name: "Calendrier de l'équipe", kind: 'occupations', link: 'https://example.com/team.ics', readAt: read, error: null },
    {
      ...added,
      id: 'e2e-stays',
      name: 'Séjours',
      kind: 'holds',
      link: 'https://example.com/stays.ics',
      readAt: read,
      error: `The link can't be read: ${'its server fails (503), '.repeat(12)}and gives up`,
    },
    { ...added, id: 'e2e-rehearsals', name: 'Répétitions', kind: 'occupations', link: 'https://example.com/rehearsals.ics', readAt: null, error: null },
  ]
  await page.route('**/api/admin/calendar/feeds', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { ok: true, total: feeds.length, feeds } }) : route.fallback(),
  )
  await logIn(page, { at: '/admin/configuration' })
  const table = page.getByRole('table', { name: 'Calendriers externes' })
  const line = table.getByText(/^La dernière lecture a échoué/)
  await expect(line).toHaveText(/Dernière lecture réussie le 22 novembre 2026 à 12 h 15\.$/)
  return { table, line }
}

test("a calendar feed's failed read, and its form, don't widen the columns of Configuration's table", async ({ page, isMobile }) => {
  test.skip(isMobile, 'On phones, the columns are as narrow as they get, and the table scrolls sideways.')
  const { table } = await withFeeds(page)
  const lastRead = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: "Calendrier de l'équipe" }) }).getByRole('cell').nth(1)
  await expect(lastRead).toHaveText('22 novembre 2026 à 12 h 15')

  // Squeezed by a wider column, it would take several lines.
  expect(await linesOf(lastRead)).toBe(1)
  await page.getByRole('button', { name: 'modifier : Séjours' }).click()
  await expect(table.getByRole('textbox', { name: 'Nom' })).toBeFocused()
  expect(await linesOf(lastRead)).toBe(1)
  expect(await table.evaluate((table) => table.getBoundingClientRect().right <= table.parentElement!.getBoundingClientRect().right)).toBe(true)
})

test("Configuration's table of calendar feeds scrolls sideways on phones, with a failed read's line and the form within the screen", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Only phones are too narrow for the table.')
  await page.setViewportSize(NARROW)
  const { table, line } = await withFeeds(page)

  // The table is too wide for the screen, and scrolls sideways on its own, rather than the page, while what's across it
  // stays within the screen, wherever it's scrolled to.
  expect(await table.evaluate((table) => table.scrollWidth > table.clientWidth)).toBe(true)
  const fitInScreen = async (elements: Locator[]) => {
    // To its end, which the browser stops it at, then back to its start.
    for (const scrollLeft of [Number.MAX_SAFE_INTEGER, 0]) {
      await table.evaluate((table, scrollLeft) => (table.scrollLeft = scrollLeft), scrollLeft)
      expect(await Promise.all(elements.map(withinScreen))).toEqual(elements.map(() => true))
    }
    expect(await scrollsSideways(page)).toBe(false)
  }
  await fitInScreen([line])

  await page.getByRole('button', { name: 'modifier : Séjours' }).click()
  await expect(table.getByRole('textbox', { name: 'Nom' })).toBeFocused()
  await fitInScreen([line, table.getByRole('textbox', { name: 'Lien' }), table.getByRole('button', { name: 'annuler' })])
})
