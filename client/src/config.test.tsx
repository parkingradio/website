import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Schema } from './api/client'
import { ConfigProvider } from './config'
import { useAssetUrl, useFeature } from './config-context'
import { mockFetch } from './test-utils'

function AssetUrl({ assetKey }: { assetKey: string }) {
  const assetUrl = useAssetUrl()
  return <span data-testid="url">{assetUrl(assetKey) ?? '(pending)'}</span>
}

describe('useAssetUrl', () => {
  it('builds a URL once the configuration has been fetched', async () => {
    render(
      <ConfigProvider>
        <AssetUrl assetKey="poster.jpg" />
      </ConfigProvider>,
    )

    // The configuration arrives over the network, so it isn't there on the first render.
    expect(screen.getByTestId('url')).toHaveTextContent('(pending)')

    await waitFor(() =>
      expect(screen.getByTestId('url')).toHaveTextContent('https://assets.example.test/poster.jpg'),
    )
  })
})

describe('useFeature', () => {
  // These tests use flags of their own, so that they don't depend on which flags there are.
  function Feature({ id }: { id: string }) {
    const enabled = useFeature(id as Schema<'FeatureId'>)
    return <span data-testid={id}>{enabled === undefined ? '(pending)' : enabled ? 'on' : 'off'}</span>
  }

  function renderFeatures() {
    render(
      <ConfigProvider>
        <Feature id="on-thing" />
        <Feature id="off-thing" />
        <Feature id="unknown-thing" />
      </ConfigProvider>,
    )
  }

  it('says whether each flag is on, once the configuration has been fetched', async () => {
    mockFetch({ '/api/config': { assetsDomain: 'assets.example.test', features: { 'on-thing': true, 'off-thing': false } } })
    renderFeatures()

    expect(screen.getByTestId('on-thing')).toHaveTextContent('(pending)')

    await waitFor(() => expect(screen.getByTestId('on-thing')).toHaveTextContent('on'))
    expect(screen.getByTestId('off-thing')).toHaveTextContent('off')
    expect(screen.getByTestId('unknown-thing')).toHaveTextContent('off')
  })

  it("turns every flag off when the configuration can't be fetched", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch({ '/api/config': { ok: false, error: 'Boom' } })
    renderFeatures()

    await waitFor(() => expect(screen.getByTestId('on-thing')).toHaveTextContent('off'))
    expect(screen.getByTestId('off-thing')).toHaveTextContent('off')
  })
})
