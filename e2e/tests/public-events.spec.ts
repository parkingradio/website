import type { Page } from '@playwright/test'
import { addDays, formatLongQuebecDay, quebecDayAndTime, quebecInstant } from '../../client/src/quebec-time.ts'
import { test, expect, withFeature } from './fixtures.ts'

// Programmation and Synth Meetups once they read the public events, the announced sessions, which the
// `evenements-publics` flag switches them to, with the seeded sessions (see seed-data.ts), and the calendar feed of them.
// Other tests announce sessions of their own, so these only look for the seeded ones.

// The row of the event titled `title`, on Programmation.
const rowOf = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: title, exact: true }) })

// E.g. "mercredi 25 novembre 2026", the day `offset` days from today, in Québec, as Synth Meetups lists it.
function longDay(offset: number): string {
  const day = addDays(quebecDayAndTime(new Date()).day, offset)
  return formatLongQuebecDay(quebecInstant(day, '12:00')!.toISOString())
}

test.beforeEach(async ({ page }) => {
  await withFeature(page, 'evenements-publics')
})

test('Programmation lists the announced sessions, with their lineups, their flyers and their events on RA', async ({ page }) => {
  await page.goto('/programmation')

  // The upcoming synth meetup that has an event on RA, and a flyer, which the server serves.
  const meetup = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'SYNTH MEETUPS sur RA' }) })
  await expect(meetup.getByRole('link', { name: 'SYNTH MEETUPS sur RA' })).toHaveAttribute('href', 'https://ra.co/events/2403003')
  await expect(meetup.locator('.event-lineup')).toHaveText('OPEN JAM')
  const flyer = meetup.locator('.event-flyer img')
  await expect(flyer).toHaveAttribute('src', /^\/api\/events\/flyers\/[0-9a-f]{64}\/w320\.v2\.webp$/)
  await flyer.scrollIntoViewIfNeeded()
  // The server's thumbnail of the 640-pixel flyer.
  await expect(flyer).toHaveJSProperty('naturalWidth', 320)

  // The live performance, which has neither a flyer nor an event on RA, so nothing links.
  const live = rowOf(page, 'LIVE PERFORMANCE')
  await expect(live.locator('.event-lineup')).toHaveText('Ondine')
  await expect(live.locator('.event-flyer')).toHaveClass(/placeholder/)
  await expect(live.getByRole('link', { includeHidden: true })).toHaveCount(0)

  // The cancelled takeover, which stays listed, without a lineup, since its sets are cancelled too.
  const cancelled = rowOf(page, '[CANCELLED] LES NUITS BASSES TAKEOVER')
  await expect(cancelled.getByRole('link', { name: /sur RA$/ })).toHaveAttribute('href', 'https://ra.co/events/2302002')
  await expect(cancelled.locator('.event-lineup')).toHaveCount(0)

  // A past one.
  await page.getByRole('button', { name: 'passés' }).click()
  await expect(rowOf(page, 'ONDE COMMUNE TAKEOVER').locator('.event-lineup')).toHaveText('Clémentine Brûlée / Fréquence Boréale / Kwame Asante')
})

test('Programmation links to the calendar feed', async ({ page, baseURL }) => {
  await page.goto('/programmation')
  await expect(page.getByRole('link', { name: "s'abonner au calendrier" })).toHaveAttribute('href', `webcal://${new URL(baseURL!).host}/calendar.ics`)
})

test('The calendar feed has the announced sessions, with their lineups', async ({ request }) => {
  const response = await request.get('/calendar.ics')
  expect(response.headers()['content-type']).toBe('text/calendar; charset=utf-8')
  // Its events, with their lines unfolded.
  const vevents = (await response.text()).replace(/\r\n /g, '').match(/BEGIN:VEVENT[^]*?END:VEVENT/g) ?? []
  const veventWith = (line: string) => {
    const found = vevents.filter((vevent) => vevent.split('\r\n').includes(line))
    expect(found, line).toHaveLength(1)
    return found[0].split('\r\n')
  }

  // The cancelled takeover, which stays in it.
  const cancelled = veventWith('URL:https://ra.co/events/2302002')
  expect(cancelled).toContain('SUMMARY:[CANCELLED] LES NUITS BASSES TAKEOVER')
  expect(cancelled).toContain('STATUS:CANCELLED')
  // The live performance, with its own description.
  expect(veventWith('DESCRIPTION:Ondine\\n\\nOndine au synthé modulaire\\, une heure en direct du parking.')).toContain('SUMMARY:LIVE PERFORMANCE')
  // The synth meetup, which has OPEN JAM as its lineup.
  const meetup = veventWith('URL:https://ra.co/events/2403003')
  expect(meetup.find((line) => line.startsWith('DESCRIPTION:'))).toMatch(/^DESCRIPTION:OPEN JAM\\n\\nSYNTH MEETUPS/)
  // A past one, with its lineup, then its description.
  const past = veventWith('URL:https://ra.co/events/2201001')
  expect(past.find((line) => line.startsWith('DESCRIPTION:'))).toMatch(/^DESCRIPTION:Clémentine Brûlée\\nFréquence Boréale\\nKwame Asante\\n\\nONDE COMMUNE TAKEOVER\\n/)
})

test('Synth Meetups lists the announced synth meetups, linking those with an event on RA to it', async ({ page }) => {
  await page.goto('/synth-meetups')

  await expect(page.getByRole('link', { name: longDay(8) })).toHaveAttribute('href', 'https://ra.co/events/2403003')
  await expect(page.getByText(longDay(22), { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: longDay(22) })).toHaveCount(0)
})
