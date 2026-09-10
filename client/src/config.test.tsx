import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfigProvider } from './config'
import { useAssetUrl } from './config-context'

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
