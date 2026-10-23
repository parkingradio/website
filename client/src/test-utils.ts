import { vi } from 'vitest'

export type Body = { ok: boolean } & Record<string, unknown>

/**
 * Stubs `fetch` to answer each of these URLs with its body, whose `ok` is also the response's. A URL can be
 * preceded by a method, e.g. `PUT /api/thing`, to answer only that method, which takes precedence over the
 * URL alone. Any other URL fails the test, except `/api/config`, which ConfigProvider fetches whenever the
 * app is rendered.
 */
export function mockFetch(bodies: Record<string, Body> = {}) {
  const all: Record<string, Body> = {
    '/api/config': { ok: true, assetsDomain: 'assets.example.test', turnstileSiteKey: '1x00000000000000000000AA', features: {} },
    ...bodies,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const body = all[`${init?.method ?? 'GET'} ${url}`] ?? all[url]
      if (!body) throw new Error(`Unexpected fetch to ${init?.method ?? 'GET'} ${url}`)
      return Promise.resolve({ ok: body.ok, json: () => Promise.resolve(body) })
    }),
  )
}

/** The JSON body of a request, e.g. one from `requestsTo`. */
export const jsonBody = (request: RequestInit) => JSON.parse(request.body as string)

/** The options of every request `fetch` was asked to make with `method` to `url`, oldest first. */
export function requestsTo(method: string, url: string): RequestInit[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([requested, init]) => requested === url && (init?.method ?? 'GET') === method)
    .map(([, init]) => init ?? {})
}
