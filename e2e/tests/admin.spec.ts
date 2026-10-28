import { test, expect, admin, adminMenu, logIn, submitLogin } from './fixtures.ts'

// The admin pages: logging in and out, managing artists, which goes through every layer: a form with a photo, the
// database, the private bucket and back, then removing the photo, and searching the seeded artists.

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
  await expect(page.getByRole('table').or(page.getByText('Aucun artiste.'))).toBeVisible()
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
