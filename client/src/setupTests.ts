import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { mockFetch } from './test-utils'

// ConfigProvider fetches /api/config on mount, so every test that renders it needs that request
// answered. Tests stubbing fetch themselves override this.
beforeEach(() => mockFetch())

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})
