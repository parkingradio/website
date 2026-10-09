import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'

import { clientAddress, visitorAddress } from './client-address.js'

// A route that responds with the addresses of the request, which comes from `remoteAddress` and has `headers`.
async function addresses(headers: Record<string, string> = {}, remoteAddress = '192.0.2.1') {
  const app = Fastify()
  app.get('/addresses', async (request) => ({ visitor: visitorAddress(request), client: clientAddress(request) }))
  const response = await app.inject({ method: 'GET', url: '/addresses', headers, remoteAddress })
  return response.json()
}

describe('visitorAddress', () => {
  it('is the address Cloudflare reports', async () => {
    expect((await addresses({ 'cf-connecting-ip': '203.0.113.5' })).visitor).toBe('203.0.113.5')
  })

  it("is the address the request comes from when it doesn't come through Cloudflare", async () => {
    expect((await addresses({}, '198.51.100.7')).visitor).toBe('198.51.100.7')
  })
})

describe('clientAddress', () => {
  it('is the visitor address, for IPv4', async () => {
    expect((await addresses({ 'cf-connecting-ip': '203.0.113.5' })).client).toBe('203.0.113.5')
    expect((await addresses({}, '198.51.100.7')).client).toBe('198.51.100.7')
  })

  it('groups IPv6 addresses by /64 subnet, so that a client cannot dodge rate limits by cycling through its addresses', async () => {
    const first = await addresses({ 'cf-connecting-ip': '2001:db8:1:2:3:4:5:6' })
    const sameSubnet = await addresses({ 'cf-connecting-ip': '2001:db8:1:2:ffff::1' })
    const otherSubnet = await addresses({ 'cf-connecting-ip': '2001:db8:1:3::1' })
    expect(first.client).toBe('2001:db8:1:2::')
    expect(sameSubnet.client).toBe(first.client)
    expect(otherSubnet.client).not.toBe(first.client)
    // The visitor address itself is kept as it is, e.g. for Turnstile.
    expect(first.visitor).toBe('2001:db8:1:2:3:4:5:6')
  })

  it('counts an IPv4 address written as IPv6 as the IPv4 address', async () => {
    expect((await addresses({ 'cf-connecting-ip': '::ffff:203.0.113.5' })).client).toBe('203.0.113.5')
  })
})
