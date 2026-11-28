import type { FastifyBaseLogger } from 'fastify'
import { withoutValues } from '../api/errors.js'
import { pause } from '../core/pause.js'
import { readThrough } from './rotation.js'
import { NO_CREDENTIALS, NoSoundCloudCredentials } from './soundcloud-app.js'
import type { SoundCloudApp } from './soundcloud-app.js'
import { SoundCloudStatusError } from './soundcloud.js'
import type { ReadOutcome, RotationStore, StoredTrackRead } from './rotation-store.js'

// Reads the tracks of the rotation's sets from SoundCloud, and of the sets that can be added to it, and keeps what it read
// (see "Reading the tracks" in docs/design/server/radio.md): every minute, those of the rotation that haven't been read
// through the link their set has, and those whose last read failed, every hour, all of the rotation's, and a set's, when
// it's asked for before it's added. Every server reads them on its own, and they all keep what they read in the same place.

export const CHECK_INTERVAL_MS = 60 * 1000
export const RETRY_AFTER_MS = 60 * 1000
export const READ_AGAIN_AFTER_MS = 60 * 60 * 1000
// How many tracks are read at the same time.
const CONCURRENT_READS = 4

export type TrackReads = {
  // Reads the tracks of the rotation that are due, and resolves once each read has ended, whether it failed or not, or,
  // with `ms`, after `ms` if that comes first, e.g. once the rotation is changed: the reads that haven't ended by then go
  // on, and keep what they read once they do.
  readDue(ms?: number): Promise<void>
  // Reads `track` if it's due, e.g. that of a set that can be added to the rotation, and resolves once the read has ended,
  // or after `ms` if that comes first, like `readDue`.
  readIfDue(track: Track, ms: number): Promise<void>
  // Reads the tracks that are due, then every minute, until it stops.
  start(): void
  // Stops reading, and cuts short the reads under way.
  stop(): void
  // Once it's stopped, and the reads under way have ended.
  stopped(): Promise<void>
}

// A set's track, with the link it has, and what was read of it, if anything.
export type Track = { trackId: string; link: string; read: StoredTrackRead | null }

// Whether `track` is due to be read at `now`: right away when it was never read through its link, a minute after a read
// that failed, and an hour after one that didn't.
function isDue({ link, read }: Track, now: number): boolean {
  const current = readThrough(link, read)
  if (!current) return true
  if (current.state === null || current.error !== null) return current.attemptedAt.getTime() <= now - RETRY_AFTER_MS
  return current.readAt!.getTime() <= now - READ_AGAIN_AFTER_MS
}

// Why a read failed, as it's kept, shown to admins and logged: only the server's own messages, which never quote what
// SoundCloud answered, nor a link, since they could have a private track's secret.
function readError(error: unknown): string {
  if (error instanceof NoSoundCloudCredentials) return NO_CREDENTIALS
  if (error instanceof SoundCloudStatusError) return error.message
  if (error instanceof Error && error.name === 'TimeoutError') return "SoundCloud didn't answer in time"
  return "SoundCloud can't be reached, or answered unexpectedly"
}

type Options = { store: RotationStore; soundcloud: SoundCloudApp; log: FastifyBaseLogger; now?: () => number }

export function trackReads({ store, soundcloud, log, now = Date.now }: Options): TrackReads {
  const stopping = new AbortController()
  // The reads under way, by track and link, which reading the same track again shares.
  const underWay = new Map<string, Promise<void>>()
  let running: Promise<void> = Promise.resolve()

  async function read(trackId: string, link: string) {
    let outcome: ReadOutcome
    try {
      const read = await (await soundcloud.client()).readTrack(link, trackId, stopping.signal)
      if (read.problem) log.warn({ trackId, problem: read.problem }, 'SoundCloud describes a track of a set unexpectedly')
      outcome = { read }
    } catch (error) {
      if (stopping.signal.aborted) return
      outcome = { error: readError(error) }
      // Not the error itself, whose message or cause could quote what SoundCloud answered, or the link.
      log.error({ trackId, error: outcome.error }, 'Failed to read the track of a set from SoundCloud')
    }
    await store.saveRead(trackId, link, outcome, new Date(now()))
  }

  function readShared({ trackId, link }: Track): Promise<void> {
    const key = `${trackId} ${link}`
    let reading = underWay.get(key)
    if (!reading) {
      reading = read(trackId, link)
        // Without the query's values, which have the link, and the secret of a private track.
        .catch((error: unknown) => log.error({ err: withoutValues(error), trackId }, 'Failed to keep what was read of the track of a set'))
        .finally(() => underWay.delete(key))
      underWay.set(key, reading)
    }
    return reading
  }

  // Reads `tracks`, a few at a time, unless it stops meanwhile.
  async function readAll(tracks: Track[]) {
    const queue = [...tracks]
    const worker = async () => {
      for (let track = queue.shift(); track && !stopping.signal.aborted; track = queue.shift()) await readShared(track)
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENT_READS, queue.length) }, worker))
  }

  // Waits for `reading`, which never fails, for up to `ms`: it goes on once the time is up, without anyone waiting for it.
  async function within(reading: Promise<void>, ms: number) {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))
    try {
      await Promise.race([reading, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  const reads: TrackReads = {
    async readDue(ms) {
      const at = now()
      const reading = store.tracks().then((tracks) => readAll(tracks.filter((track) => isDue(track, at))))
      if (ms === undefined) return reading
      return within(
        reading.catch((error: unknown) => log.error({ err: withoutValues(error) }, 'Failed to read the tracks of the rotation')),
        ms,
      )
    },

    async readIfDue(track, ms) {
      if (stopping.signal.aborted || !isDue(track, now())) return
      return within(readShared(track), ms)
    },

    start() {
      running = (async () => {
        while (!stopping.signal.aborted) {
          await reads.readDue().catch((error: unknown) => log.error({ err: withoutValues(error) }, 'Failed to read the tracks of the rotation'))
          await pause(CHECK_INTERVAL_MS, stopping.signal)
        }
      })()
    },

    stop() {
      stopping.abort()
    },

    stopped: async () => {
      await running
      await Promise.all(underWay.values())
    },
  }
  return reads
}
