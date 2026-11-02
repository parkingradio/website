import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerProvider } from '../player/player'
import { Home } from './home'

describe('Home', () => {
  // The rotation banner, the YouTube widget and the player ask for what they show (see their own tests): here, they
  // wait for it.
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))))

  it('shows the rotation banner, the YouTube widget and the Discord chat', () => {
    const { container } = render(
      <StrictMode>
        <PlayerProvider>
          <Home />
        </PlayerProvider>
      </StrictMode>,
    )
    expect(container.querySelector('.rotation-banner')).toBeInTheDocument()
    expect(container.querySelector('.youtube-cover')).toBeInTheDocument()
    expect(screen.getByTitle('Parking Radio Discord')).toHaveAttribute(
      'src',
      'https://e.widgetbot.io/channels/1516532918527328428/1516532918527328431',
    )
  })
})
