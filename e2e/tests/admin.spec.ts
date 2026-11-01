import { test, expect, admin, adminMenu, logIn, submitLogin } from './fixtures.ts'

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

// The smallest PNG there is: one transparent pixel. The server tells a photo's type from its first bytes.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

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
  await expect(page.getByRole('img', { name: 'Photo de Onde Commune', exact: true })).toHaveJSProperty('naturalWidth', 64)
  const members = page.locator('dt', { hasText: 'Artistes du collectif' }).locator('+ dd').getByRole('link')
  await expect(members).toHaveText(['Clémentine Brûlée', 'Fréquence Boréale', 'Kwame Asante'])

  await members.getByText('Kwame Asante').click()
  await expect(page.getByRole('heading', { name: 'Kwame Asante', exact: true })).toBeVisible()
  const collectives = page.locator('dt', { hasText: 'Collectifs' }).locator('+ dd').getByRole('link')
  await expect(collectives).toHaveText(['Les Nuits Basses', 'Onde Commune'])
})

// With the seeded application of Onde Commune (see seed-data.ts).
test("a collective's application is listed with its city and its artists' genres, and on its page, which leads to another one", async ({
  page,
}) => {
  await logIn(page, { at: '/admin/candidatures' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill('onde commune')
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

  await page.getByRole('link', { name: 'Onde Commune', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Onde Commune', exact: true })).toBeVisible()
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2)
  await expect(page.getByRole('table')).toContainText('DJ, autre : B2B2B')

  await page.getByRole('link', { name: 'nouvelle candidature' }).click()
  await expect(page.getByRole('heading', { name: 'Nouvelle candidature' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Artiste ou collectif' })).toHaveValue('Onde Commune')
})

test('a collective is added with an artist picked and one added by name, shown, changed, and deleted without its artists', async ({
  page,
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
  const created = await page.request.post('/api/admin/artists', { multipart: { artist: JSON.stringify({ kind: 'artist', name: known }) } })
  expect(created.ok()).toBe(true)
  const knownId: string = (await created.json()).artist.id

  await adminMenu(page).getByRole('link', { name: 'artistes' }).click()
  await page.getByRole('link', { name: 'ajouter un collectif' }).click()
  await expect(page.getByRole('heading', { name: 'Nouveau collectif' })).toBeVisible()
  await page.getByLabel('Nom du collectif').fill(name)
  await page.getByRole('combobox', { name: 'Ajouter un artiste connu' }).fill(known)
  await page.getByRole('option', { name: known, exact: true }).click()
  await page.getByLabel('Ajouter un nouvel artiste').fill(added)
  await page.getByRole('button', { name: 'ajouter ce nouvel artiste au collectif' }).click()
  await page.getByRole('button', { name: `monter ${added}` }).click()
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
  const listed = page.locator(`a[href="${applicationPage}"]`)
  await adminMenu(page).getByRole('link', { name: 'candidatures' }).click()
  await expect(page.getByRole('row').filter({ has: listed })).toContainText(`${name} (collectif)`)
  await page.goBack()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('table')).toContainText('15 janv. 2027')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'supprimer le collectif' }).click()
  await expect(page).toHaveURL('/admin/artistes')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('link', { name, exact: true })).toBeHidden()

  // Its application is gone with it.
  await adminMenu(page).getByRole('link', { name: 'candidatures' }).click()
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
