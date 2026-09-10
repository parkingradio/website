import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// ConfigProvider fetches /api/config on mount, so every test that renders it needs that request
// answered. Tests stubbing fetch themselves (see admin.test.tsx) override this.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ assetsDomain: 'assets.example.test' }),
        }) as unknown as Promise<Response>
      }
      throw new Error(`Unexpected fetch to ${url}`)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})
