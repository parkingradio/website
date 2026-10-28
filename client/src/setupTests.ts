import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { mockFetch } from './test-utils'

// jsdom doesn't implement modal dialogs: opening one only shows it, and closing it hides it and says so, as browsers do
// (though they fire `close` asynchronously).
if (!('showModal' in HTMLDialogElement.prototype)) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true
    },
    close(this: HTMLDialogElement) {
      if (!this.open) return
      this.open = false
      this.dispatchEvent(new Event('close'))
    },
  })
}

beforeEach(() => {
  // ConfigProvider fetches /api/config on mount, so every test that renders it needs that request
  // answered. Tests stubbing fetch themselves override this.
  mockFetch()
  // jsdom doesn't implement media: without these, an audio element that's paused or emptied, e.g. when
  // the page it's on goes away, logs that it isn't implemented.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  // Nor scrolling, which the layout does when another page opens.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Unmounting can pause audio elements, so the mocks are restored after it.
  cleanup()
  vi.restoreAllMocks()
})
