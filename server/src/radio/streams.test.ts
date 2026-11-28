import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HlsStream, SoundCloudClient } from './soundcloud.js'
import { trackStreams } from './streams.js'
import type { StreamsByClient } from './streams.js'

// Where to stream tracks from: what's kept of each track's stream, and for how long.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

function setUp() {
  let n = 0
  // A stream that lasts two hours, a new one each time it's asked for.
  const hlsStream = vi.fn(async (): Promise<HlsStream> => ({ url: `https://cdn.test/${++n}.m3u8`, expiresAt: Date.now() + 2 * HOUR }))
  const client = { hlsStream } as unknown as SoundCloudClient
  const kept: StreamsByClient = new WeakMap()
  const streams = trackStreams(kept)
  return { hlsStream, stream: () => streams(client, '1', 's-SeCrEt'), keys: () => [...(kept.get(client)?.keys() ?? [])] }
}

describe('the streams of tracks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('forgets a stream, and its secret, once it expires, and gets a new one the next time it is asked for', async () => {
    const { hlsStream, stream, keys } = setUp()
    const first = await stream()
    await vi.advanceTimersByTimeAsync(29 * MINUTE)
    expect(await stream()).toEqual(first)
    expect(keys()).toEqual(['1 s-SeCrEt'])

    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(keys()).toEqual([])
    expect(await stream()).not.toEqual(first)
    expect(hlsStream).toHaveBeenCalledTimes(2)
  })

  it('keeps a failure for 30 seconds, then forgets it, and asks again the next time', async () => {
    const { hlsStream, stream, keys } = setUp()
    hlsStream.mockRejectedValueOnce(new Error('SoundCloud is down'))
    await expect(stream()).rejects.toThrow('SoundCloud is down')
    await vi.advanceTimersByTimeAsync(29 * 1000)
    await expect(stream()).rejects.toThrow('SoundCloud is down')
    expect(hlsStream).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(keys()).toEqual([])
    await expect(stream()).resolves.toMatchObject({ url: expect.any(String) })
    expect(hlsStream).toHaveBeenCalledTimes(2)
  })
})
