import type { FastifyBaseLogger } from 'fastify'
import { withoutValues } from '../api/errors.js'
import { calendarEvents, keptTime } from './events.js'
import type { CalendarEvent } from './events.js'
import type { CalendarFeedsStore, StoredFeed } from './feeds.js'
import { FeedReadError, ReadAborted, readLink } from './fetch.js'

// What the server read from the calendar feeds, which it keeps in memory, and reads again every 15 minutes (see
// "Reading the feeds" in docs/design/server/calendar.md). Every server reads them on its own.
//
// Neither the links nor what's in the feeds are ever logged: a failed read logs the feed's id and name, and the server's
// own message.

export const READ_INTERVAL_MS = 15 * 60 * 1000

// What was read from a feed: its events and when, as of the last read that succeeded, or none and null until one does,
// and why the last read failed, or null when it succeeded.
export type FeedRead = { events: CalendarEvent[]; readAt: Date | null; error: string | null }

// A feed to read, which has no id yet while it's being added.
type FeedToRead = Pick<StoredFeed, 'name' | 'kind' | 'link'> & { id?: string }

// A read that succeeded.
export type SuccessfulRead = { events: CalendarEvent[]; readAt: Date }

export type CalendarReads = {
  // What was read from the feed `id`, or undefined until a read of it ends.
  of(id: string): FeedRead | undefined
  // Reads the link of a feed that's being added, without keeping what it read. Throws a FeedReadError when it can't be
  // read, or a ReadAborted when the reads stop meanwhile.
  read(feed: FeedToRead): Promise<SuccessfulRead>
  // Keeps what was read from a feed that was just added, which is read again with the others from then on.
  added(id: string, read: SuccessfulRead): void
  // Forgets a feed that was just removed, even if a read of it ends after this.
  removed(id: string): void
  // Reads every feed, then every 15 minutes, until it stops.
  start(): void
  // Stops reading, and cuts short the reads under way, those of the feeds being added included.
  stop(): void
  // Once it's stopped.
  stopped(): Promise<void>
}

type Options = {
  feeds: CalendarFeedsStore
  log: FastifyBaseLogger
  // Reads a link, as readLink does, but for tests.
  readText?: (link: string, signal: AbortSignal) => Promise<string>
}

// Waits `ms`, or until `signal` aborts, without keeping the process alive.
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    timer.unref?.()
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}

export function calendarReads({ feeds, log, readText = (link, signal) => readLink(link, { signal }) }: Options): CalendarReads {
  const reads = new Map<string, FeedRead>()
  // The feeds whose reads are kept: those that the latest listing gave, and those added since, but not those removed
  // since. A read that ends is only kept if its feed is still one of them, so that a removed feed's isn't kept again.
  const known = new Set<string>()
  // The feeds added (true) and removed (false) while a listing is under way, which it may not have seen.
  let listing: Map<string, boolean> | null = null
  const stopping = new AbortController()
  let running: Promise<void> = Promise.resolve()

  async function read({ id, name, kind, link }: FeedToRead): Promise<SuccessfulRead> {
    let unexpected: unknown
    try {
      const text = await readText(link, stopping.signal)
      const readAt = new Date()
      const { events, skipped } = calendarEvents(text, kind, keptTime(readAt))
      if (skipped > 0) log.warn({ feed: id, name, skipped }, "Left out events of a calendar feed that can't be read, or have too many occurrences")
      return { events, readAt }
    } catch (error) {
      if (error instanceof FeedReadError || error instanceof ReadAborted) throw error
      unexpected = error
    }
    // Neither its message nor its cause are kept, since they could quote what the link gave, e.g. the titles of quiet
    // time's events.
    log.error({ feed: id, name, type: unexpected instanceof Error ? unexpected.name : typeof unexpected }, 'Failed to read a calendar feed unexpectedly')
    throw new Error('Failed to read a calendar feed')
  }

  // The feeds, as they are once they're listed.
  async function list(): Promise<StoredFeed[]> {
    listing = new Map()
    try {
      const listed = await feeds.list()
      known.clear()
      for (const { id } of listed) known.add(id)
      for (const [id, kept] of listing) {
        if (kept) known.add(id)
        else known.delete(id)
      }
      for (const id of reads.keys()) if (!known.has(id)) reads.delete(id)
      return listed.filter(({ id }) => known.has(id))
    } finally {
      listing = null
    }
  }

  async function refresh(feed: StoredFeed) {
    try {
      const { events, readAt } = await read(feed)
      if (known.has(feed.id)) reads.set(feed.id, { events, readAt, error: null })
    } catch (error) {
      if (error instanceof ReadAborted) return
      const message = error instanceof FeedReadError ? error.message : "The link can't be read: something went wrong"
      log.warn({ feed: feed.id, name: feed.name, error: message }, 'Failed to read a calendar feed')
      const before = reads.get(feed.id)
      if (known.has(feed.id)) reads.set(feed.id, { events: before?.events ?? [], readAt: before?.readAt ?? null, error: message })
    }
  }

  async function readAll() {
    try {
      for (const feed of await list()) {
        if (stopping.signal.aborted) return
        // Unless it was removed meanwhile.
        if (known.has(feed.id)) await refresh(feed)
      }
    } catch (error) {
      log.error({ err: withoutValues(error) }, 'Failed to list the calendar feeds')
    }
  }

  return {
    of: (id) => reads.get(id),
    read,

    added(id, { events, readAt }) {
      known.add(id)
      listing?.set(id, true)
      reads.set(id, { events, readAt, error: null })
    },

    removed(id) {
      known.delete(id)
      listing?.set(id, false)
      reads.delete(id)
    },

    start() {
      running = (async () => {
        while (!stopping.signal.aborted) {
          await readAll()
          await pause(READ_INTERVAL_MS, stopping.signal)
        }
      })()
    },

    stop() {
      stopping.abort()
    },

    stopped: () => running,
  }
}
