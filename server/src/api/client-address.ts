import type { FastifyRequest } from 'fastify'
import { normalizeIP } from '@fastify/rate-limit'

// The visitor's address. In production, requests reach the app through Cloudflare and then nginx, so `request.ip` is
// nginx's address. Cloudflare sets CF-Connecting-IP to the visitor's actual address (overwriting any value sent by the
// client), and the origin only accepts traffic from Cloudflare. Outside of that setup (e.g. in development), fall back
// to `request.ip`.
export function visitorAddress(request: FastifyRequest): string {
  const cloudflareAddress = request.headers['cf-connecting-ip']
  return typeof cloudflareAddress === 'string' ? cloudflareAddress : request.ip
}

// The key rate limits use to tell clients apart: the visitor's address. Without it, every visitor would share the same
// limit. Like the rate limit plugin's default key, IPv6 addresses are grouped by subnet, so that a client can't get
// around the limit by switching between the many addresses it's given.
export function clientAddress(request: FastifyRequest): string {
  return normalizeIP(visitorAddress(request))
}
