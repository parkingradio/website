import { test, expect } from './fixtures.ts'
import type { Locator, Page } from '@playwright/test'

// The site's navigation: the bar at the top of every page, which phones get as a drawer, and unknown URLs.

// The pages the navigation bar links to, with what shows that each one is there: their heading, or what they embed. The
// home page comes last, since the tests start there. The merch link opens another site, so it isn't here.
//
// What the pages embed is blocked (see fixtures.ts), but the frame is still there. "Appliquer" embeds the Google Form
// while the flag of the new form is off, which it is until an admin turns it on.
const PAGES: { link: string; path: string; content: (page: Page) => Locator }[] = [
  { link: 'archives', path: '/archives', content: (page) => page.getByTitle('Parking Radio Archives') },
  { link: 'programmation', path: '/programmation', content: (page) => page.getByRole('heading', { name: 'Programmation' }) },
  { link: 'synth meetups', path: '/synth-meetups', content: (page) => page.getByRole('heading', { name: 'dates à venir' }) },
  { link: 'appliquer', path: '/appliquer', content: (page) => page.getByTitle('Parking Radio Appliquer') },
  { link: 'contribuer', path: '/contribuer', content: (page) => page.getByTitle('Parking Radio Contribuer') },
  { link: 'parking.radio', path: '/', content: (page) => page.getByTitle('Parking Radio', { exact: true }) },
]

// A link of the navigation bar. Not the logo, which links to the home page too, under the same name. On phones, the
// links are hidden while the drawer is closed, but they're still the bar's: clicking one still waits for it to show.
function navLink(page: Page, name: string) {
  return page.locator('#nav-links').getByRole('link', { name, exact: true, includeHidden: true })
}

// The button that opens and closes the drawer, on narrow screens.
function menuButton(page: Page) {
  return page.getByRole('button', { name: 'menu' })
}

// Clicks a link of the navigation bar, opening the drawer first if there's one.
async function follow(page: Page, hasDrawer: boolean, link: string) {
  if (hasDrawer) await menuButton(page).click()
  await navLink(page, link).click()
}

test('every page is reached from the navigation bar, without reloading the app', async ({ page, hasDrawer }) => {
  await page.goto('/')
  // Gone if the page reloads.
  await page.evaluate(() => Object.assign(window, { notReloaded: true }))

  for (const { link, path, content } of PAGES) {
    await follow(page, hasDrawer, link)
    await expect(page).toHaveURL(path)
    await expect(navLink(page, link)).toHaveAttribute('aria-current', 'page')
    await expect(content(page)).toBeVisible()
    if (hasDrawer) {
      await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false')
      await expect(navLink(page, link)).toBeHidden()
    }
  }

  expect(await page.evaluate(() => 'notReloaded' in window)).toBe(true)
})

test('the drawer closes with Escape', async ({ page, hasDrawer }) => {
  test.skip(!hasDrawer, 'there is no drawer on wide screens')
  await page.goto('/')
  const menu = menuButton(page)
  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(navLink(page, 'archives')).toBeVisible()
  // From inside the drawer, so that Escape has to give the focus back to the menu button.
  await navLink(page, 'archives').focus()
  await expect(navLink(page, 'archives')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(navLink(page, 'archives')).toBeHidden()
  await expect(menu).toBeFocused()
})

test('pages are reached by their URL too', async ({ page }) => {
  for (const { link, path, content } of PAGES) {
    await page.goto(path)
    await expect(navLink(page, link)).toHaveAttribute('aria-current', 'page')
    await expect(content(page)).toBeVisible()
  }
})

test('unknown URLs show that there is no such page', async ({ page }) => {
  for (const path of ['/nope', '/archives/nope', '/admin/nope']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible()
  }
})
