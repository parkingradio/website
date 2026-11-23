import { fork } from 'node:child_process'
import type { CalendarEvent } from './events.js'
import type { FeedKind } from './fields.js'
import { FeedReadError, ReadAborted, refused } from './fetch.js'

// Going through a feed's text for its events, in a process of its own, within a time and a memory limit (see "Reading
// the feeds" in docs/design/server/calendar.md). ical.js can go on without end for some recurring events, e.g. every day
// of February 30, filling its caches as it goes, where the limits on occurrences in events.ts can't stop it. The process
// is killed instead, or dies of running out of memory, which a worker thread can't always do without taking the server
// with it, and the server never waits on it.

export const PARSE_TIMEOUT_MS = 10_000
// The process's heap, which holds what it reads: a calendar of 10 MB with 45,000 events, about as many as a read can go
// through, needs under 128 MB. The process takes more memory than that in all.
export const PARSE_MAX_MEMORY_MB = 192

export type ToParse = { text: string; kind: FeedKind; from: Date; to: Date }
// What the process sends back: the events, or why the read fails, or the type of an error it didn't expect.
export type ParseResult = { read: { events: CalendarEvent[]; skipped: number } } | { failed: { status: 400 | 502; message: string } } | { unexpected: string }

// The process's module, next to this one: JavaScript in the built server, and TypeScript in development and tests, which
// tsx loads, from wherever it's installed rather than from the current directory.
const compiled = import.meta.url.endsWith('.js')
const PROCESS = new URL(compiled ? './parse-process.js' : './parse-process.ts', import.meta.url)

type Options = { signal?: AbortSignal; timeoutMs?: number; maxMemoryMb?: number }
type Outcome<T> = { resolve: (value: T) => void; reject: (reason: unknown) => void }
type Read = { events: CalendarEvent[]; skipped: number }

// The feeds are gone through one at a time, whoever reads them, each once the process of the one before has ended, so
// that there's never more than one process next to the server, with its memory.
let queue: Promise<void> = Promise.resolve()

// The events of a feed that has `kind`, from its text, that take some of the time from `from` to `to`, as calendarEvents
// gives them, once the feeds before it were gone through. Throws a FeedReadError when the text isn't a calendar, has too
// many events and occurrences, or takes more than PARSE_TIMEOUT_MS, or too much memory, to go through, or a ReadAborted
// as soon as `signal` aborts, even while it waits its turn. `timeoutMs` and `maxMemoryMb` are only for tests.
export function parseFeed(toParse: ToParse, options: Options = {}): Promise<Read> {
  const { signal } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ReadAborted())
    const aborted = () => reject(new ReadAborted())
    signal?.addEventListener('abort', aborted, { once: true })
    const turn = queue.then(() => new Promise<void>((ended) => goThrough(toParse, options, { resolve, reject }, ended)))
    queue = turn.catch(() => {})
    turn.catch(reject).finally(() => signal?.removeEventListener('abort', aborted))
  })
}

// Goes through the feed's text in a process of its own, settling `outcome`, and calls `ended` once the process has ended,
// or when there's none, e.g. because the read was stopped while it waited.
function goThrough(toParse: ToParse, { signal, timeoutMs = PARSE_TIMEOUT_MS, maxMemoryMb = PARSE_MAX_MEMORY_MB }: Options, { resolve, reject }: Outcome<Read>, ended: () => void) {
  if (signal?.aborted) return ended()
  const timeout = AbortSignal.timeout(timeoutMs)
  // The process is killed when either signal aborts, and the error then says why.
  const stopped = () => {
    if (signal?.aborted) return new ReadAborted()
    if (timeout.aborted) return refused(`it takes more than ${PARSE_TIMEOUT_MS / 1000} seconds to go through`)
    return null
  }
  const child = fork(PROCESS, {
    execArgv: [`--max-old-space-size=${maxMemoryMb}`, ...(compiled ? [] : ['--import', import.meta.resolve('tsx')])],
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    killSignal: 'SIGKILL',
    // Dates go through as they are.
    serialization: 'advanced',
    // What it could print, e.g. as it runs out of memory, isn't the server's to log.
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  // Only the first of these settles the outcome: e.g. the process ends once it sent its result.
  child.on('message', (result: ParseResult) => {
    if ('read' in result) resolve(result.read)
    else if ('failed' in result) reject(new FeedReadError(result.failed.status, result.failed.message))
    else {
      const error = new Error('Failed to go through a calendar feed')
      error.name = result.unexpected
      reject(error)
    }
  })
  child.on('error', (error) => {
    reject(stopped() ?? error)
    // A process that couldn't be started never ends.
    if (child.pid === undefined) ended()
  })
  // V8 aborts a process that runs out of memory.
  child.on('exit', (code, exitSignal) => {
    if (exitSignal === 'SIGABRT') reject(refused('it takes too much memory to go through'))
    else reject(stopped() ?? new Error(`The process that goes through a calendar feed ended (${exitSignal ?? code})`))
    ended()
  })
  child.send(toParse)
}
