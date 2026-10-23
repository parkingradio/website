import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { RadioTrack } from 'shared/radio'
import App from '../app'
import { mockFetch, requestsTo } from '../test-utils'
import type { Body } from '../test-utils'
import { positionAt, rediffusion, untilEnd } from './radio'
import { loadVolume, toggledMute } from './volume'

// A stand-in for hls.js, for browsers that don't play HLS themselves: the instances the player creates are kept in
// `hlsInstances`, newest last.
type FakeHls = {
  config: { startPosition: number }
  source: string | null
  media: HTMLMediaElement | null
  destroyed: boolean
  // Reports a fatal error, like hls.js does when the stream can't be played anymore.
  fail: () => void
}
const { hlsInstances } = vi.hoisted(() => ({ hlsInstances: [] as FakeHls[] }))
vi.mock('hls.js/light', () => {
  class Hls implements FakeHls {
    static Events = { ERROR: 'hlsError' }
    source: string | null = null
    media: HTMLMediaElement | null = null
    destroyed = false
    private onError: ((event: string, data: { fatal: boolean }) => void) | null = null
    config: { startPosition: number }
    constructor(config: { startPosition: number }) {
      this.config = config
      hlsInstances.push(this)
    }
    on(_event: string, handler: (event: string, data: { fatal: boolean }) => void) {
      this.onError = handler
    }
    loadSource(url: string) {
      this.source = url
    }
    attachMedia(media: HTMLMediaElement) {
      this.media = media
    }
    destroy() {
      this.destroyed = true
    }
    fail() {
      this.onError?.('hlsError', { fatal: true })
    }
  }
  return { default: Hls }
})

const KRAKA: RadioTrack = {
  id: '1',
  artist: 'KRAKA',
  event: 'HAUTE RIVE TAKEOVER',
  date: '2026-04-19',
  durationMs: 60 * 60 * 1000,
  url: 'https://soundcloud.com/parkingdotradio/kraka',
}
const NEBULO: RadioTrack = { ...KRAKA, id: '2', artist: 'NEBULO', event: null }

const RADIO_URL = '/api/radio?upcoming=0'
const IN_AN_HOUR = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

// What's on air: `track`, which started `secondsAgo` seconds ago.
function onAir(track: RadioTrack, secondsAgo: number) {
  return { ok: true, current: { track, startedAt: new Date(Date.now() - secondsAgo * 1000).toISOString() }, upcoming: [] }
}

function streamOf(track: RadioTrack) {
  return { [`/api/radio/tracks/${track.id}/stream`]: { ok: true, url: `https://cdn.test/${track.id}.m3u8`, expiresAt: IN_AN_HOUR() } }
}

function mockSite({ player = true, radio = onAir(KRAKA, 60) }: { player?: boolean; radio?: Body } = {}) {
  mockFetch({
    '/api/config': { ok: true, assetsDomain: 'assets.example.test', turnstileSiteKey: 'key', features: { 'nouveau-lecteur': player } },
    [RADIO_URL]: radio,
    ...streamOf(KRAKA),
    ...streamOf(NEBULO),
  })
}

function renderSite() {
  render(
    <MemoryRouter initialEntries={['/contribuer']}>
      <App />
    </MemoryRouter>,
  )
}

// Presses the bar's play button, once the bar shows.
async function startRadio() {
  fireEvent.click(await screen.findByRole('button', { name: 'écouter la radio en ondes' }))
}

// Has the audio element the player plays through report `type`, e.g. that the track ended.
function fire(type: string) {
  act(() => {
    audio()!.dispatchEvent(new Event(type))
  })
}

// Checks that `seconds` is where KRAKA is at: it started a minute ago, as `mockSite` has it by default.
function expectAMinuteIn(seconds: number | null) {
  expect(seconds).toBeGreaterThanOrEqual(60)
  expect(seconds).toBeLessThan(65)
}

// jsdom doesn't play media: the audio element the player plays through is the one it last asked to play, and where it
// was asked to seek is recorded.
let play: MockInstance<HTMLMediaElement['play']>
const audio = () => play.mock.contexts.at(-1) as HTMLMediaElement | undefined
let seekedTo: number | null
beforeEach(() => {
  seekedTo = null
  hlsInstances.length = 0
  localStorage.clear()
  // Plays HLS itself, like Safari, so that hls.js isn't needed.
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe')
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation((time: number) => {
    seekedTo = time
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  // Unmounting stops the player, which pauses the audio element: it has to happen while that's still mocked.
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the player', () => {
  it("doesn't show, or ask what's on air, while its feature flag is off", async () => {
    mockSite({ player: false })
    renderSite()
    await waitFor(() => expect(requestsTo('GET', '/api/config')).toHaveLength(1))
    expect(screen.queryByRole('region', { name: 'lecteur' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /en ondes/ })).not.toBeInTheDocument()
    expect(requestsTo('GET', RADIO_URL)).toHaveLength(0)
  })

  it("shows what's on air at the bottom of the page, and in the navigation bar", async () => {
    mockSite()
    renderSite()
    const bar = await screen.findByRole('region', { name: 'lecteur' })
    expect(bar).toHaveTextContent('en ondes')
    expect(bar).toHaveTextContent('KRAKA')
    expect(bar).toHaveTextContent('HAUTE RIVE TAKEOVER')
    expect(bar).toHaveTextContent('rediffusion · 19 avril 2026')
    expect(screen.getByRole('button', { name: 'en ondes · kraka' })).toHaveAttribute('aria-pressed', 'false')
  })

  it("says the radio is off air when what's on air can't be known", async () => {
    mockSite({ radio: { ok: false, error: 'No playlist has been chosen for the radio yet' } })
    renderSite()
    expect(await screen.findByRole('button', { name: 'hors ondes' })).toBeDisabled()
    expect(screen.queryByRole('region', { name: 'lecteur' })).not.toBeInTheDocument()
  })

  it("plays the radio from where it's at, pauses it, and plays it again where it's at by then", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockSite()
    renderSite()
    await startRadio()

    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))
    fire('loadedmetadata')
    fire('playing')
    expectAMinuteIn(seekedTo)
    expect(screen.getByRole('button', { name: 'en ondes · kraka' })).toHaveAttribute('aria-pressed', 'true')

    // Pausing keeps the stream.
    fireEvent.click(screen.getByRole('button', { name: 'pause' }))
    expect(audio()!.src).toBe('https://cdn.test/1.m3u8')
    expect(screen.getByRole('button', { name: 'en ondes · kraka' })).toHaveAttribute('aria-pressed', 'false')

    // Playing again half a minute later goes on with it, half a minute further.
    await act(() => vi.advanceTimersByTimeAsync(30 * 1000))
    fireEvent.click(screen.getByRole('button', { name: 'écouter la radio en ondes' }))
    expect(seekedTo).toBeGreaterThanOrEqual(90)
    expect(play).toHaveBeenCalledTimes(2)
    expect(requestsTo('GET', '/api/radio/tracks/1/stream')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'pause' })).toBeInTheDocument()
  })

  it("plays what's on air when the track it paused has ended", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockSite({ radio: onAir(KRAKA, 60 * 60 - 2) })
    renderSite()
    await startRadio()
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))
    fire('playing')
    fireEvent.click(screen.getByRole('button', { name: 'pause' }))

    mockSite({ radio: onAir(NEBULO, 0) })
    await act(() => vi.advanceTimersByTimeAsync(3500))
    await waitFor(() => expect(screen.getByRole('region', { name: 'lecteur' })).toHaveTextContent('NEBULO'))
    fireEvent.click(screen.getByRole('button', { name: 'écouter la radio en ondes' }))
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/2.m3u8'))
  })

  it("doesn't play again a stream that stopped working while it was paused", async () => {
    mockSite()
    renderSite()
    await startRadio()
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))
    fire('playing')
    fireEvent.click(screen.getByRole('button', { name: 'pause' }))
    fire('error')
    expect(audio()!.hasAttribute('src')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'écouter la radio en ondes' }))
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))
    fire('loadedmetadata')
    expectAMinuteIn(seekedTo)
  })

  it("goes on with what's on air next when a track ends", async () => {
    mockSite()
    renderSite()
    fireEvent.click(await screen.findByRole('button', { name: 'en ondes · kraka' }))
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))

    mockSite({ radio: onAir(NEBULO, 1) })
    fire('ended')
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/2.m3u8'))
    expect(screen.getByRole('region', { name: 'lecteur' })).toHaveTextContent('NEBULO')
    expect(screen.getByRole('button', { name: 'pause' })).toBeInTheDocument()
  })

  it("plays through hls.js where the browser doesn't play HLS itself", async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('')
    mockSite()
    renderSite()
    await startRadio()

    await waitFor(() => expect(hlsInstances).toHaveLength(1))
    const [hls] = hlsInstances
    expect(hls.source).toBe('https://cdn.test/1.m3u8')
    expect(hls.media).toBe(audio())
    expectAMinuteIn(hls.config.startPosition)

    // A stream that stops working is asked for again.
    act(() => hls.fail())
    await waitFor(() => expect(hlsInstances).toHaveLength(2))
    expect(hls.destroyed).toBe(true)
    expect(requestsTo('GET', '/api/radio/tracks/1/stream')).toHaveLength(2)

    // Pausing keeps the stream.
    fireEvent.click(screen.getByRole('button', { name: 'pause' }))
    expect(hlsInstances[1].destroyed).toBe(false)
  })

  it('asks for a stream again when it stops working, and stops when it keeps failing', async () => {
    mockSite()
    renderSite()
    await startRadio()
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))
    fire('playing')

    // After the first failure, the stream is asked for again, and played from where the radio is at. Dropping the one
    // that failed pauses the element, which isn't taken for a pause from elsewhere.
    mockSite()
    fire('error')
    fire('pause')
    await waitFor(() => expect(requestsTo('GET', '/api/radio/tracks/1/stream')).toHaveLength(1))
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2))
    fire('loadedmetadata')
    expectAMinuteIn(seekedTo)

    // Once it failed again and again without playing in between, the player gives up.
    fire('error')
    await waitFor(() => expect(play).toHaveBeenCalledTimes(3))
    fire('error')
    expect(await screen.findByRole('button', { name: 'écouter la radio en ondes' })).toBeInTheDocument()
    expect(play).toHaveBeenCalledTimes(3)
  })

  it('stops when the browser refuses to play', async () => {
    play.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))
    mockSite()
    renderSite()
    await startRadio()
    await waitFor(() => expect(play).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'écouter la radio en ondes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'en ondes · kraka' })).toHaveAttribute('aria-pressed', 'false')
  })

  it("waits for the server to move along when a track ends before it has, and isn't thrown off by a stop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // KRAKA ends in 2 seconds, as far as the server knows.
    const ending = onAir(KRAKA, 60 * 60 - 2)
    mockSite({ radio: ending })
    renderSite()
    await startRadio()
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))

    // The track ends a little early: the server still has it on air, so the player asks again once it's over.
    fire('ended')
    await waitFor(() => expect(requestsTo('GET', RADIO_URL)).toHaveLength(2))
    // A short set, so that it can end a little early too.
    const nebulo = onAir({ ...NEBULO, durationMs: 10 * 1000 }, 0)
    mockSite({ radio: nebulo })
    await act(() => vi.advanceTimersByTimeAsync(3500))
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/2.m3u8'))

    // Stopping and playing again while the player waits for the server plays what's on air then, i.e. the end of NEBULO,
    // and the wait is dropped: it doesn't cut NEBULO short when the wait is over.
    fire('ended')
    await act(() => vi.advanceTimersByTimeAsync(10))
    fireEvent.click(screen.getByRole('button', { name: 'pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'écouter la radio en ondes' }))
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/2.m3u8'))
    const plays = play.mock.calls.length
    mockSite({ radio: onAir(KRAKA, 0) })
    await act(() => vi.advanceTimersByTimeAsync(8000))
    expect(audio()?.src).toBe('https://cdn.test/2.m3u8')
    expect(play).toHaveBeenCalledTimes(plays)
  })

  it("keeps playing its track until it ends, even once something else is on air", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockSite({ radio: onAir(KRAKA, 60 * 60 - 2) })
    renderSite()
    await startRadio()
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))

    // The server moves along before KRAKA is over for this listener, e.g. because its sound took a while to arrive.
    mockSite({ radio: onAir(NEBULO, 0) })
    await act(() => vi.advanceTimersByTimeAsync(3500))
    await waitFor(() => expect(requestsTo('GET', RADIO_URL)).toHaveLength(1))
    expect(audio()?.src).toBe('https://cdn.test/1.m3u8')
    expect(screen.getByRole('region', { name: 'lecteur' })).toHaveTextContent('KRAKA')
    expect(screen.getByRole('button', { name: 'en ondes · kraka' })).toHaveAttribute('aria-pressed', 'true')

    fire('ended')
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/2.m3u8'))
    expect(screen.getByRole('region', { name: 'lecteur' })).toHaveTextContent('NEBULO')
  })

  it('pauses when something else pauses it, e.g. AirPods taken out, and plays again when the system plays it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockSite()
    renderSite()
    await startRadio()
    await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))
    fire('playing')

    fire('pause')
    expect(screen.getByRole('button', { name: 'écouter la radio en ondes' })).toBeInTheDocument()
    expect(audio()!.src).toBe('https://cdn.test/1.m3u8')

    // The system plays the element again itself, from where it was paused: it catches up with the radio.
    await act(() => vi.advanceTimersByTimeAsync(30 * 1000))
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false)
    fire('play')
    expect(screen.getByRole('button', { name: 'pause' })).toBeInTheDocument()
    expect(seekedTo).toBeGreaterThanOrEqual(90)
    expect(screen.getByRole('region', { name: 'lecteur' })).not.toHaveClass('loading')
  })

  it("is played and paused from the system's media controls, which show what plays", async () => {
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>> = {}
    const session = {
      metadata: null as { title: string } | null,
      playbackState: 'none',
      setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        handlers[action] = handler
      },
    }
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true })
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(init: object) {
          Object.assign(this, init)
        }
      },
    )
    try {
      mockSite()
      renderSite()
      await screen.findByRole('region', { name: 'lecteur' })

      act(() => handlers.play!({ action: 'play' }))
      await waitFor(() => expect(audio()?.src).toBe('https://cdn.test/1.m3u8'))
      fire('playing')
      expect(session.metadata?.title).toBe('KRAKA')
      expect(session.playbackState).toBe('playing')
      // Playing what already plays does nothing.
      act(() => handlers.play!({ action: 'play' }))
      expect(play).toHaveBeenCalledTimes(1)

      act(() => handlers.pause!({ action: 'pause' }))
      expect(session.playbackState).toBe('paused')
      expect(screen.getByRole('button', { name: 'écouter la radio en ondes' })).toBeInTheDocument()
    } finally {
      cleanup()
      Reflect.deleteProperty(navigator, 'mediaSession')
    }
  })

  it('comes back on air on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockSite({ radio: { ok: false, error: 'SoundCloud could not be reached' } })
    renderSite()
    expect(await screen.findByRole('button', { name: 'hors ondes' })).toBeDisabled()
    await waitFor(() => expect(requestsTo('GET', RADIO_URL)).toHaveLength(1))

    mockSite()
    await act(() => vi.advanceTimersByTimeAsync(60 * 1000))
    expect(await screen.findByRole('button', { name: 'en ondes · kraka' })).toBeEnabled()
    expect(screen.getByRole('region', { name: 'lecteur' })).toHaveTextContent('KRAKA')
  })

  it('sets the volume, mutes it, and remembers it for the next visit', async () => {
    mockSite()
    renderSite()
    await startRadio()
    await waitFor(() => expect(audio()).toBeDefined())
    const slider = screen.getByRole('slider', { name: 'volume' })
    fireEvent.change(slider, { target: { value: '0.3' } })
    expect(audio()!.volume).toBe(0.3)
    expect(loadVolume()).toEqual({ level: 0.3, muted: false })

    fireEvent.click(screen.getByRole('button', { name: 'couper le son' }))
    expect(audio()!.muted).toBe(true)
    expect(loadVolume()).toEqual({ level: 0.3, muted: true })
    expect(slider).toHaveValue('0')

    fireEvent.click(screen.getByRole('button', { name: 'remettre le son' }))
    expect(audio()!.muted).toBe(false)
    expect(slider).toHaveValue('0.3')
  })

  it('starts at the volume it remembered', async () => {
    localStorage.setItem('parking-volume', JSON.stringify({ level: 0.4, muted: false }))
    mockSite()
    renderSite()
    expect(await screen.findByRole('slider', { name: 'volume' })).toHaveValue('0.4')
  })
})

describe('the radio', () => {
  const current = { track: KRAKA, startedAt: '2026-10-12T20:00:00.000Z' }
  const at = (time: string) => Date.parse(`2026-10-12T${time}Z`)

  it('is at the time since its track started', () => {
    expect(positionAt(current, at('20:12:30'))).toBe(750)
    // A clock slightly behind the server's doesn't go below the start.
    expect(positionAt(current, at('19:59:59'))).toBe(0)
  })

  it('moves along when its track ends', () => {
    expect(untilEnd(current, at('20:59:00'))).toBe(60 * 1000)
    expect(untilEnd(current, at('21:30:00'))).toBe(0)
  })

  it('says when the set was recorded', () => {
    expect(rediffusion(KRAKA)).toBe('rediffusion · 19 avril 2026')
    expect(rediffusion({ ...KRAKA, date: null })).toBe('rediffusion')
  })
})

describe('the mute button', () => {
  it('mutes, and unmutes at the same level', () => {
    expect(toggledMute({ level: 0.7, muted: false })).toEqual({ level: 0.7, muted: true })
    expect(toggledMute({ level: 0.7, muted: true })).toEqual({ level: 0.7, muted: false })
  })

  it('unmutes at half volume after the level was slid down to zero', () => {
    expect(toggledMute({ level: 0, muted: false })).toEqual({ level: 0.5, muted: false })
  })
})
