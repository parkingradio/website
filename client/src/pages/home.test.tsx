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
  // The legacy radio bar and the YouTube widget ask other sites for what they show (see their own tests): here, they
  // wait for them.
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))))

  it('shows the legacy radio bar, the YouTube widget and the Discord chat while the new player is off', () => {
    const { container } = renderHome(loaded({}))
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByText('loading…')).toBeInTheDocument()
    expect(container.querySelector('.youtube-cover')).toBeInTheDocument()
    expect(screen.getByTitle('Parking Radio Discord')).toHaveAttribute(
      'src',
      'https://e.widgetbot.io/channels/1516532918527328428/1516532918527328431',
    )
  })

  // The new player replaces the legacy radio bar, which only shows once that's known to be off.
  it.each([
    ['while the new player is unknown', { kind: 'loading' } as const, false],
    ["when the configuration can't be fetched", { kind: 'failed' } as const, true],
    ['when the new player is on', loaded({ 'nouveau-lecteur': true }), false],
  ])('shows the legacy radio bar or not %s', (_, config, shown) => {
    renderHome(config)
    const legacyRadio = expect(screen.queryByRole('button', { name: 'Play' }))
    if (shown) legacyRadio.toBeInTheDocument()
    else legacyRadio.not.toBeInTheDocument()
    expect(screen.getByTitle('Parking Radio Discord')).toBeInTheDocument()
  })
})
