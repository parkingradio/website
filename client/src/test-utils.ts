import { act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import type { AppConfig } from './config-context'

export type Body = Record<string, unknown>

// What `mockFetch` answers `/api/config` with, unless it's given another one, e.g. one spread from this.
export const CONFIG: AppConfig = {
  assetsDomain: 'assets.example.test',
  turnstileSiteKey: '1x00000000000000000000AA',
  environment: 'production',
  features: {},
}

// The bodies of the `Request`s that `mockFetch`'s `fetch` got, read as it got them, since reading them is asynchronous,
// or the FormData they were made with. That's what they send in a browser, but in the tests, jsdom's FormData is turned
// into Node's for its Request, which loses the names and contents of its files.
const requestBodies = new WeakMap<Request, string | FormData>()

// The environment's, which `mockFetch` replaces with one that keeps the FormData requests are made with.
const NodeRequest = globalThis.Request

// A request made to a stubbed `fetch`: its method, its URL, which for a `Request` is the part after the origin, and its
// options.
function described(input: string | Request, options?: RequestInit): { method: string; url: string; init: RequestInit } {
  if (typeof input === 'string') return { method: options?.method ?? 'GET', url: input, init: options ?? {} }
  const init = { method: input.method, headers: input.headers, body: requestBodies.get(input) }
  return { method: input.method, url: input.url.slice(location.origin.length), init }
}

/** What admin endpoints answer without a session, which `mockFetch` answers with a 401 status. */
export const UNAUTHORIZED: Body = { ok: false, error: 'Unauthorized' }

/**
 * Stubs `fetch` to answer each of these URLs with its body: with a 401 status for `UNAUTHORIZED`, a 500 status when the
 * body is any other error, i.e. has `ok` set to `false`, and 200 otherwise, e.g. for endpoints whose responses don't
 * have `ok`. A URL can be preceded by a method, e.g. `PUT /api/thing`, to answer only that method, which takes
 * precedence over the URL alone. `/api/config`, which ConfigProvider fetches whenever the app is rendered, and what's on
 * air, which the player asks for, are answered unless they're given: the radio is then off air. Any other URL makes
 * `fetch` throw, which the typed client of api/client.ts turns into a failed request, as when the network fails, rather
 * than failing the test.
 *
 * Requests can be made with a URL and options, or with a `Request`, like the typed client of api/client.ts
 * makes them, whose URL is then the part after the origin. The body of a request made with a FormData is that FormData.
 */
export function mockFetch(bodies: Record<string, Body> = {}) {
  const all: Record<string, Body> = {
    '/api/config': CONFIG,
    '/api/radio?upcoming=0': { ok: false, error: 'No playlist has been chosen for the radio yet' },
    ...bodies,
  }
  vi.stubGlobal(
    'Request',
    class extends NodeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init)
        if (init?.body instanceof FormData) requestBodies.set(this, init.body)
      }
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | Request, options?: RequestInit) => {
      if (input instanceof NodeRequest && !requestBodies.has(input)) requestBodies.set(input, await input.text())
      const request = described(input, options)
      const body = all[`${request.method} ${request.url}`] ?? all[request.url]
      if (!body) throw new Error(`Unexpected fetch to ${request.method} ${request.url}`)
      return Response.json(body, { status: body === UNAUTHORIZED ? 401 : body.ok === false ? 500 : 200 })
    }),
  )
}

/** The JSON body of a request, e.g. one from `requestsTo`. */
export const jsonBody = (request: RequestInit) => JSON.parse(request.body as string)

/** The options of every request `fetch` was asked to make with `method` to `url`, oldest first. */
export function requestsTo(method: string, url: string): RequestInit[] {
  return vi
    .mocked(fetch)
    // A `Request` only counts once its body is read.
    .mock.calls.filter(([input]) => !(input instanceof NodeRequest) || requestBodies.has(input))
    .map(([input, options]) => described(input as string | Request, options))
    .filter((request) => request.url === url && request.method === method)
    .map(({ init }) => init)
}

/** An element's text, as its `textContent`, but without what's hidden, e.g. a tooltip that isn't shown. */
export function visibleText(element: Element): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement!.closest('[hidden]')) text += node.nodeValue
  return text
}

/**
 * jsdom doesn't lay out the page, which moving an item of a list with the keyboard needs (see pages/admin/sortable.tsx):
 * with this, each item, an <li> or a <tr>, and what's in it, is 40px tall, under the ones before it, in a list as tall as
 * its items.
 */
export function mockListLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (['OL', 'UL', 'TBODY'].includes(this.tagName)) return new DOMRect(0, 0, 800, 40 * this.children.length)
    const item = this.closest('li, tr')
    if (!item?.parentElement) return new DOMRect(0, 0, 0, 0)
    return new DOMRect(0, 40 * Array.prototype.indexOf.call(item.parentElement.children, item), 800, 40)
  })
}

/**
 * Picks up the item of a list whose handle is `handle` with the keyboard, moves it `by` places down, or up if it's
 * negative, and drops it there, or puts it back with Escape if `cancel` (see pages/admin/sortable.tsx), laid out by
 * `mockListLayout`. dnd-kit reads the keys' `code`, and only listens for the arrows a moment after the item is picked up.
 */
export async function moveWithKeyboard(handle: HTMLElement, by: number, { cancel = false } = {}) {
  mockListLayout()
  handle.focus()
  fireEvent.keyDown(handle, { key: ' ', code: 'Space' })
  await act(() => new Promise((resolve) => setTimeout(resolve)))
  for (let i = 0; i < Math.abs(by); i++) fireEvent.keyDown(handle, by > 0 ? { key: 'ArrowDown', code: 'ArrowDown' } : { key: 'ArrowUp', code: 'ArrowUp' })
  fireEvent.keyDown(handle, cancel ? { key: 'Escape', code: 'Escape' } : { key: ' ', code: 'Space' })
  await act(() => new Promise((resolve) => setTimeout(resolve)))
}
