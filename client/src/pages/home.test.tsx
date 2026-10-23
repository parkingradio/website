import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Features } from 'shared/features'
import { ConfigContext } from '../config-context'
import type { ConfigState } from '../config-context'
import { PlayerProvider } from '../player/player'
import { Home } from './home'

const loaded = (features: Features): ConfigState => ({
  kind: 'loaded',
  config: { assetsDomain: 'assets.example.test', turnstileSiteKey: 'key', features },
})

function renderHome(config: ConfigState) {
  return render(
    <StrictMode>
      <ConfigContext value={config}>
        <PlayerProvider enabled={false}>
          <Home />
        </PlayerProvider>
      </ConfigContext>
    </StrictMode>,
  )
}

describe('Home', () => {
  // The legacy radio bar, the rotation banner and the YouTube widget ask for what they show (see their own tests): here,
  // they wait for it.
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))))

  it('shows the legacy radio bar, the YouTube widget and the Discord chat while the new player is off', () => {
    const { container } = renderHome(loaded({}))
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(container.querySelector('.rotation-banner')).not.toBeInTheDocument()
    expect(screen.getByText('loading…')).toBeInTheDocument()
    expect(container.querySelector('.youtube-cover')).toBeInTheDocument()
    expect(screen.getByTitle('Parking Radio Discord')).toHaveAttribute(
      'src',
      'https://e.widgetbot.io/channels/1516532918527328428/1516532918527328431',
    )
  })

  it('shows the rotation banner in place of the legacy radio bar while the new player is on', () => {
    const { container } = renderHome(loaded({ 'nouveau-lecteur': true }))
    expect(container.querySelector('.rotation-banner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument()
    expect(screen.getByTitle('Parking Radio Discord')).toBeInTheDocument()
  })

  // Neither shows until the flag is known, and a configuration that can't be fetched means it's off.
  it.each([
    ['while the new player is unknown', { kind: 'loading' } as const, false],
    ["when the configuration can't be fetched", { kind: 'failed' } as const, true],
  ])('shows the legacy radio bar or not %s', (_, config, shown) => {
    const { container } = renderHome(config)
    const legacyRadio = expect(screen.queryByRole('button', { name: 'Play' }))
    if (shown) legacyRadio.toBeInTheDocument()
    else legacyRadio.not.toBeInTheDocument()
    expect(container.querySelector('.rotation-banner')).not.toBeInTheDocument()
    expect(screen.getByTitle('Parking Radio Discord')).toBeInTheDocument()
  })
})
