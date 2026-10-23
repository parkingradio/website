import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Home } from './home'

describe('Home', () => {
  // The legacy radio bar and the YouTube widget ask other sites for what they show (see their own tests): here, they
  // wait for them.
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))))

  it('shows the legacy radio bar, the YouTube widget and the Discord chat', () => {
    const { container } = render(
      <StrictMode>
        <Home />
      </StrictMode>,
    )
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByText('loading…')).toBeInTheDocument()
    expect(container.querySelector('.youtube-cover')).toBeInTheDocument()
    expect(screen.getByTitle('Parking Radio Discord')).toHaveAttribute(
      'src',
      'https://e.widgetbot.io/channels/1516532918527328428/1516532918527328431',
    )
  })
})
