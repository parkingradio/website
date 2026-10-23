import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { mockFetch } from './test-utils'

beforeEach(() => {
  // ConfigProvider fetches /api/config on mount, so every test that renders it needs that request
  // answered. Tests stubbing fetch themselves override this.
  mockFetch()
  // jsdom doesn't implement media: without these, an audio element that's paused or emptied, e.g. when
  // the page it's on goes away, logs that it isn't implemented.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Unmounting can pause audio elements, so the mocks are restored after it.
  cleanup()
  vi.restoreAllMocks()
})
