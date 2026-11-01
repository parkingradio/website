import type { Locator, Page } from '@playwright/test'
import { TURNSTILE_TOKEN } from '../seed.ts'
import { test, expect, logIn, PHOTO } from './fixtures.ts'

// The "Appliquer" form: an artist applies alone, or a collective with its artists, each with their profile, and the team
// finds them on the admin pages.

const PHOTO_FILE = { name: 'photo.png', mimeType: 'image/png', buffer: PHOTO }

// Stands in for Turnstile's script, which the browser can't load from Cloudflare in these tests (see fixtures.ts): it
// vouches for the visitor right away, with Cloudflare's test token. The server still checks it with Cloudflare, whose
// test secret key, the server's in these tests, accepts it.
async function stubTurnstile(page: Page) {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile = { render: (element, options) => { setTimeout(() => options.callback('${TURNSTILE_TOKEN}')); return 'widget' }, remove: () => {} }`,
    }),
  )
}

// Fills an artist's profile in `scope`, which has a single one, and picks a photo. GeoNames can't be reached either, so
// the city is typed.
async function fillInProfile(page: Page, scope: Locator, name: string, soundcloud: string) {
  await scope.getByLabel("Nom d'artiste").fill(name)
  await scope.getByRole('combobox', { name: /^Pays/ }).fill('France')
  await page.getByRole('option', { name: /^France/ }).click()
  await scope.getByRole('combobox', { name: /^Ville/ }).fill('Lyon')
  await scope.getByRole('button', { name: 'house', exact: true }).click()
  await scope.getByLabel(/^Bio/).fill(`La bio de ${name}.`)
  await scope.getByLabel('SoundCloud').fill(`https://soundcloud.com/${soundcloud}`)
}

// Fills the profile of the nth artist of the collective, which is shown.
async function fillInMember(page: Page, n: number, name: string) {
  const profile = page.getByRole('group', { name: new RegExp(`^Artiste ${n}( —|$)`) })
  await fillInProfile(page, profile, name, `${n}-e2e`)
  return profile
}

test('an artist applies alone with their profile and photo, and the team finds them and their application', async ({ page }, testInfo) => {
  // Everything the test creates has a name and an email of its own, so that it finds its own artist.
  const unique = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`
  const name = `Artiste seul e2e ${unique}`
  await stubTurnstile(page)
  await page.goto('/appliquer')

  await page.getByRole('radio', { name: /^Artiste/ }).check()
  const form = page.locator('form')
  await fillInProfile(page, form, name, `seul-e2e-${unique}`)
  await form.locator('input[type=file]').setInputFiles(PHOTO_FILE)
  await page.getByRole('checkbox', { name: 'DJ', exact: true }).check()
  await page.getByLabel(/^Adresse e-mail/).fill(`e2e-${unique}@example.com`)
  await page.getByLabel(/^Numéro de téléphone/).fill('514 555-0198')
  await page.locator('.day:not(:disabled)').first().click()
  await page.getByRole('checkbox', { name: '18 h – 22 h' }).check()
  await page.getByRole('button', { name: 'envoyer ma candidature' }).click()
  await expect(page.getByRole('heading', { name: 'Candidature envoyée' })).toBeVisible()

  await logIn(page, { at: '/admin/artistes' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill(name)
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByText(/^artiste, inscrit par le formulaire/)).toBeVisible()
  await expect(page.getByRole('img', { name: `Photo de ${name}` })).toBeVisible()
  await expect(page.getByText(`La bio de ${name}.`)).toBeVisible()
  await expect(page.locator('dt', { hasText: /^Ville$/ }).locator('+ dd')).toHaveText('Lyon, France')

  // Their application, which is the only one.
  const rows = page.getByRole('table').getByRole('row')
  await expect(rows).toHaveCount(2)
  await rows.nth(1).getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: `Candidature de ${name}`, exact: true })).toBeVisible()
  await expect(page.locator('dt', { hasText: 'Dates souhaitées' }).locator('+ dd').getByRole('listitem')).toHaveCount(1)
  await expect(page.locator('dt', { hasText: 'Plages horaires' }).locator('+ dd')).toHaveText('18:00 à 22:00')
  await expect(page.locator('dt', { hasText: 'Type de prestation' }).locator('+ dd')).toHaveText('DJ')
})

test('a collective applies with its artists, their profiles and photos, and the team finds them', async ({ page }, testInfo) => {
  // Everything the test creates has a name and an email of its own, so that it finds its own collective.
  const unique = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`
  const name = `Collectif e2e ${unique}`
  const second = `Deux e2e ${unique}`
  await stubTurnstile(page)
  await page.goto('/appliquer')

  await page.getByRole('radio', { name: /^Collectif/ }).check()
  const collective = page.locator('section', { has: page.getByRole('heading', { name: 'Le collectif' }) })
  await collective.getByLabel('Nom du collectif').fill(name)
  await collective.locator('#artiste-pays').fill('Canada')
  await page.getByRole('option', { name: /^Canada/ }).click()
  await collective.locator('#artiste-ville').fill('Montréal')
  await fillInMember(page, 1, `Une e2e ${unique}`)
  await page.getByRole('button', { name: '+ ajouter un artiste (1 / 4)' }).click()
  const profile = await fillInMember(page, 2, second)
  await profile.locator('input[type=file]').setInputFiles(PHOTO_FILE)

  const presentation = page.locator('section', { has: page.getByRole('heading', { name: 'Présentation' }) })
  await presentation.locator('input[type=file]').setInputFiles(PHOTO_FILE)
  await presentation.getByLabel(/^Description/).fill('Un collectif de test.')
  await presentation.getByLabel('Instagram').fill('collectif.e2e')
  await page.getByRole('checkbox', { name: 'DJ', exact: true }).check()
  await page.getByLabel(/^Adresse e-mail/).fill(`e2e-${unique}@example.com`)
  await page.getByLabel(/^Numéro de téléphone/).fill('514 555-0199')
  await page.locator('.day:not(:disabled)').first().click()
  await page.getByRole('button', { name: 'envoyer ma candidature' }).click()
  await expect(page.getByRole('heading', { name: 'Candidature envoyée' })).toBeVisible()

  await logIn(page, { at: '/admin/artistes' })
  await page.getByRole('searchbox', { name: 'Rechercher' }).fill(name)
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByText(/^collectif, inscrit par le formulaire/)).toBeVisible()
  await expect(page.getByRole('img', { name: `Photo de ${name}` })).toBeVisible()
  const members = page.locator('dt', { hasText: 'Artistes du collectif' }).locator('+ dd').getByRole('link')
  await expect(members).toHaveText([`Une e2e ${unique}`, second])
  await members.getByText(second).click()
  await expect(page.getByRole('heading', { name: second, exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: `Photo de ${second}` })).toBeVisible()
  await expect(page.getByText(`La bio de ${second}.`)).toBeVisible()
})
