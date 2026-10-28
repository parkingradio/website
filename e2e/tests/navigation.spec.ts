import { test, expect } from './fixtures.ts'
import type { Locator, Page } from '@playwright/test'

// The site's navigation: the bar at the top of every page, which phones get as a drawer, and unknown URLs.

// The pages the navigation bar links to, with what shows that each one is there: their heading, or what they embed. The
// home page comes last, since the tests start there. The merch link opens another site, so it isn't here.
//
// What the pages embed is blocked (see fixtures.ts), but the frame is still there.
const PAGES: { link: string; path: string; content: (page: Page) => Locator }[] = [
  { link: 'archives', path: '/archives', content: (page) => page.getByTitle('Parking Radio Archives') },
  { link: 'programmation', path: '/programmation', content: (page) => page.getByRole('heading', { name: 'Programmation' }) },
  { link: 'synth meetups', path: '/synth-meetups', content: (page) => page.getByRole('heading', { name: 'dates à venir' }) },
  { link: 'appliquer', path: '/appliquer', content: (page) => page.getByRole('heading', { name: 'Appliquer' }) },
  { link: 'contribuer', path: '/contribuer', content: (page) => page.getByTitle('Parking Radio Contribuer') },
  { link: 'parking.radio', path: '/', content: (page) => page.getByTitle('Parking Radio Discord') },
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

// Scrolls `path` down further than the navigation bar is high. Its content is made long enough for that whatever it
// shows, and stays so on the pages that follow, since they're shown in the same place. Returns the bar's height.
async function scrollDown(page: Page, path: string, content: Locator) {
  await page.goto(path)
  await expect(content).toBeVisible()
  await page.locator('main').evaluate((main) => (main.style.minHeight = '3000px'))
  await page.evaluate(() => window.scrollTo(0, 300))
  const barHeight = (await page.locator('nav').boundingBox())!.height
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(barHeight)
  return barHeight
}

// Whether what's at the top of the screen is the navigation bar, rather than the page scrolled under it, or drawn over it.
const barOnTop = (page: Page) => page.evaluate(() => document.elementFromPoint(innerWidth / 2, 10)?.closest('nav') !== null)

test('the navigation bar stays at the top of the screen, over the page, as it scrolls', async ({ page, hasDrawer }) => {
  await scrollDown(page, '/', page.getByTitle('Parking Radio Discord'))
  expect(await barOnTop(page)).toBe(true)

  // The drawer's backdrop still covers the whole screen, down to its bottom.
  if (hasDrawer) {
    await menuButton(page).click()
    await expect
      .poll(() => page.evaluate(() => document.elementFromPoint(innerWidth - 5, innerHeight - 5)?.className))
      .toBe('menu-backdrop')
  }
})

test('the navigation bar scrolls away on very short screens', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 400 })
  await scrollDown(page, '/', page.getByTitle('Parking Radio Discord'))
  expect(await barOnTop(page)).toBe(false)
})

test('another page opens at its top', async ({ page, hasDrawer }) => {
  const barHeight = await scrollDown(page, '/', page.getByTitle('Parking Radio Discord'))

  await follow(page, hasDrawer, 'archives')
  await expect(page).toHaveURL('/archives')
  // It could have stayed scrolled down.
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(barHeight)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
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
