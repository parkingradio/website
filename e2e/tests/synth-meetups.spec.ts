import { test, expect } from './fixtures.ts'

// The Synth Meetups page's lightbox, which shows a poster over the whole screen. The posters themselves are blocked (see
// fixtures.ts), but their thumbnails and the lightbox still take their room.

test('a poster opens over the whole screen, navigation bar included, and closes with Escape', async ({ page }) => {
  await page.goto('/synth-meetups')
  const thumbnail = page.getByRole('button', { name: /^Voir en grand/ }).first()

  // From the keyboard, so that the focus is on the thumbnail before the lightbox opens.
  await thumbnail.focus()
  await page.keyboard.press('Enter')
  const lightbox = page.getByRole('dialog')
  await expect(lightbox).toBeVisible()
  // What's at the top of the screen, where the navigation bar is, and at its bottom corner.
  const covering = await page.evaluate(() =>
    [document.elementFromPoint(innerWidth / 2, 10), document.elementFromPoint(5, innerHeight - 5)].map(
      (element) => !!element?.closest('dialog'),
    ),
  )
  expect(covering).toEqual([true, true])

  await page.keyboard.press('Escape')
  await expect(lightbox).toBeHidden()
  await expect(thumbnail).toBeFocused()
})
