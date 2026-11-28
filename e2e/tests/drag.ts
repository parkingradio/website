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

// What drags: the mouse, or a finger.
type Pointer = { down: (at: Point) => Promise<void>; move: (to: Point) => Promise<void>; up: () => Promise<void> }

// Drags the item whose handle is `handle` onto `target`, another item, whose place it takes: with a finger, holding the
// handle for a moment first, when `touch`, or else with the mouse. Both have to be on the screen once the handle is.
// The item is picked up once it's moved a little, and the page measures the list then, which is waited for, as is the
// page following the last move, before it's dropped. dnd-kit ignores the clicks that come within 50 ms of a drop, which a
// person never makes, but a test can, so that's waited for too.
export async function drag(page: Page, handle: Locator, target: Locator, { touch }: { touch: boolean }) {
  await handle.scrollIntoViewIfNeeded()
  const from = await centerOf(handle)
  const to = { x: from.x, y: (await centerOf(target)).y }
  const nudged = { x: from.x, y: from.y + Math.sign(to.y - from.y) * 10 }
  const dragWith = async (pointer: Pointer) => {
    await pointer.down(from)
    // Longer than the moment the handle has to be held for on a touch screen (see the TouchSensor's delay in
    // client/src/pages/admin/sortable.tsx), before which moving the finger does nothing.
    if (touch) await page.waitForTimeout(300)
    await pointer.move(nudged)
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    for (let i = 1; i <= 5; i++) await pointer.move({ x: to.x, y: nudged.y + ((to.y - nudged.y) * i) / 5 })
    await nextFrames(page)
    await pointer.up()
    await page.waitForTimeout(100)
  }
  if (touch) return withFinger(page, dragWith)
  await dragWith({
    down: async ({ x, y }) => {
      await page.mouse.move(x, y)
      await page.mouse.down()
    },
    move: ({ x, y }) => page.mouse.move(x, y),
    up: () => page.mouse.up(),
  })
}

// Picks up the item whose handle is `handle` with the keyboard, and returns what the page announces, after the handle's
// list. The page only listens for the other keys, e.g. the arrows or Escape, a moment after the item is picked up, which
// is waited for.
export async function pickUp(page: Page, handle: Locator): Promise<Locator> {
  const announced = handle.locator('xpath=(ancestor::ol | ancestor::table)[last()]/following-sibling::*[@role="status"][1]')
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(announced).toContainText('Vous déplacez')
  await nextFrames(page)
  return announced
}

// Picks up the item whose handle is `handle` with the keyboard, moves it `by` places down, or up if it's negative, and
// drops it there. Each move is waited for, until the page announces the item's new place.
export async function moveWithKeyboard(page: Page, handle: Locator, by: number) {
  const announced = await pickUp(page, handle)
  for (let i = 0; i < Math.abs(by); i++) {
    const before = await announced.textContent()
    await page.keyboard.press(by > 0 ? 'ArrowDown' : 'ArrowUp')
    await expect(announced).not.toHaveText(before!)
  }
  await page.keyboard.press('Space')
}

// Moves a finger from `from` to `to`, e.g. to scroll the page, and waits for the page to stop scrolling.
export async function swipe(page: Page, from: Point, to: Point) {
  await withFinger(page, async (finger) => {
    await finger.down(from)
    for (let i = 1; i <= 10; i++) await finger.move({ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 })
    await finger.up()
  })
  const scrolled = () => page.evaluate(() => window.scrollY)
  for (let last = NaN, now = await scrolled(); now !== last; last = now, now = await scrolled()) await nextFrames(page)
}

// Puts a finger on the page for `use`. Playwright can only tap, but Chrome's DevTools protocol can move a finger, and
// both projects run Chromium (see playwright.config.ts).
async function withFinger(page: Page, use: (finger: Pointer) => Promise<void>) {
  const cdp = await page.context().newCDPSession(page)
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] })
  }
  try {
    await use({ down: (at) => touch('touchStart', at), move: (to) => touch('touchMove', to), up: () => touch('touchEnd') })
  } finally {
    await cdp.detach()
  }
}

// Once the page has drawn two more frames, by which time it has followed what was done before.
async function nextFrames(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
