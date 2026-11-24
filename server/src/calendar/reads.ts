import type { FastifyBaseLogger } from 'fastify'
import { withoutValues } from '../api/errors.js'
import { keptTime } from './events.js'
import type { CalendarEvent } from './events.js'
import type { CalendarFeedsStore, StoredFeed } from './feeds.js'
import { FeedReadError, ReadAborted, readLink } from './fetch.js'
import { parseFeed } from './parse.js'

// What the server read from the calendar feeds, which it keeps in memory, and reads again every 15 minutes (see
// "Reading the feeds" in docs/design/server/calendar.md). Every server reads them on its own.
//
// Neither the links nor what's in the feeds are ever logged: a failed read logs the feed's id and name, and the server's
// own message.

export const READ_INTERVAL_MS = 15 * 60 * 1000

// What was read from a feed: its events and when, as of the last read that succeeded, or none and null until one does,
// why the last read failed, or null when it succeeded, and the link its events were read from. A read is only kept while
// its feed still has that link, so that what's kept is always that of the feed as it is (see "Reading the feeds" in
// docs/design/server/calendar.md).
export type FeedRead = { events: CalendarEvent[]; readAt: Date | null; error: string | null; link: string }

// A feed to read, which has no id yet while it's being added.
export type FeedToRead = Pick<StoredFeed, 'name' | 'link'> & { id?: string }

// A read that succeeded, and the link it was made from.
export type SuccessfulRead = { events: CalendarEvent[]; readAt: Date; link: string }

export type CalendarReads = {
  // What was read from the feed `id`, or undefined until a read of it ends.
  of(id: string): FeedRead | undefined
  // Reads the link of a feed that's being added or changed, without keeping what it read. Throws a FeedReadError when it
  // can't be read, or a ReadAborted when the reads stop meanwhile.
  read(feed: FeedToRead): Promise<SuccessfulRead>
  // Keeps what was read from a feed that was just added, which is read again with the others from then on.
  added(id: string, read: SuccessfulRead): void
  // Takes in a feed that was just changed, with `link` as it has it then, and keeps `read`, the read of its new link, if
  // it was given a new one.
  changed(id: string, link: string, read?: SuccessfulRead): void
  // Forgets a feed that was just removed, even if a read of it ends after this.
  removed(id: string): void
  // Reads every feed, then every 15 minutes, until it stops.
  start(): void
  // Stops reading, and cuts short the reads under way, those of the feeds being added or changed included.
  stop(): void
  // Once it's stopped.
  stopped(): Promise<void>
}

type Options = {
  feeds: CalendarFeedsStore
  log: FastifyBaseLogger
  // Reads a link, as readLink does, and goes through its text, as parseFeed does, but for tests.
  readText?: (link: string, signal: AbortSignal) => Promise<string>
  parse?: typeof parseFeed
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

export function calendarReads({ feeds, log, readText = (link, signal) => readLink(link, { signal }), parse = parseFeed }: Options): CalendarReads {
  // What was read from the feeds, which always goes with what `known` has of them (see `reconcile`).
  const reads = new Map<string, FeedRead>()
  // The feeds whose reads are kept, with their links: those that the latest listing gave, and those added or changed
  // since, as they are since, but not those removed since. A read that ends is only kept if its feed is still one of them,
  // with the link it was made from, so that a removed feed's isn't kept again, and one of a link that changed isn't.
  const known = new Map<string, string>()
  // The feeds added or changed (with their links then) and removed (null) while a listing is under way, which it may not
  // have seen.
  let listing: Map<string, string | null> | null = null
  const stopping = new AbortController()
  let running: Promise<void> = Promise.resolve()

  async function read({ id, name, link }: FeedToRead): Promise<SuccessfulRead> {
    let unexpected: unknown
    try {
      const text = await readText(link, stopping.signal)
      const readAt = new Date()
      const { events, skipped } = await parse({ text, ...keptTime(readAt) }, { signal: stopping.signal })
      if (skipped > 0) log.warn({ feed: id, name, skipped }, "Left out events of a calendar feed that can't be read, or have too many occurrences")
      return { events, readAt, link }
    } catch (error) {
      if (error instanceof FeedReadError || error instanceof ReadAborted) throw error
      unexpected = error
    }
    // Neither its message nor its cause are kept, since they could quote what the link gave.
    log.error({ feed: id, name, type: unexpected instanceof Error ? unexpected.name : typeof unexpected }, 'Failed to read a calendar feed unexpectedly')
    throw new Error('Failed to read a calendar feed')
  }

  // The feeds, once they're listed.
  async function list(): Promise<StoredFeed[]> {
    listing = new Map()
    try {
      const listed = await feeds.list()
      known.clear()
      for (const { id, link } of listed) known.set(id, link)
      for (const [id, link] of listing) {
        if (link !== null) known.set(id, link)
        else known.delete(id)
      }
      for (const id of reads.keys()) reconcile(id)
      return listed.filter(({ id }) => known.has(id))
    } finally {
      listing = null
    }
  }

  async function refresh(feed: StoredFeed) {
    // Whether the feed still has the link it's read from, unless it was removed, or its link changed, meanwhile.
    const current = () => known.get(feed.id) === feed.link
    try {
      const done = await read(feed)
      if (current()) reads.set(feed.id, { ...done, error: null })
    } catch (error) {
      if (error instanceof ReadAborted) return
      const message = error instanceof FeedReadError ? error.message : "The link can't be read: something went wrong"
      log.warn({ feed: feed.id, name: feed.name, error: message }, 'Failed to read a calendar feed')
      // What was read before, which goes with the feed as it is (see `reconcile`).
      const before = reads.get(feed.id)
      if (current()) reads.set(feed.id, before ? { ...before, error: message } : { events: [], readAt: null, error: message, link: feed.link })
    }
  }

  async function readAll() {
    try {
      for (const feed of await list()) {
        if (stopping.signal.aborted) return
        // Unless it was removed meanwhile, and with its link as it is now, in case it was changed during the listing, or
        // since.
        const link = known.get(feed.id)
        if (link !== undefined) await refresh({ ...feed, link })
      }
    } catch (error) {
      log.error({ err: withoutValues(error) }, 'Failed to list the calendar feeds')
    }
  }

  // Makes what was read from the feed `id` go with what `known` has of it, however that changed, e.g. through another
  // server: it's forgotten when the feed was removed, or its link changed.
  function reconcile(id: string) {
    if (reads.get(id)?.link !== known.get(id)) reads.delete(id)
  }

  // Takes in a feed's link, or null when it was removed, which a listing under way may not have seen.
  function know(id: string, link: string | null) {
    if (link !== null) known.set(id, link)
    else known.delete(id)
    listing?.set(id, link)
    reconcile(id)
  }

  return {
    of: (id) => reads.get(id),
    read,

    added(id, read) {
      know(id, read.link)
      reads.set(id, { ...read, error: null })
    },

    changed(id, link, read) {
      know(id, link)
      if (read) reads.set(id, { ...read, error: null })
    },

    removed(id) {
      know(id, null)
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
