import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import type { CalendarFeedsStore, StoredFeed } from './feeds.js'
import { calendarEvents } from './events.js'
import { FeedReadError, ReadAborted } from './fetch.js'
import type { parseFeed } from './parse.js'
import { calendarReads, READ_INTERVAL_MS } from './reads.js'

// Reading the feeds every 15 minutes, and keeping what was read in memory (see "Reading the feeds" in
// docs/design/server/calendar.md), with a fake store and fake links.

const NOW = new Date('2026-11-22T12:00:00Z')

const linkOf = (id: string) => `https://example.com/${id}.ics`
const settingsOf = (id: string, privateTitles = false) => ({ link: linkOf(id), privateTitles })

function feed(id: string, privateTitles = false): StoredFeed {
  return { id, name: `Feed ${id}`, link: linkOf(id), privateTitles, createdBy: 'admin@example.com', createdAt: NOW, updatedBy: null, updatedAt: null }
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
  // The text is gone through in the tests' own process, without the time passing that a process of its own would take
  // (see parse.test.ts).
  const parse: typeof parseFeed = async ({ text, privateTitles, from, to }) => calendarEvents(text, privateTitles, { from, to })
  return calendarReads({ feeds: store, log: log as unknown as FastifyBaseLogger, readText, parse })
}

// Lets the reads under way go on, as far as they can without time passing.
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('calendarReads', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    stored = [feed('a'), feed('b', true)]
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
    expect(reads.of('a')).toEqual({ events: [{ start: new Date('2026-11-23T12:00:00Z'), end: new Date('2026-11-23T13:00:00Z'), wholeDay: false, title: 'Réparation' }], readAt: NOW, error: null, settings: settingsOf('a') })
    // Private titles are never kept.
    expect(reads.of('b')!.events).toEqual([{ start: new Date('2026-11-24T12:00:00Z'), end: new Date('2026-11-24T13:00:00Z'), wholeDay: false, title: null }])
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
    expect(reads.of('a')).toEqual({ events: [], readAt: null, error: "The link can't be read: its server refuses it (404)", settings: settingsOf('a') })
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
    reads.added('c', { events: [], readAt: NOW, settings: { link: linkOf('c'), privateTitles: false } })
    reads.removed('b')
    listed.resolve([feed('a'), feed('b')])
    await settle()
    expect(reads.of('c')).toEqual({ events: [], readAt: NOW, error: null, settings: settingsOf('c') })
    expect(reads.of('b')).toBeUndefined()
    expect(readText).toHaveBeenCalledTimes(1)
    reads.stop()
  })

  it("keeps the read of a feed's new link, and ignores that of its former one, whether it succeeds or fails", async () => {
    for (const ending of ['succeeds', 'fails'] as const) {
      const a = deferred<string>()
      answers.set('a', () => a.promise)
      answers.set('a2', calendar(9))
      const reads = reader()
      reads.start()
      await settle()
      // The new link is read while the former one is.
      const read = await reads.read({ id: 'a', name: 'Feed a', link: linkOf('a2'), privateTitles: false })
      reads.changed('a', { link: linkOf('a2'), privateTitles: false }, read)
      expect(reads.of('a')).toMatchObject({ events: [{ start: new Date('2026-12-01T12:00:00Z') }], error: null })
      if (ending === 'succeeds') a.resolve(calendar(1))
      else a.reject(new FeedReadError(502, "The link can't be read: its server fails (503)"))
      await settle()
      expect(reads.of('a'), ending).toMatchObject({ events: [{ start: new Date('2026-12-01T12:00:00Z') }], error: null })
      reads.stop()
    }
  })

  it("forgets what was read from a feed's former link when the read of its new one was made with other titles", async () => {
    answers.set('a2', calendar(9, 'Jane Doe'))
    const reads = reader()
    reads.start()
    await settle()
    // Its titles became private while its new link was read with them.
    const read = await reads.read({ id: 'a', name: 'Feed a', link: linkOf('a2'), privateTitles: false })
    stored = [{ ...feed('a', true), link: linkOf('a2') }, feed('b', true)]
    reads.changed('a', { link: linkOf('a2'), privateTitles: true }, read)
    expect(reads.of('a')).toBeUndefined()
    // Its next read reads its new link.
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    expect(reads.of('a')).toMatchObject({ events: [{ start: new Date('2026-12-01T12:00:00Z'), title: null }], error: null })
    reads.stop()
  })

  it('forgets the titles of a feed as soon as they become private, and ignores the reads made with them', async () => {
    const reads = reader()
    reads.start()
    await settle()
    const a = deferred<string>()
    answers.set('a', () => a.promise)
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    reads.changed('a', { link: linkOf('a'), privateTitles: true })
    expect(reads.of('a')).toEqual({ events: [{ start: new Date('2026-11-23T12:00:00Z'), end: new Date('2026-11-23T13:00:00Z'), wholeDay: false, title: null }], readAt: NOW, error: null, settings: settingsOf('a', true) })
    a.resolve(calendar(1))
    await settle()
    expect(reads.of('a')).toMatchObject({ events: [{ title: null }], readAt: NOW })
    reads.stop()
  })

  it('forgets the titles of a feed whose titles became private elsewhere once the feeds are listed, even when its read then fails', async () => {
    const reads = reader()
    reads.start()
    await settle()
    expect(reads.of('a')).toMatchObject({ events: [{ title: 'Réparation' }] })
    const listed = deferred<StoredFeed[]>()
    list.mockImplementationOnce(() => listed.promise)
    const a = deferred<string>()
    answers.set('a', () => a.promise)
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    listed.resolve([feed('a', true), feed('b', true)])
    await settle()
    expect(reads.of('a')).toMatchObject({ events: [{ title: null }], readAt: NOW, settings: settingsOf('a', true) })
    a.reject(new FeedReadError(502, "The link can't be read: its server fails (503)"))
    await settle()
    expect(reads.of('a')).toMatchObject({ events: [{ title: null }], readAt: NOW, error: "The link can't be read: its server fails (503)" })
    reads.stop()
  })

  it('forgets what was read from the former link of a feed whose link changed elsewhere, even when the new one then fails', async () => {
    const reads = reader()
    reads.start()
    await settle()
    answers.set('a2', new FeedReadError(502, "The link can't be read: its server fails (503)"))
    stored = [{ ...feed('a'), link: linkOf('a2') }, feed('b', true)]
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    expect(readText.mock.calls.map(([link]) => link)).toContain(linkOf('a2'))
    expect(reads.of('a')).toEqual({ events: [], readAt: null, error: "The link can't be read: its server fails (503)", settings: settingsOf('a2') })
    reads.stop()
  })

  it("forgets the titles of a feed whose titles became private when the feeds are listed before it's changed", async () => {
    const reads = reader()
    reads.start()
    await settle()
    // The listing sees the change before the request that made it says so.
    stored = [feed('a', true), feed('b', true)]
    const a = deferred<string>()
    answers.set('a', () => a.promise)
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    expect(reads.of('a')).toMatchObject({ events: [{ title: null }] })
    reads.changed('a', settingsOf('a', true))
    expect(reads.of('a')).toMatchObject({ events: [{ title: null }] })
    reads.stop()
  })

  it('only reads the titles of a feed whose titles stop being private with its next read', async () => {
    const reads = reader()
    reads.start()
    await settle()
    stored = [feed('a'), feed('b')]
    reads.changed('b', { link: linkOf('b'), privateTitles: false })
    expect(reads.of('b')).toMatchObject({ events: [{ title: null }] })
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS)
    expect(reads.of('b')).toMatchObject({ events: [{ title: 'Jane Doe' }] })
    reads.stop()
  })

  it('reads a feed changed while the feeds are listed as it is then', async () => {
    const listed = deferred<StoredFeed[]>()
    list.mockImplementationOnce(() => listed.promise)
    answers.set('a2', calendar(9))
    const reads = reader()
    reads.start()
    await settle()
    reads.changed('a', { link: linkOf('a2'), privateTitles: false })
    listed.resolve([feed('a'), feed('b', true)])
    await settle()
    expect(readText.mock.calls.map(([link]) => link)).toEqual([linkOf('a2'), linkOf('b')])
    expect(reads.of('a')).toMatchObject({ events: [{ start: new Date('2026-12-01T12:00:00Z'), title: 'Réparation' }] })
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
    const adding = reads.read({ name: 'New', link: linkOf('new'), privateTitles: false })
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
