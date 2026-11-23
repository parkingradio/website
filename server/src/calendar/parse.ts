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
export const PARSE_MAX_MEMORY_MB = 384

export type ToParse = { text: string; kind: FeedKind; from: Date; to: Date }
// What the process sends back: the events, or why the read fails, or the type of an error it didn't expect.
export type ParseResult = { read: { events: CalendarEvent[]; skipped: number } } | { failed: { status: 400 | 502; message: string } } | { unexpected: string }

// The process's module, next to this one: JavaScript in the built server, and TypeScript in development and tests, which
// tsx loads.
const compiled = import.meta.url.endsWith('.js')
const PROCESS = new URL(compiled ? './parse-process.js' : './parse-process.ts', import.meta.url)

// The events of a feed that has `kind`, from its text, that take some of the time from `from` to `to`, as calendarEvents
// gives them. Throws a FeedReadError when the text isn't a calendar, has too many events and occurrences, or takes more
// than PARSE_TIMEOUT_MS or PARSE_MAX_MEMORY_MB to go through, or a ReadAborted when `signal` aborts first. `timeoutMs`
// and `maxMemoryMb` are only for tests.
export function parseFeed(
  toParse: ToParse,
  { signal, timeoutMs = PARSE_TIMEOUT_MS, maxMemoryMb = PARSE_MAX_MEMORY_MB }: { signal?: AbortSignal; timeoutMs?: number; maxMemoryMb?: number } = {},
): Promise<{ events: CalendarEvent[]; skipped: number }> {
  if (signal?.aborted) return Promise.reject(new ReadAborted())
  return new Promise((resolve, reject) => {
    const timeout = AbortSignal.timeout(timeoutMs)
    // The process is killed when either signal aborts, and the error then says why.
    const stopped = () => {
      if (signal?.aborted) return new ReadAborted()
      if (timeout.aborted) return refused(`it takes more than ${PARSE_TIMEOUT_MS / 1000} seconds to go through`)
      return null
    }
    const child = fork(PROCESS, {
      execArgv: [`--max-old-space-size=${maxMemoryMb}`, ...(compiled ? [] : ['--import', 'tsx'])],
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      killSignal: 'SIGKILL',
      // Dates go through as they are.
      serialization: 'advanced',
      // What it could print, e.g. as it runs out of memory, isn't the server's to log.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    // Only the first of these settles the promise: e.g. the process ends once it sent its result.
    child.on('message', (result: ParseResult) => {
      if ('read' in result) resolve(result.read)
      else if ('failed' in result) reject(new FeedReadError(result.failed.status, result.failed.message))
      else {
        const error = new Error('Failed to go through a calendar feed')
        error.name = result.unexpected
        reject(error)
      }
    })
    child.on('error', (error) => reject(stopped() ?? error))
    // V8 aborts a process that runs out of memory.
    child.on('exit', (code, exitSignal) => {
      if (exitSignal === 'SIGABRT') reject(refused(`it takes more than ${PARSE_MAX_MEMORY_MB} MB to go through`))
      else reject(stopped() ?? new Error(`The process that goes through a calendar feed ended (${exitSignal ?? code})`))
    })
    child.send(toParse)
  })
}
