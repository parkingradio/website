import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { mockFetch } from './test-utils'

// Requests sent outside of a test's mocks fail the test file (see `afterAll`), rather than reaching whatever answers at
// jsdom's address, http://localhost:3000, e.g. a dev server, whose 401 would end the session of the test running then.
// Assigned rather than stubbed, so that it's what `vi.unstubAllGlobals` restores between tests.
const leaked: string[] = []
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? `${input.method} ${input.url}` : `${init?.method ?? 'GET'} ${input}`
  leaked.push(request)
  throw new Error(`Request sent outside of a test's mocks: ${request}`)
}

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

// Nor ResizeObserver: elements never change size in jsdom, so it never calls back. Assigned once, so that a test can stub
// one of its own, which `vi.unstubAllGlobals` takes away.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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
  // Unmounting first runs what's pending, e.g. the page opened once a request was answered, which can send requests and
  // pause audio elements, so the stubs and mocks are restored after it.
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Once every test has run, since requests can go out between tests, after the `afterEach` of the test that sent them.
// One sent after this still fails, without reaching the network, but isn't reported.
afterAll(() => {
  if (leaked.length) throw new Error(`Requests were sent outside of a test's mocks:\n${leaked.join('\n')}`)
})
