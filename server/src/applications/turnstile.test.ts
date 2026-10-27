import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { turnstileVerifier } from './turnstile.js'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const fetchMock = vi.fn()
const verify = turnstileVerifier('secret-key')

describe('turnstileVerifier', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks Cloudflare about the token, with the secret key and the visitor address', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true, 'error-codes': [] }))
    expect(await verify('the-token', '203.0.113.1')).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(SITEVERIFY_URL)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ secret: 'secret-key', response: 'the-token', remoteip: '203.0.113.1' })
  })

  it("returns Cloudflare's reasons when it refuses the token", async () => {
    fetchMock.mockResolvedValue(Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }))
    expect(await verify('the-token', '203.0.113.1')).toEqual({ success: false, errorCodes: ['timeout-or-duplicate'] })
  })

  it('refuses a missing or overly long token without asking Cloudflare', async () => {
    expect(await verify('', '203.0.113.1')).toEqual({ success: false, errorCodes: ['missing-input-response'] })
    expect(await verify('x'.repeat(4096), '203.0.113.1')).toEqual({ success: false, errorCodes: ['invalid-input-response'] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('only takes a success that Cloudflare says in so many words', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: 'true' }))
    expect(await verify('the-token', '203.0.113.1')).toEqual({ success: false, errorCodes: [] })
  })

  it('throws when Cloudflare cannot be asked', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
    await expect(verify('the-token', '203.0.113.1')).rejects.toThrow('Turnstile responded with 502')
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(verify('the-token', '203.0.113.1')).rejects.toThrow('fetch failed')
  })

  it('throws when Cloudflare fails to check the token, which says nothing about the visitor', async () => {
    fetchMock.mockResolvedValue(Response.json({ success: false, 'error-codes': ['internal-error'] }))
    await expect(verify('the-token', '203.0.113.1')).rejects.toThrow('Turnstile had an internal error')
  })
})
