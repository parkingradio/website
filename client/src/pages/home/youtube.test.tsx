import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider } from '../../player/player'
import { mockFetch, requestsTo } from '../../test-utils'
import { YouTubeWidget } from './youtube'

// Has the server answer `GET /api/video` with `id`'s video, or none for null, or fail with `'failure'`, until it's
// called again.
function answer(id: string | null | 'failure') {
  mockFetch({
    '/api/video': id === 'failure' ? { ok: false, error: 'The video is unavailable right now' } : { video: id && { id } },
  })
}

// Lets a minute pass, after which the widget asks again.
async function poll() {
  await act(() => vi.advanceTimersByTimeAsync(60_000))
}

// Lets minutes pass until the widget has had the server's next answer, which it shows before asking again a minute later.
// Testing Library's waitFor can't be used, since its own timeout would pass with the minutes, unlike vitest's.
async function answered() {
  const requests = videoRequests()
  await vi.waitFor(async () => {
    await poll()
    // Two more requests: the one answered, and the next, which is only sent once that answer is shown.
    expect(videoRequests()).toBeGreaterThan(requests + 1)
  })
}

const playing = () => screen.queryByTitle('Parking Radio YouTube')
const coverImage = (container: HTMLElement) => container.querySelector('.youtube-cover img')

// Waits for `id`'s video to show behind its cover.
async function showsCover(container: HTMLElement, id: string) {
  await waitFor(() => expect(coverImage(container)).toHaveAttribute('src', `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`))
}
const videoRequests = () => requestsTo('GET', '/api/video').length

// How it pauses the player shared by every page, and is paused by it, is tested with the player (see player.test.tsx).
function renderWidget() {
  return render(
    <StrictMode>
      <PlayerProvider>
        <YouTubeWidget />
      </PlayerProvider>
    </StrictMode>,
  )
}

// Waits for `id`'s video behind its cover, then plays it.
async function play(container: HTMLElement, id: string) {
  await showsCover(container, id)
  fireEvent.click(container.querySelector('.youtube-cover')!)
  expect(playing()).toHaveAttribute('src', `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('YouTubeWidget', () => {
  it('shows the video the server says behind a cover', async () => {
    answer('latest')
    const { container } = renderWidget()
    await showsCover(container, 'latest')
    expect(playing()).not.toBeInTheDocument()
  })

  it('plays the video from its cover', async () => {
    answer('latest')
    const { container } = renderWidget()
    await play(container, 'latest')
    expect(container.querySelector('.youtube-cover')).not.toBeInTheDocument()
  })

  it('says "Hors direct" when the server says there is no video', async () => {
    answer(null)
    renderWidget()
    expect(await screen.findByText('Hors direct')).toBeInTheDocument()
  })

  it('says "Hors direct", without an error, when the server can\'t say', async () => {
    answer('failure')
    const { container } = renderWidget()
    expect(await screen.findByText('Hors direct')).toBeInTheDocument()
    expect(container.querySelector('.youtube')).toHaveTextContent(/^Hors direct$/)
  })

  it('says "Hors direct" when the server can\'t be reached', async () => {
    mockFetch()
    renderWidget()
    expect(await screen.findByText('Hors direct')).toBeInTheDocument()
  })

  describe('asking again a minute after each answer', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true }))

    it('shows a newer video instead of the one waiting behind its cover', async () => {
      answer('latest')
      const { container } = renderWidget()
      await showsCover(container, 'latest')
      answer('newer')
      await poll()
      await showsCover(container, 'newer')
    })

    it('stops the video that plays when the server says another one, and shows its cover', async () => {
      answer('latest')
      const { container } = renderWidget()
      await play(container, 'latest')
      answer('newer')
      await poll()
      await showsCover(container, 'newer')
      expect(playing()).not.toBeInTheDocument()
    })

    it("doesn't play a video again when the server says it once more", async () => {
      answer('first')
      const { container } = renderWidget()
      await play(container, 'first')
      answer('second')
      await poll()
      await showsCover(container, 'second')
      answer('first')
      await poll()
      await showsCover(container, 'first')
      expect(playing()).not.toBeInTheDocument()
    })

    it('keeps playing the video when the server says the same one', async () => {
      answer('latest')
      const { container } = renderWidget()
      await play(container, 'latest')
      await answered()
      expect(playing()).toBeInTheDocument()
    })

    it('stops the video that plays when the server says there is none', async () => {
      answer('latest')
      const { container } = renderWidget()
      await play(container, 'latest')
      answer(null)
      await poll()
      expect(await screen.findByText('Hors direct')).toBeInTheDocument()
      expect(playing()).not.toBeInTheDocument()
    })

    it("keeps what it shows when the server can't say", async () => {
      answer('latest')
      const { container } = renderWidget()
      await showsCover(container, 'latest')
      answer('failure')
      await answered()
      await showsCover(container, 'latest')

      fireEvent.click(container.querySelector('.youtube-cover')!)
      mockFetch()
      await answered()
      expect(playing()).toBeInTheDocument()
      expect(screen.queryByText('Hors direct')).not.toBeInTheDocument()
    })

    it('shows the video once the server says it, after it could not', async () => {
      answer('failure')
      const { container } = renderWidget()
      expect(await screen.findByText('Hors direct')).toBeInTheDocument()
      answer('latest')
      await poll()
      await showsCover(container, 'latest')
    })

    it('only asks again a minute after the server answered, so that a late answer never replaces a newer one', async () => {
      // The server's answers, which it only gives when the test says.
      const answers: ((body: object) => void)[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn((request: Request) =>
          new URL(request.url).pathname === '/api/video'
            ? new Promise((resolve) => answers.push((body) => resolve(Response.json(body))))
            : new Promise(() => {}),
        ),
      )
      const { container } = renderWidget()
      // StrictMode runs the widget's effect twice, which asks twice: only the second one's answer counts.
      await waitFor(() => expect(answers).toHaveLength(2))
      await poll()
      await poll()
      expect(answers).toHaveLength(2)

      await act(async () => answers[1]({ video: { id: 'latest' } }))
      await showsCover(container, 'latest')
      expect(answers).toHaveLength(2)

      await poll()
      await waitFor(() => expect(answers).toHaveLength(3))
      await act(async () => answers[2]({ video: { id: 'newer' } }))
      await showsCover(container, 'newer')

      // The answer to the request of the effect StrictMode threw away comes last, and changes nothing.
      await act(async () => answers[0]({ video: { id: 'stale' } }))
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
      await showsCover(container, 'newer')
      expect(answers).toHaveLength(3)
    })

    it('stops asking once it is gone', async () => {
      answer('latest')
      const { container, unmount } = renderWidget()
      await waitFor(() => expect(coverImage(container)).toBeInTheDocument())
      unmount()
      const requests = videoRequests()
      await poll()
      await poll()
      expect(videoRequests()).toBe(requests)
    })
  })
})
