import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RadioTrack } from 'shared/radio'
import { mockFetch } from '../../test-utils'
import { RotationBanner } from './rotation-banner'

const set = (id: string, artist: string): RadioTrack => ({ id, artist, event: null, date: null, durationMs: 3_600_000 })

function renderBanner() {
  return render(
    <StrictMode>
      <RotationBanner />
    </StrictMode>,
  )
}

describe('RotationBanner', () => {
  it('lists the artists of the rotation from the set on air, once per set, and how wide they are', async () => {
    // The width of the names, twice, in a 20px font.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1200)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize: '20px' } as CSSStyleDeclaration)
    mockFetch({
      '/api/radio': {
        ok: true,
        current: { track: set('2', 'BRAVO'), startedAt: '2026-10-23T20:00:00.000Z' },
        upcoming: [set('3', 'Charlie'), set('1', 'ALPHA'), set('4', 'BRAVO')],
      },
    })
    renderBanner()

    // Twice, so that it loops without a gap, but only read once by screen readers.
    const [names, again] = await screen.findAllByText('BRAVO · Charlie · ALPHA · BRAVO ·')
    expect(names).not.toHaveAttribute('aria-hidden')
    expect(again).toHaveAttribute('aria-hidden', 'true')
    // In ems, which the stylesheet turns into how long they take to scroll by.
    expect(names.parentElement!.style.getPropertyValue('--width')).toBe('30')
  })

  it('shows its band while it reads the rotation', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = renderBanner()

    expect(container.querySelector('.rotation-banner')).toBeInTheDocument()
    expect(container.querySelector('.rotation-banner-track')).not.toBeInTheDocument()
  })

  it.each([
    ['the radio is off air', () => mockFetch({ '/api/radio': { ok: false, error: 'Off air' } })],
    ['the server is unreachable', () => vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed'))))],
  ])("doesn't show when %s", async (_, stub) => {
    stub()
    const { container } = renderBanner()

    await waitFor(() => expect(container.querySelector('.rotation-banner')).not.toBeInTheDocument())
  })
})
