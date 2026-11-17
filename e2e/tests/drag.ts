import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Dragging the items of the admin pages' lists by their handles (see "Reordering" in
// docs/design/client/admin/layout.md), with the mouse, or with a finger on touch screens.

type Point = { x: number; y: number }

// Where `locator` is, in the page's viewport.
export async function centerOf(locator: Locator): Promise<Point> {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// Drags the item whose handle is `handle` onto `target`, another item, whose place it takes: with a finger, holding the
// handle for a moment first, when `touch`, or else with the mouse. Both have to be on the screen once the handle is.
// The item is picked up once it's moved a little, and the page measures the list then, which is waited for, as is the
// page following the last move, before it's dropped.
export async function drag(page: Page, handle: Locator, target: Locator, { touch }: { touch: boolean }) {
  await handle.scrollIntoViewIfNeeded()
  const from = await centerOf(handle)
  const to = { x: from.x, y: (await centerOf(target)).y }
  const nudged = { x: from.x, y: from.y + Math.sign(to.y - from.y) * 10 }
  const finger = touch ? await fingerOn(page) : null
  if (finger) {
    await finger('touchStart', from)
    // Longer than the moment the handle has to be held for (see the TouchSensor's delay in
    // client/src/pages/admin/sortable.tsx), before which moving the finger does nothing.
    await page.waitForTimeout(300)
    await finger('touchMove', nudged)
  } else {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(nudged.x, nudged.y)
  }
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  for (let i = 1; i <= 5; i++) {
    const point = { x: to.x, y: nudged.y + ((to.y - nudged.y) * i) / 5 }
    if (finger) await finger('touchMove', point)
    else await page.mouse.move(point.x, point.y)
  }
  await nextFrames(page)
  if (finger) await finger('touchEnd')
  else await page.mouse.up()
}

// Picks up the item whose handle is `handle` with the keyboard, moves it `by` places down, or up if it's negative, and
// drops it there. The page only listens for the arrows a moment after the item is picked up, which is waited for, and
// each move is waited for, until the page announces the item's new place.
export async function moveWithKeyboard(page: Page, handle: Locator, by: number) {
  const announced = page.getByRole('status').filter({ hasText: /position \d+ sur \d+/ })
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(announced).toContainText('Vous déplacez')
  await nextFrames(page)
  for (let i = 0; i < Math.abs(by); i++) {
    const before = await announced.textContent()
    await page.keyboard.press(by > 0 ? 'ArrowDown' : 'ArrowUp')
    await expect(announced).not.toHaveText(before!)
  }
  await page.keyboard.press('Space')
}

// Moves a finger from `from` to `to`, e.g. to scroll the page.
export async function swipe(page: Page, from: Point, to: Point) {
  const finger = await fingerOn(page)
  await finger('touchStart', from)
  for (let i = 1; i <= 10; i++) await finger('touchMove', { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 })
  await finger('touchEnd')
}

// What puts a finger on the page, moves it and lifts it, once. Playwright can only tap, but Chrome's DevTools protocol
// can move a finger, and both projects run Chromium (see playwright.config.ts).
async function fingerOn(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  return async (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
    if (type === 'touchEnd') await cdp.detach()
  }
}

// Once the page has drawn two more frames, by which time it has followed what was done before.
async function nextFrames(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
