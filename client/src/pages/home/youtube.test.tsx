import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YouTubeWidget } from './youtube'

// What the YouTube Data API answers for the channel, and for its uploads playlist.
type Answers = { channels?: unknown; playlistItems?: unknown }

const CHANNEL = { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUuploads' } } }] }
const LATEST = { items: [{ snippet: { resourceId: { videoId: 'latest' } } }] }

// Returns the answers, which a test can change before the widget asks again.
function stubYouTube(initial: Answers = {}) {
  const answers = { channels: CHANNEL, playlistItems: LATEST, ...initial }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const answer = url.includes('/channels?')
        ? answers.channels
        : url.includes('/playlistItems?') && url.includes('playlistId=UUuploads')
          ? answers.playlistItems
          : null
      if (answer === null) throw new Error(`Unexpected fetch to ${url}`)
      return Promise.resolve({ json: () => Promise.resolve(answer) })
    }),
  )
  return answers
}

// The widget asks YouTube again every minute.
async function poll() {
  await act(async () => vi.advanceTimersByTime(60_000))
}

const thumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`

function renderWidget() {
  return render(
    <StrictMode>
      <YouTubeWidget />
    </StrictMode>,
  )
}

// Where the widget and the legacy radio bar say they're playing.
let channel: BroadcastChannel
let messages: unknown[]
beforeEach(() => {
  messages = []
  channel = new BroadcastChannel('parking_radio')
  channel.onmessage = (e) => messages.push(e.data)
})
afterEach(() => {
  channel.close()
  vi.useRealTimers()
})

describe('YouTubeWidget', () => {
  it('shows the most recent video behind a cover', async () => {
    stubYouTube()
    const { container } = renderWidget()
    await waitFor(() =>
      expect(container.querySelector('.youtube-cover img')).toHaveAttribute('src', 'https://i.ytimg.com/vi/latest/maxresdefault.jpg'),
    )
    expect(screen.queryByTitle('Parking Radio YouTube')).not.toBeInTheDocument()
  })

  it('plays the video from its cover, and says so to the radio', async () => {
    stubYouTube()
    const { container } = renderWidget()
    await waitFor(() => expect(container.querySelector('.youtube-cover img')).toBeInTheDocument())
    fireEvent.click(container.querySelector('.youtube-cover')!)
    expect(screen.getByTitle('Parking Radio YouTube')).toHaveAttribute(
      'src',
      'https://www.youtube.com/embed/latest?autoplay=1&rel=0&modestbranding=1',
    )
    expect(container.querySelector('.youtube-cover')).not.toBeInTheDocument()
    await waitFor(() => expect(messages).toEqual(['yt_playing']))
  })

  it('goes back to the cover when the radio plays', async () => {
    stubYouTube()
    const { container } = renderWidget()
    await waitFor(() => expect(container.querySelector('.youtube-cover img')).toBeInTheDocument())
    fireEvent.click(container.querySelector('.youtube-cover')!)
    channel.postMessage('audio_playing')
    await waitFor(() => expect(screen.queryByTitle('Parking Radio YouTube')).not.toBeInTheDocument())
    expect(container.querySelector('.youtube-cover img')).toHaveAttribute('src', 'https://i.ytimg.com/vi/latest/maxresdefault.jpg')
  })

  it('says "Hors direct" when the channel has no video', async () => {
    stubYouTube({ playlistItems: { items: [] } })
    renderWidget()
    expect(await screen.findByText('Hors direct')).toBeInTheDocument()
  })

  it("shows the API's errors", async () => {
    stubYouTube({ channels: { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.' } } })
    renderWidget()
    expect(
      await screen.findByText('⚠ API 403: The request cannot be completed because you have exceeded your quota.'),
    ).toBeInTheDocument()
  })

  it("shows why YouTube can't be reached", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    renderWidget()
    expect(await screen.findByText('⚠ Failed to fetch')).toBeInTheDocument()
  })

  describe('asking again every minute', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))

    it('keeps the video waiting behind its cover, even when there is a newer one', async () => {
      const answers = stubYouTube()
      const { container } = renderWidget()
      await waitFor(() => expect(container.querySelector('.youtube-cover img')).toHaveAttribute('src', thumbnail('latest')))
      answers.playlistItems = { items: [{ snippet: { resourceId: { videoId: 'newer' } } }] }
      await poll()
      expect(container.querySelector('.youtube-cover img')).toHaveAttribute('src', thumbnail('latest'))
    })

    it('replaces the video that plays when there is a newer one', async () => {
      const answers = stubYouTube()
      const { container } = renderWidget()
      await waitFor(() => expect(container.querySelector('.youtube-cover img')).toBeInTheDocument())
      fireEvent.click(container.querySelector('.youtube-cover')!)
      answers.playlistItems = { items: [{ snippet: { resourceId: { videoId: 'newer' } } }] }
      await poll()
      await waitFor(() => expect(container.querySelector('.youtube-cover img')).toHaveAttribute('src', thumbnail('newer')))
      expect(screen.queryByTitle('Parking Radio YouTube')).not.toBeInTheDocument()
    })

    it('stops showing an error once YouTube answers', async () => {
      const answers = stubYouTube({ channels: { error: { code: 503, message: 'Backend Error' } } })
      const { container } = renderWidget()
      expect(await screen.findByText('⚠ API 503: Backend Error')).toBeInTheDocument()
      answers.channels = CHANNEL
      await poll()
      await waitFor(() => expect(screen.queryByText('⚠ API 503: Backend Error')).not.toBeInTheDocument())
      expect(container.querySelector('.youtube-cover img')).toHaveAttribute('src', thumbnail('latest'))
    })
  })
})
