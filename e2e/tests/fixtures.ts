import { createHash } from 'node:crypto'
import { test as base, expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'
import type { components } from '../../client/src/api/schema.d.ts'
import { addDays, quebecInstant } from '../../client/src/quebec-time.ts'
import { admin } from '../env.ts'

// What every test is written with: Playwright's `test`, where the browser only reaches the server under test, under an
// address of its own, and where a page that throws fails the test.
//
// Tests run side by side against the same server, seeded with the data of seed-data.ts (see global-setup.ts), so they
// mustn't change what other tests see. A test that writes creates entities of its own, named uniquely, and never
// changes or deletes seeded ones. No test assumes that the seeded entities are all there is, either.
//
// In particular, feature flags apply to every visitor at once: tests assume they're all off, as they are until an admin
// turns one on. A test that needs a flag on fakes it for its own page instead, with the configuration the server gives
// and the flag on (see `withFeature`), which leaves the server as it is.

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
    // events of the "Programmation" page, which it gets from Resident Advisor, or for the seed's artists who apply
    // through the form, whose Turnstile tokens it checks with Cloudflare.
    const origin = new URL(baseURL!).origin
    await context.route((url) => url.origin !== origin, (route) => route.abort('blockedbyclient'))

    // The server tells clients apart by CF-Connecting-IP, which Cloudflare sets in production (see
    // server/src/api/client-address.ts). Each test gets an address of its own, so that tests don't share rate limits,
    // e.g. the one on logins.
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

export { expect, admin }

// The smallest PNG there is: one transparent pixel. The server tells a photo's type from its first bytes.
export const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

// The address of a worker's nth test, in 198.18.0.0/15, which is reserved for testing. No other worker of the run has
// the same index, and a retry runs in a new worker, so no two tests share an address. The range has room for 256
// workers of 512 tests each, far more than a run has.
function clientAddress(worker: number, nth: number): string {
  if (worker >= 256 || nth >= 512) throw new Error(`No address left for test ${nth} of worker ${worker}`)
  const index = worker * 512 + nth
  return `198.${18 + (index >> 16)}.${(index >> 8) & 255}.${index & 255}`
}

// What a test's own entities are named after, two days for its sessions, from 2100 to 2899, in July, when clocks don't
// change, and a YouTube video id of 11 characters. They're derived from its unique name, so that other tests' sessions,
// even those left from a run that failed, are very unlikely to have them.
export function own(testInfo: TestInfo) {
  const unique = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`
  const hash = createHash('sha256').update(unique).digest()
  const day = (offset: number) => `${2100 + (hash.readUInt32BE(offset) % 800)}-07-${String(1 + (hash.readUInt32BE(offset + 4) % 28)).padStart(2, '0')}`
  return { unique, day: day(0), otherDay: day(8), youtubeVideo: hash.toString('base64url').slice(0, 11) }
}

// E.g. "samedi 14 novembre 2026", for a day as "YYYY-MM-DD", as the admin pages write it, e.g. naming a day of
// Calendrier's month.
export function longDay(day: string): string {
  return new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day))
}

// Types `time`, e.g. "21:00", into a time field of the admin pages, `field` being its group: its hour, then its minute,
// which the focus moves on to once the hour can't take another digit.
export async function fillTime(field: Locator, time: string) {
  await field.getByRole('spinbutton').first().pressSequentially(time.replace(':', ''))
}

// Whether the page scrolls sideways, which it shouldn't, on phones too.
export const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

// The narrowest phones the admin pages are made for, which the mobile project's is wider than.
export const NARROW = { width: 360, height: 800 }

// Goes to a page of the admin pages, `/admin` unless told otherwise, and sends the login form shown in its place, as the
// admin unless told otherwise.
export async function logIn(page: Page, { at = '/admin', email = admin.email, password = admin.password } = {}) {
  await page.goto(at)
  await submitLogin(page, { email, password })
}

// Sends the login form that the page shows, as the admin unless told otherwise.
export async function submitLogin(page: Page, { email = admin.email, password = admin.password } = {}) {
  await page.getByLabel('Courriel').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'se connecter' }).click()
}

// The admin menu, which the admin pages show once logged in.
export function adminMenu(page: Page) {
  return page.getByRole('navigation', { name: 'admin' })
}

type Schemas = components['schemas']

// What `withCalendar` adds to the studio's calendar: occupations, holds and conflicts, as if they were read from feeds,
// and sessions, with those of them that are outside protected time.
export type CalendarExtra = {
  feeds: Schemas['CalendarFeed'][]
  occupations: Schemas['CalendarOccupation'][]
  conflicts: Schemas['CalendarConflict'][]
  holds?: Schemas['CalendarHold'][]
  sessions?: Schemas['Session'][]
  unprotectedSessions?: Schemas['CalendarUnprotectedSession'][]
}

// Has the page see the studio's calendar (GET /api/admin/calendar) with `extra` added to what the server answers, as if
// it had read them from feeds, which the server under test has none of: it only reads https links, and couldn't reach a
// feed of the tests' own. It also adds sessions, which the server would refuse where another test's are. Like the
// server, it gives only the sessions, occupations and holds that take some of the days asked for, in its order, by
// start, then end, but every conflict and session outside protected time, whatever the days. `extra` has to follow the
// server's other rules (see docs/design/server/calendar.md), e.g. the conflicts' order, since they're added after the
// server's, which has none, and the sessions outside protected time's, which the server, without a holds feed, has
// none of either.
export async function withCalendar(page: Page, extra: CalendarExtra) {
  await page.route(
    (url) => url.pathname === '/api/admin/calendar',
    async (route) => {
      const calendar = await (await route.fetch()).json()
      const query = new URL(route.request().url()).searchParams
      const from = quebecInstant(query.get('from')!, '00:00')!.getTime()
      const to = quebecInstant(addDays(query.get('to')!, 1), '00:00')!.getTime()
      // What the calendar has with a start and an end, which the sessions it gives have too.
      type Timed = { start: string | null; end: string | null }
      const within = ({ start, end }: Timed) => Date.parse(start!) < to && Date.parse(end!) > from
      const byTime = (a: Timed, b: Timed) => Date.parse(a.start!) - Date.parse(b.start!) || Date.parse(a.end!) - Date.parse(b.end!)
      await route.fulfill({
        json: {
          ...calendar,
          feeds: [...calendar.feeds, ...extra.feeds],
          sessions: [...calendar.sessions, ...(extra.sessions ?? []).filter(within)].sort(byTime),
          occupations: [...calendar.occupations, ...extra.occupations.filter(within)].sort(byTime),
          holds: [...calendar.holds, ...(extra.holds ?? []).filter(within)].sort(byTime),
          conflicts: [...calendar.conflicts, ...extra.conflicts],
          unprotectedSessions: [...calendar.unprotectedSessions, ...(extra.unprotectedSessions ?? [])],
        },
      })
    },
  )
}

// Has the page see the feature flag `id` as on, from the next page it loads, by answering `/api/config` with what the
// server answers and the flag on. Nothing changes on the server, so other tests still see every flag off.
export async function withFeature(page: Page, id: components['schemas']['FeatureId']) {
  await page.route(
    (url) => url.pathname === '/api/config',
    async (route) => {
      const config = await (await route.fetch()).json()
      await route.fulfill({ json: { ...config, features: { ...config.features, [id]: true } } })
    },
  )
}
