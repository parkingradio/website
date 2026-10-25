import { vi } from 'vitest'

export type Body = { ok: boolean } & Record<string, unknown>

// The bodies of the `Request`s that `mockFetch`'s `fetch` got, read as it got them, since reading them is asynchronous.
const requestBodies = new WeakMap<Request, string>()

// A request made to a stubbed `fetch`: its method, its URL, which for a `Request` is the part after the origin, and its
// options.
function described(input: string | Request, options?: RequestInit): { method: string; url: string; init: RequestInit } {
  if (typeof input === 'string') return { method: options?.method ?? 'GET', url: input, init: options ?? {} }
  const init = { method: input.method, headers: input.headers, body: requestBodies.get(input) }
  return { method: input.method, url: input.url.slice(location.origin.length), init }
}

/**
 * Stubs `fetch` to answer each of these URLs with its body, whose `ok` is also the response's. The bodies of endpoints
 * whose responses don't have `ok`, e.g. `/api/config`, still need one to tell success from failure. A URL can be
 * preceded by a method, e.g. `PUT /api/thing`, to answer only that method, which takes precedence over the
 * URL alone. Any other URL fails the test, except `/api/config`, which ConfigProvider fetches whenever the
 * app is rendered.
 *
 * Requests can be made with a URL and options, or with a `Request`, like the typed client of api/client.ts
 * makes them, whose URL is then the part after the origin.
 */
export function mockFetch(bodies: Record<string, Body> = {}) {
  const all: Record<string, Body> = {
    '/api/config': { ok: true, assetsDomain: 'assets.example.test', turnstileSiteKey: '1x00000000000000000000AA', features: {} },
    ...bodies,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | Request, options?: RequestInit) => {
      if (input instanceof Request) requestBodies.set(input, await input.text())
      const request = described(input, options)
      const body = all[`${request.method} ${request.url}`] ?? all[request.url]
      if (!body) throw new Error(`Unexpected fetch to ${request.method} ${request.url}`)
      return Response.json(body, { status: body.ok ? 200 : 500 })
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
    .mock.calls.filter(([input]) => !(input instanceof Request) || requestBodies.has(input))
    .map(([input, options]) => described(input as string | Request, options))
    .filter((request) => request.url === url && request.method === method)
    .map(({ init }) => init)
}
