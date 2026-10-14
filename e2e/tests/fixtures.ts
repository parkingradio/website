import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { required } from '../env'

// What every test is written with: Playwright's `test`, where the browser only reaches the server under test, under an
// address of its own, and where a page that throws fails the test.
//
// Tests run side by side against the same server, so they mustn't change what other tests see. In particular, feature
// flags apply to every visitor at once: tests assume they're all off, as they are until an admin turns one on. A test
// that turns a flag on has to run apart from the others, e.g. in a project of its own that `dependencies` runs after
// them, and turn it back off.

// The options projects set (see playwright.config.ts).
export type Options = {
  // Whether the navigation links are in a drawer, as they are on narrow screens, e.g. phones.
  hasDrawer: boolean
}

// How many tests this worker has run, which gives each one an address of its own (see `clientAddress`).
let testsInWorker = 0

export const test = base.extend<Options>({
  hasDrawer: [false, { option: true }],

  context: async ({ context, baseURL }, use, testInfo) => {
    // Requests for anything else, e.g. the widgets the home page embeds or the assets' domain, fail right away. The
    // browser then doesn't depend on other sites being up, or on how fast they are. The server still does, e.g. for the
    // events of the "Programmation" page, which it gets from Resident Advisor.
    const origin = new URL(baseURL!).origin
    await context.route((url) => url.origin !== origin, (route) => route.abort('blockedbyclient'))

    // The server tells clients apart by CF-Connecting-IP, which Cloudflare sets in production (see client-address.ts).
    // Each test gets an address of its own, so that tests don't share rate limits, e.g. the one on logins.
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': clientAddress(testInfo.workerIndex, testsInWorker++) })

    await use(context)
  },

  page: async ({ page }, use) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await use(page)
    expect(errors, 'uncaught errors in the page').toEqual([])
  },
})

export { expect }

// The address of a worker's nth test, in 198.18.0.0/15, which is reserved for testing. No other worker of the run has
// the same index, and a retry runs in a new worker, so no two tests share an address. The range has room for 256
// workers of 512 tests each, far more than a run has.
function clientAddress(worker: number, nth: number): string {
  if (worker >= 256 || nth >= 512) throw new Error(`No address left for test ${nth} of worker ${worker}`)
  const index = worker * 512 + nth
  return `198.${18 + (index >> 16)}.${(index >> 8) & 255}.${index & 255}`
}

// The admin run.sh creates when it starts the server (see integration-tests/stack.sh).
export const admin = {
  email: required('ADMIN_EMAIL'),
  password: required('ADMIN_PASSWORD'),
}

// Goes to a page of the admin pages, `/admin` unless told otherwise, and sends the login form shown in its place, as the
// admin unless told otherwise.
export async function logIn(page: Page, { at = '/admin', email = admin.email, password = admin.password } = {}) {
  await page.goto(at)
  await page.getByLabel('Courriel').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'se connecter' }).click()
}

// The admin menu, which the admin pages show once logged in.
export function adminMenu(page: Page) {
  return page.getByRole('navigation', { name: 'admin' })
}
