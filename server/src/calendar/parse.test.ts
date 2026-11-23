import { serialize } from 'node:v8'
import { describe, expect, it } from 'vitest'
import { TITLE_MAX_LENGTH } from './events.js'
import { FeedReadError, ReadAborted } from './fetch.js'
import { PARSE_TIMEOUT_MS, parseFeed } from './parse.js'

// Going through a feed's text in a process of its own, within a time and a memory limit (see "Reading the feeds" in
// docs/design/server/calendar.md).

const WINDOW = { from: new Date('2025-11-22T12:00:00Z'), to: new Date('2028-11-22T12:00:00Z') }

function feed(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:a', ...lines, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')
}

// A recurring event that never happens, every day of February 30, which ical.js goes on looking for without end, filling
// its caches as it goes.
const NEVER = feed('DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z', 'RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', 'SUMMARY:Jamais')

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('It did not fail')
}

describe('parseFeed', () => {
  it("gives the feed's events", async () => {
    const text = feed('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z', 'SUMMARY:Réparation du toit')
    expect(await parseFeed({ text, privateTitles: false, ...WINDOW })).toEqual({
      events: [{ start: new Date('2026-11-24T23:00:00Z'), end: new Date('2026-11-25T01:00:00Z'), wholeDay: false, title: 'Réparation du toit' }],
      skipped: 0,
    })
    expect((await parseFeed({ text, privateTitles: true, ...WINDOW })).events[0].title).toBeNull()
  })

  it("fails as the text's events fail the read", async () => {
    expect(await failure(parseFeed({ text: '<!doctype html>', privateTitles: false, ...WINDOW }))).toEqual(
      new FeedReadError(400, "The link can't be read: its answer isn't valid iCalendar"),
    )
  })

  it('fails the read when going through the text takes too long, or too much memory', async () => {
    const tooLong = await failure(parseFeed({ text: NEVER, privateTitles: false, ...WINDOW }, { timeoutMs: 1000 }))
    expect(tooLong).toBeInstanceOf(FeedReadError)
    expect(tooLong).toMatchObject({ status: 400, message: `The link can't be read: it takes more than ${PARSE_TIMEOUT_MS / 1000} seconds to go through` })
    const tooBig = await failure(parseFeed({ text: NEVER, privateTitles: false, ...WINDOW }, { maxMemoryMb: 32 }))
    expect(tooBig).toBeInstanceOf(FeedReadError)
    expect(tooBig).toMatchObject({ status: 400, message: "The link can't be read: it takes too much memory to go through" })
  }, 15_000)

  it('sends back titles that take little room, however long they are in the feed', async () => {
    // Each occurrence comes back with its own copy of its title.
    const text = feed('DTSTART:20260101T000000Z', 'DURATION:PT30M', 'RRULE:FREQ=HOURLY;COUNT=19000', `SUMMARY:${'Répétition '.repeat(5000)}`)
    expect(text.length).toBeGreaterThan(50_000)
    const read = await parseFeed({ text, privateTitles: false, ...WINDOW })
    expect(read.events).toHaveLength(19_000)
    expect(new Set(read.events.map(({ title }) => title))).toEqual(new Set([`${'Répétition '.repeat(18).trim()}…`]))
    expect(serialize(read).length).toBeLessThan(19_000 * (2 * TITLE_MAX_LENGTH + 100))
  })

  it('goes through one feed at a time, and stops waiting its turn when the read is stopped', async () => {
    const started = performance.now()
    const elapsed = (promise: Promise<unknown>) => failure(promise).then(() => performance.now() - started)
    const first = elapsed(parseFeed({ text: NEVER, privateTitles: false, ...WINDOW }, { timeoutMs: 1000 }))
    const second = elapsed(parseFeed({ text: NEVER, privateTitles: false, ...WINDOW }, { timeoutMs: 1000 }))
    const stopping = new AbortController()
    const third = parseFeed({ text: NEVER, privateTitles: false, ...WINDOW }, { signal: stopping.signal })
    setTimeout(() => stopping.abort(), 200)
    expect(await failure(third)).toBeInstanceOf(ReadAborted)
    expect(performance.now() - started).toBeLessThan(1000)
    // The second only starts once the first's process has ended, and then has its own time.
    expect(await first).toBeGreaterThanOrEqual(1000)
    expect(await second).toBeGreaterThanOrEqual(2000)
  }, 15_000)

  it('stops when the read is stopped, and lets the next one go through', async () => {
    const stopping = new AbortController()
    const parsing = parseFeed({ text: NEVER, privateTitles: false, ...WINDOW }, { signal: stopping.signal })
    const next = parseFeed({ text: feed('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z'), privateTitles: false, ...WINDOW })
    setTimeout(() => stopping.abort(), 200)
    const started = performance.now()
    expect(await failure(parsing)).toBeInstanceOf(ReadAborted)
    // Its process was killed, rather than left to go on until its time is up.
    expect((await next).events).toHaveLength(1)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(await failure(parseFeed({ text: NEVER, privateTitles: false, ...WINDOW }, { signal: stopping.signal }))).toBeInstanceOf(ReadAborted)
  })
})
