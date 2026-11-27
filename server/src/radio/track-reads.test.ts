import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { FastifyBaseLogger } from 'fastify'
import { NO_CREDENTIALS, NoSoundCloudCredentials } from './soundcloud-app.js'
import type { SoundCloudApp } from './soundcloud-app.js'
import { SoundCloudStatusError } from './soundcloud.js'
import type { SoundCloudClient, TrackRead } from './soundcloud.js'
import type { ReadOutcome, RotationStore, StoredTrackRead } from './rotation-store.js'
import { READ_AGAIN_AFTER_MS, RETRY_AFTER_MS, trackReads } from './track-reads.js'

// Reading the tracks of the rotation of sets (see "Reading the tracks" in docs/design/server/radio.md), with a store and a
// SoundCloud app of their own.

const NOW = Date.parse('2026-11-27T12:00:00Z')
const LINK = 'https://soundcloud.com/parkingdotradio/3tons/s-SeCrEt42'
const PLAYABLE: TrackRead = { state: 'playable', durationMs: 3_600_000, secretToken: 's-SeCrEt42' }

function stored(fields: Partial<StoredTrackRead> = {}): StoredTrackRead {
  const at = new Date(NOW - 1000)
  return { trackId: '1', link: LINK, state: 'playable', durationMs: 3_600_000, secretToken: null, readAt: at, attemptedAt: at, error: null, ...fields }
}

function setUp({ reads = [] as (StoredTrackRead | null)[], entered = true } = {}) {
  const readTrack = vi.fn<SoundCloudClient['readTrack']>(async () => PLAYABLE)
  const client = { readTrack } as unknown as SoundCloudClient
  const soundcloud = {
    client: async () => {
      if (!entered) throw new NoSoundCloudCredentials()
      return client
    },
  } as unknown as SoundCloudApp
  const saved: { trackId: string; link: string; outcome: ReadOutcome }[] = []
  const store = {
    tracks: async () => reads.map((read, i) => ({ trackId: String(i + 1), link: LINK, read: read && { ...read, trackId: String(i + 1) } })),
    saveRead: async (trackId: string, link: string, outcome: ReadOutcome) => void saved.push({ trackId, link, outcome }),
  } as unknown as RotationStore
  const lines: string[] = []
  const log = pino({}, { write: (line: string) => lines.push(line) }) as unknown as FastifyBaseLogger
  return { reads: trackReads({ store, soundcloud, log, now: () => NOW }), readTrack, saved, lines }
}

describe('reading the tracks of the rotation', () => {
  it('reads those that are due: unread, failed a minute ago, or read an hour ago', async () => {
    const { reads, readTrack, saved } = setUp({
      reads: [
        null,
        stored({ link: 'https://soundcloud.com/parkingdotradio/before' }),
        stored({ state: null, error: 'x', attemptedAt: new Date(NOW - RETRY_AFTER_MS) }),
        stored({ state: null, error: 'x', attemptedAt: new Date(NOW - RETRY_AFTER_MS + 1) }),
        stored({ error: 'x', attemptedAt: new Date(NOW - RETRY_AFTER_MS) }),
        stored({ readAt: new Date(NOW - READ_AGAIN_AFTER_MS) }),
        stored({ readAt: new Date(NOW - READ_AGAIN_AFTER_MS + 1) }),
      ],
    })
    await reads.readDue()
    expect(readTrack.mock.calls.map(([link, trackId]) => [link, trackId])).toEqual(['1', '2', '3', '5', '6'].map((id) => [LINK, id]))
    expect(saved.map(({ trackId }) => trackId).sort()).toEqual(['1', '2', '3', '5', '6'])
    expect(saved[0].outcome).toEqual({ read: PLAYABLE })
  })

  it('reads those that are due once the rotation changes, an old read of a set added again included', async () => {
    const { reads, readTrack } = setUp({
      reads: [null, stored(), stored({ readAt: new Date(NOW - READ_AGAIN_AFTER_MS) }), stored({ state: null, error: 'x', attemptedAt: new Date(NOW - 1000) })],
    })
    await reads.readDue(1000)
    expect(readTrack.mock.calls.map(([, trackId]) => trackId)).toEqual(['1', '3'])
  })

  it('keeps why a read failed, as its own message, without what SoundCloud answered, nor the secret', async () => {
    const { reads, readTrack, saved, lines } = setUp({ reads: [null, null, null] })
    readTrack
      .mockRejectedValueOnce(new SoundCloudStatusError('SoundCloud responded to /tracks/soundcloud:tracks:1 with 503', 503))
      .mockRejectedValueOnce(new Error(`Unexpected SoundCloud answer: {"secret_uri": "${LINK}"}`))
      .mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    await reads.readDue()
    expect(saved.map(({ outcome }) => outcome).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([
      { error: "SoundCloud can't be reached, or answered unexpectedly" },
      { error: "SoundCloud didn't answer in time" },
      { error: 'SoundCloud responded to /tracks/soundcloud:tracks:1 with 503' },
    ])
    expect(lines.join('\n')).not.toContain('SeCrEt')
  })

  it('logs what was unexpected about a track, which never quotes its values', async () => {
    const { reads, readTrack, saved, lines } = setUp({ reads: [null] })
    readTrack.mockResolvedValue({ state: 'unexpected', durationMs: null, secretToken: null, problem: '✖ Invalid option → at access' })
    await reads.readDue()
    expect(saved[0].outcome).toMatchObject({ read: { state: 'unexpected' } })
    expect(lines.join('\n')).toContain('Invalid option')
  })

  it('keeps that the credentials of the SoundCloud app have not been entered yet', async () => {
    const { reads, readTrack, saved } = setUp({ reads: [null], entered: false })
    await reads.readDue()
    expect(readTrack).not.toHaveBeenCalled()
    expect(saved).toEqual([{ trackId: '1', link: LINK, outcome: { error: NO_CREDENTIALS } }])
  })

  it('responds once the time is up, while the reads go on and keep what they read once they end', async () => {
    const { reads, readTrack, saved } = setUp({ reads: [null] })
    let answer!: (read: TrackRead) => void
    readTrack.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    await reads.readDue(10)
    expect(saved).toEqual([])
    // Reading it again meanwhile shares the read under way.
    const again = reads.readDue()
    answer(PLAYABLE)
    await again
    expect(readTrack).toHaveBeenCalledTimes(1)
    expect(saved).toEqual([{ trackId: '1', link: LINK, outcome: { read: PLAYABLE } }])
  })

  it('stops reading, and cuts short the reads under way', async () => {
    const { reads, readTrack, saved } = setUp({ reads: [null, null, null, null, null, null] })
    readTrack.mockImplementation(
      (_link, _id, signal) => new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    )
    reads.start()
    await vi.waitFor(() => expect(readTrack).toHaveBeenCalledTimes(4))
    reads.stop()
    await reads.stopped()
    // The reads that were cut short keep nothing, and the others never start.
    expect(saved).toEqual([])
    expect(readTrack).toHaveBeenCalledTimes(4)
  })
})
