import { describe, expect, it } from 'vitest'
import { FeedReadError, ReadAborted } from './fetch.js'
import { PARSE_MAX_MEMORY_MB, PARSE_TIMEOUT_MS, parseFeed } from './parse.js'

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
    expect(await parseFeed({ text, kind: 'occupation', ...WINDOW })).toEqual({
      events: [{ start: new Date('2026-11-24T23:00:00Z'), end: new Date('2026-11-25T01:00:00Z'), title: 'Réparation du toit' }],
      skipped: 0,
    })
    expect((await parseFeed({ text, kind: 'quiet-time', ...WINDOW })).events[0].title).toBeNull()
  })

  it("fails as the text's events fail the read", async () => {
    expect(await failure(parseFeed({ text: '<!doctype html>', kind: 'occupation', ...WINDOW }))).toEqual(
      new FeedReadError(400, "The link can't be read: its answer isn't valid iCalendar"),
    )
  })

  it('fails the read when going through the text takes too long, or too much memory, without the server', async () => {
    const heap = process.memoryUsage().heapUsed
    const tooLong = await failure(parseFeed({ text: NEVER, kind: 'occupation', ...WINDOW }, { timeoutMs: 1000 }))
    expect(tooLong).toBeInstanceOf(FeedReadError)
    expect(tooLong).toMatchObject({ status: 400, message: `The link can't be read: it takes more than ${PARSE_TIMEOUT_MS / 1000} seconds to go through` })
    const tooBig = await failure(parseFeed({ text: NEVER, kind: 'occupation', ...WINDOW }, { maxMemoryMb: 32 }))
    expect(tooBig).toBeInstanceOf(FeedReadError)
    expect(tooBig).toMatchObject({ status: 400, message: `The link can't be read: it takes more than ${PARSE_MAX_MEMORY_MB} MB to go through` })
    // It all happened in another process.
    expect(process.memoryUsage().heapUsed - heap).toBeLessThan(20 * 1024 * 1024)
  }, 15_000)

  it('goes through one feed at a time, and stops waiting its turn when the read is stopped', async () => {
    const started = performance.now()
    const elapsed = (promise: Promise<unknown>) => failure(promise).then(() => performance.now() - started)
    const first = elapsed(parseFeed({ text: NEVER, kind: 'occupation', ...WINDOW }, { timeoutMs: 1000 }))
    const second = elapsed(parseFeed({ text: NEVER, kind: 'occupation', ...WINDOW }, { timeoutMs: 1000 }))
    const stopping = new AbortController()
    const third = parseFeed({ text: NEVER, kind: 'occupation', ...WINDOW }, { signal: stopping.signal })
    setTimeout(() => stopping.abort(), 200)
    expect(await failure(third)).toBeInstanceOf(ReadAborted)
    expect(performance.now() - started).toBeLessThan(1000)
    // The second only starts once the first's process has ended, and then has its own time.
    expect(await first).toBeGreaterThanOrEqual(1000)
    expect(await second).toBeGreaterThanOrEqual(2000)
  }, 15_000)

  it('stops when the read is stopped', async () => {
    const stopping = new AbortController()
    const parsing = parseFeed({ text: NEVER, kind: 'occupation', ...WINDOW }, { signal: stopping.signal })
    setTimeout(() => stopping.abort(), 200)
    const started = performance.now()
    expect(await failure(parsing)).toBeInstanceOf(ReadAborted)
    expect(performance.now() - started).toBeLessThan(2000)
    stopping.abort()
    expect(await failure(parseFeed({ text: NEVER, kind: 'occupation', ...WINDOW }, { signal: stopping.signal }))).toBeInstanceOf(ReadAborted)
  })
})
