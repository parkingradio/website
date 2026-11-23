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

// What a feed is read with. A read is only kept while its feed still has them, so that what's kept is always that of the
// feed as it is (see "Reading the feeds" in docs/design/server/calendar.md).
export type ReadSettings = Pick<StoredFeed, 'link' | 'privateTitles'>

// What was read from a feed: its events and when, as of the last read that succeeded, or none and null until one does,
// why the last read failed, or null when it succeeded, and what its events were read with.
export type FeedRead = { events: CalendarEvent[]; readAt: Date | null; error: string | null; settings: ReadSettings }

// A feed to read, which has no id yet while it's being added.
export type FeedToRead = Pick<StoredFeed, 'name' | 'link' | 'privateTitles'> & { id?: string }

// A read that succeeded, and what it was made with.
export type SuccessfulRead = { events: CalendarEvent[]; readAt: Date; settings: ReadSettings }

export type CalendarReads = {
  // What was read from the feed `id`, or undefined until a read of it ends.
  of(id: string): FeedRead | undefined
  // Reads the link of a feed that's being added or changed, without keeping what it read. Throws a FeedReadError when it
  // can't be read, or a ReadAborted when the reads stop meanwhile.
  read(feed: FeedToRead): Promise<SuccessfulRead>
  // Keeps what was read from a feed that was just added, which is read again with the others from then on.
  added(id: string, read: SuccessfulRead): void
  // Takes in a feed that was just changed, with `settings` as it has them then, and keeps `read`, the read of its new
  // link, if it was made with them.
  changed(id: string, settings: ReadSettings, read?: SuccessfulRead): void
  // Forgets a feed that was just removed, even if a read of it ends after this.
  removed(id: string): void
  // Reads every feed, then every 15 minutes, until it stops.
  start(): void
  // Stops reading, and cuts short the reads under way, those of the feeds being added or changed included.
  stop(): void
  // Once it's stopped.
  stopped(): Promise<void>
}

const sameSettings = (a: ReadSettings | undefined, b: ReadSettings) => a?.link === b.link && a.privateTitles === b.privateTitles

// What `read` gives of a feed that has `settings`: nothing when it was read from another link, and no titles when they
// became private since.
export function readAsOf(read: FeedRead | undefined, { link, privateTitles }: ReadSettings): FeedRead | undefined {
  if (!read || read.settings.link !== link) return undefined
  if (!privateTitles || read.settings.privateTitles) return read
  return { ...read, events: read.events.map((event) => ({ ...event, title: null })), settings: { link, privateTitles } }
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
  // The feeds whose reads are kept, with what they're read with: those that the latest listing gave, and those added or
  // changed since, as they are since, but not those removed since. A read that ends is only kept if its feed is still one
  // of them, with what it was made with, so that a removed feed's isn't kept again, and one of a link that changed isn't.
  const known = new Map<string, ReadSettings>()
  // The feeds added or changed (as they are then) and removed (null) while a listing is under way, which it may not have
  // seen.
  let listing: Map<string, ReadSettings | null> | null = null
  const stopping = new AbortController()
  let running: Promise<void> = Promise.resolve()

  async function read({ id, name, link, privateTitles }: FeedToRead): Promise<SuccessfulRead> {
    let unexpected: unknown
    try {
      const text = await readText(link, stopping.signal)
      const readAt = new Date()
      const { events, skipped } = await parse({ text, privateTitles, ...keptTime(readAt) }, { signal: stopping.signal })
      if (skipped > 0) log.warn({ feed: id, name, skipped }, "Left out events of a calendar feed that can't be read, or have too many occurrences")
      return { events, readAt, settings: { link, privateTitles } }
    } catch (error) {
      if (error instanceof FeedReadError || error instanceof ReadAborted) throw error
      unexpected = error
    }
    // Neither its message nor its cause are kept, since they could quote what the link gave, e.g. private titles.
    log.error({ feed: id, name, type: unexpected instanceof Error ? unexpected.name : typeof unexpected }, 'Failed to read a calendar feed unexpectedly')
    throw new Error('Failed to read a calendar feed')
  }

  // The feeds, once they're listed.
  async function list(): Promise<StoredFeed[]> {
    listing = new Map()
    try {
      const listed = await feeds.list()
      known.clear()
      for (const { id, link, privateTitles } of listed) known.set(id, { link, privateTitles })
      for (const [id, settings] of listing) {
        if (settings) known.set(id, settings)
        else known.delete(id)
      }
      for (const id of reads.keys()) reconcile(id)
      return listed.filter(({ id }) => known.has(id))
    } finally {
      listing = null
    }
  }

  async function refresh(feed: StoredFeed) {
    const settings = { link: feed.link, privateTitles: feed.privateTitles }
    try {
      const done = await read(feed)
      if (sameSettings(known.get(feed.id), done.settings)) reads.set(feed.id, { ...done, error: null })
    } catch (error) {
      if (error instanceof ReadAborted) return
      const message = error instanceof FeedReadError ? error.message : "The link can't be read: something went wrong"
      log.warn({ feed: feed.id, name: feed.name, error: message }, 'Failed to read a calendar feed')
      // What was read before, which goes with the feed as it is (see `reconcile`).
      const before = reads.get(feed.id)
      if (sameSettings(known.get(feed.id), settings)) reads.set(feed.id, before ? { ...before, error: message } : { events: [], readAt: null, error: message, settings })
    }
  }

  async function readAll() {
    try {
      for (const feed of await list()) {
        if (stopping.signal.aborted) return
        // Unless it was removed meanwhile, and as it is now, in case it was changed during the listing, or since.
        const settings = known.get(feed.id)
        if (settings) await refresh({ ...feed, ...settings })
      }
    } catch (error) {
      log.error({ err: withoutValues(error) }, 'Failed to list the calendar feeds')
    }
  }

  // Makes what was read from the feed `id` go with what `known` has of it, however that changed, e.g. through another
  // server: it's forgotten when the feed was removed, or its link changed, and loses its titles when they became private.
  function reconcile(id: string) {
    const read = reads.get(id)
    const settings = known.get(id)
    const current = settings && readAsOf(read, settings)
    if (!current) reads.delete(id)
    else if (current !== read) reads.set(id, current)
  }

  // Takes in a feed's settings, which a listing under way may not have seen.
  function know(id: string, settings: ReadSettings | null) {
    if (settings) known.set(id, settings)
    else known.delete(id)
    listing?.set(id, settings)
    reconcile(id)
  }

  return {
    of: (id) => reads.get(id),
    read,

    added(id, read) {
      know(id, read.settings)
      reads.set(id, { ...read, error: null })
    },

    changed(id, settings, read) {
      know(id, settings)
      if (read && sameSettings(read.settings, settings)) reads.set(id, { ...read, error: null })
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
