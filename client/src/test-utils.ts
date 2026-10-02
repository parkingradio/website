import { vi } from 'vitest'

type Body = { ok: boolean } & Record<string, unknown>

/**
 * Stubs `fetch` to answer each of these URLs with its body, whose `ok` is also the response's. Any other
 * URL fails the test, except `/api/config`, which ConfigProvider fetches whenever the app is rendered.
 */
export function mockFetch(bodies: Record<string, Body> = {}) {
  const all: Record<string, Body> = { '/api/config': { ok: true, assetsDomain: 'assets.example.test' }, ...bodies }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body = all[url]
      if (!body) throw new Error(`Unexpected fetch to ${url}`)
      return Promise.resolve({ ok: body.ok, json: () => Promise.resolve(body) })
    }),
  )
}
