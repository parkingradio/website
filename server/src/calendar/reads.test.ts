import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import type { CalendarFeedsStore, StoredFeed } from './feeds.js'
import { FeedReadError, ReadAborted } from './fetch.js'
import { calendarReads, READ_INTERVAL_MS } from './reads.js'

// Reading the feeds every 15 minutes, and keeping what was read in memory (see "Reading the feeds" in
// docs/design/server/calendar.md), with a fake store and fake links.

const NOW = new Date('2026-11-22T12:00:00Z')

function feed(id: string, kind: StoredFeed['kind'] = 'occupation'): StoredFeed {
  return { id, name: `Feed ${id}`, kind, link: `https://example.com/${id}.ics`, createdBy: 'admin@example.com', createdAt: NOW }
}

// A calendar with one event, which starts `day` days after NOW.
function calendar(day = 1, summary = 'Réparation') {
  const start = new Date(NOW.getTime() + day * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]|\.\d+/g, '')
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:a', `DTSTART:${start}`, 'DURATION:PT1H', `SUMMARY:${summary}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
}

// A promise and what settles it.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let stored: StoredFeed[]
const list = vi.fn<CalendarFeedsStore['list']>()
const store = { list } as unknown as CalendarFeedsStore
// What each link gives, by its feed's id: a text, an error, or a function that reads it.
let answers: Map<string, string | Error | ((signal: AbortSignal) => Promise<string>)>
const readText = vi.fn(async (link: string, signal: AbortSignal) => {
  const answer = answers.get(/\/([^/]+)\.ics$/.exec(link)![1])
  if (answer === undefined) throw new Error('No answer')
  if (answer instanceof Error) throw answer
  return typeof answer === 'string' ? answer : answer(signal)
})
const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

function reader() {
  return calendarReads({ feeds: store, log: log as unknown as FastifyBaseLogger, readText })
}

// Lets the reads under way go on, as far as they can without time passing.
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('calendarReads', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    stored = [feed('a'), feed('b', 'quiet-time')]
    list.mockReset().mockImplementation(async () => stored)
    answers = new Map([
      ['a', calendar(1)],
      ['b', calendar(2, 'Jane Doe')],
    ])
    readText.mockClear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads every feed when it starts, then every 15 minutes', async () => {
    const reads = reader()
    expect(reads.of('a')).toBeUndefined()
    reads.start()
    await settle()
    expect(reads.of('a')).toEqual({ events: [{ start: new Date('2026-11-23T12:00:00Z'), end: new Date('2026-11-23T13:00:00Z'), title: 'Réparation' }], readAt: NOW, error: null })
    // Quiet time's titles are never kept.
    expect(reads.of('b')!.events).toEqual([{ start: new Date('2026-11-24T12:00:00Z'), end: new Date('2026-11-24T13:00:00Z'), title: null }])
    expect(readText).toHaveBeenCalledTimes(2)

    // A feed added meanwhile, e.g. by another server, is read with the others.
    stored = [...stored, feed('c')]
    answers.set('c', calendar(3))
    answers.set('a', calendar(4))
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS - 1)
    expect(readText).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(readText).toHaveBeenCalledTimes(5)
    expect(reads.of('a')).toMatchObject({ events: [{ start: new Date('2026-11-26T12:00:00Z') }], readAt: new Date(NOW.getTime() + READ_INTERVAL_MS) })
    expect(reads.of('c')).toMatchObject({ events: [{ start: new Date('2026-11-25T12:00:00Z') }], error: null })
    reads.stop()
    await reads.stopped()
  })

  it('keeps what it read before when a read fails, and says why until one succeeds', async () => {
    const reads = reader()
    reads.start()
    await settle()
    const before = reads.of('a')!

    answers.set('a', new FeedReadError(502, "The link can't be read: its server fails (503)"))
    answers.set('b', '<html>Not a calendar</html>')
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    expect(reads.of('a')).toEqual({ ...before, error: "The link can't be read: its server fails (503)" })
    expect(reads.of('b')).toMatchObject({ error: "The link can't be read: its answer isn't valid iCalendar" })
    expect(log.warn).toHaveBeenCalledWith({ feed: 'a', name: 'Feed a', error: "The link can't be read: its server fails (503)" }, 'Failed to read a calendar feed')

    answers.set('a', calendar(5))
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    expect(reads.of('a')).toMatchObject({ readAt: new Date(NOW.getTime() + 2 * READ_INTERVAL_MS), error: null })
    reads.stop()
  })

  it('has no events, nor when it read them, until a read of a feed succeeds', async () => {
    answers.set('a', new FeedReadError(400, "The link can't be read: its server refuses it (404)"))
    const reads = reader()
    reads.start()
    await settle()
    expect(reads.of('a')).toEqual({ events: [], readAt: null, error: "The link can't be read: its server refuses it (404)" })
    reads.stop()
  })

  it("doesn't say what went wrong when it's unexpected", async () => {
    answers.set('a', new Error('Something that quotes the calendar: Jane Doe'))
    const reads = reader()
    reads.start()
    await settle()
    expect(reads.of('a')!.error).toBe("The link can't be read: something went wrong")
    expect(JSON.stringify([log.warn.mock.calls, log.error.mock.calls])).not.toContain('Jane Doe')
    reads.stop()
  })

  it('reads the feeds one after another', async () => {
    const a = deferred<string>()
    answers.set('a', () => a.promise)
    const reads = reader()
    reads.start()
    await settle()
    expect(readText).toHaveBeenCalledTimes(1)
    a.resolve(calendar(1))
    await settle()
    expect(readText).toHaveBeenCalledTimes(2)
    reads.stop()
  })

  it('forgets a feed that was removed, even when a read of it ends after that', async () => {
    const a = deferred<string>()
    answers.set('a', () => a.promise)
    const reads = reader()
    reads.start()
    await settle()
    reads.removed('a')
    a.resolve(calendar(1))
    await settle()
    expect(reads.of('a')).toBeUndefined()
    expect(reads.of('b')).toBeDefined()
    reads.stop()
  })

  it('keeps what was read of a feed added while the feeds are listed, and not of one removed then', async () => {
    const listed = deferred<StoredFeed[]>()
    list.mockImplementationOnce(() => listed.promise)
    const reads = reader()
    reads.start()
    await settle()
    // The listing started before `c` was added, and `b` removed.
    reads.added('c', { events: [], readAt: NOW })
    reads.removed('b')
    listed.resolve([feed('a'), feed('b')])
    await settle()
    expect(reads.of('c')).toEqual({ events: [], readAt: NOW, error: null })
    expect(reads.of('b')).toBeUndefined()
    expect(readText).toHaveBeenCalledTimes(1)
    reads.stop()
  })

  it('forgets the feeds that are no longer listed, e.g. removed by another server', async () => {
    const reads = reader()
    reads.start()
    await settle()
    stored = [feed('a')]
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    expect(reads.of('b')).toBeUndefined()
    reads.stop()
  })

  it('goes on when the feeds cannot be listed', async () => {
    list.mockRejectedValueOnce(new Error('The database is down'))
    const reads = reader()
    reads.start()
    await settle()
    expect(log.error).toHaveBeenCalledOnce()
    expect(readText).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    expect(readText).toHaveBeenCalledTimes(2)
    reads.stop()
  })

  it('cuts short the reads under way when it stops, those of feeds being added included, and then stops', async () => {
    const aborted = (signal: AbortSignal) => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new ReadAborted())))
    answers.set('a', aborted)
    answers.set('new', aborted)
    const reads = reader()
    reads.start()
    await settle()
    const adding = reads.read({ name: 'New', kind: 'occupation', link: 'https://example.com/new.ics' })
    reads.stop()
    await expect(adding).rejects.toBeInstanceOf(ReadAborted)
    await reads.stopped()
    expect(readText).toHaveBeenCalledTimes(2)
    // It doesn't read again.
    await vi.advanceTimersByTimeAsync(2 * READ_INTERVAL_MS)
    expect(readText).toHaveBeenCalledTimes(2)
    expect(reads.of('a')).toBeUndefined()
  })
})
