import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyRadio } from './legacy-radio'

const R2 = 'https://pub-ac6abcc67fed4f8f8072bac54bb99274.r2.dev'
const TRACKS = [
  { url: `${R2}/A.wav`, name: 'ALPHA', date: '2026.01.01' },
  { url: `${R2}/B.wav`, name: 'BRAVO', date: '2026.01.02' },
  { url: `${R2}/C.wav`, name: 'CHARLIE', date: '2026.01.03' },
]
const DURATIONS = [100, 200, 300]

// A time at which the rotation, which starts over every 600 seconds since the epoch, is 150 seconds in: BRAVO is on air,
// 50 seconds into it.
const NOW = new Date(1_800_000_000_000 + 150_000)

function stubRotation() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const answer = url.startsWith(`${R2}/playlist.json?v=`) ? TRACKS : url.startsWith(`${R2}/durations.json?v=`) ? DURATIONS : null
      if (answer === null) throw new Error(`Unexpected fetch to ${url}`)
      return Promise.resolve({ json: () => Promise.resolve(answer) })
    }),
  )
}

function renderRadio() {
  const rendered = render(
    <StrictMode>
      <LegacyRadio />
    </StrictMode>,
  )
  return { ...rendered, audio: rendered.container.querySelector('audio')! }
}

// Renders the radio bar, once it has read the rotation. StrictMode's first unmount has paused the audio by then: that
// doesn't count.
async function renderLoadedRadio() {
  const rendered = renderRadio()
  await waitFor(() => expect(screen.queryByText('loading…')).not.toBeInTheDocument())
  vi.mocked(rendered.audio.pause).mockClear()
  return rendered
}

// What the audio element does once it knows the length of what it loaded.
function loadMetadata(audio: HTMLAudioElement, duration: number) {
  Object.defineProperty(audio, 'duration', { configurable: true, value: duration })
  audio.dispatchEvent(new Event('loadedmetadata'))
}

// Where the radio bar and the YouTube widget say they're playing.
let channel: BroadcastChannel
let messages: unknown[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  messages = []
  channel = new BroadcastChannel('parking_radio')
  channel.onmessage = (e) => messages.push(e.data)
})

afterEach(() => {
  channel.close()
  vi.useRealTimers()
})

describe('LegacyRadio', () => {
  it('lists the rotation, in the marquee and in the schedule, from what is on air', async () => {
    stubRotation()
    const { container } = await renderLoadedRadio()
    // Twice, so that it loops without a gap.
    expect(container.querySelector('.legacy-radio-marquee-track')).toHaveTextContent(
      /^ALPHA · BRAVO · CHARLIE · ALPHA · BRAVO · CHARLIE ·$/,
    )
    const rows = [...container.querySelectorAll('.legacy-radio-schedule tbody tr')].map((row) => row.textContent)
    // Each with when it starts, in Eastern time, which stays the one of the rotation under way for the tracks after it.
    expect(rows).toEqual(['03:01BRAVOon air2026.01.023m', '03:05CHARLIE2026.01.035m', '03:00ALPHA2026.01.011m'])
  })

  it('plays what is on air, from where it is at, and says so to the YouTube widget', async () => {
    stubRotation()
    const { container, audio } = await renderLoadedRadio()
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(audio).toHaveAttribute('src', `${R2}/B.wav`)
    expect(container.querySelector('.legacy-radio-track')).toHaveTextContent('BRAVO 2026.01.02 [rediffusion]')
    loadMetadata(audio, 200)
    expect(audio.currentTime).toBe(50)
    expect(audio.play).toHaveBeenCalled()
    await waitFor(() => expect(messages).toContain('audio_playing'))
  })

  it('pauses when the YouTube widget plays', async () => {
    stubRotation()
    const { container, audio } = await renderLoadedRadio()
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(audio.pause).not.toHaveBeenCalled()
    channel.postMessage('yt_playing')
    await waitFor(() => expect(container.querySelector('.legacy-radio-track')).toBeEmptyDOMElement())
    expect(audio.pause).toHaveBeenCalled()
  })

  it('plays a track of the schedule on demand', async () => {
    stubRotation()
    const { container, audio } = await renderLoadedRadio()
    // The tests don't load the styles, which hide it until then.
    const live = screen.getByText('● Live')
    expect(live.style.display).toBe('')
    fireEvent.click(screen.getByText('Schedule ▾'))
    fireEvent.click(screen.getByText('CHARLIE'))
    expect(audio).toHaveAttribute('src', `${R2}/C.wav`)
    expect(screen.getByText('On Demand')).toBeInTheDocument()
    expect(live.style.display).toBe('inline-block')
    expect(container.querySelector('.legacy-radio-row-selected')).toHaveTextContent('CHARLIEon demand')
  })

  it('stops when it goes away', async () => {
    stubRotation()
    const { audio, unmount } = await renderLoadedRadio()
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(audio.pause).not.toHaveBeenCalled()
    unmount()
    expect(audio.pause).toHaveBeenCalled()
    expect(audio).not.toHaveAttribute('src')
  })

  it("stays loading when the rotation can't be read", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    renderRadio()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('loading…')).toBeInTheDocument()
  })
})
