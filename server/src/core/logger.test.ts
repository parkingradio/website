import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createLogger, logWithRequest, withoutQueryValues } from './logger.js'

describe("the server's logger", () => {
  it("leaves the values of a request's query string out", async () => {
    const logs: string[] = []
    const app = Fastify({ loggerInstance: createLogger({ write: (line: string) => logs.push(line) }) })
    app.get('/accept-invite', async () => ({ ok: true }))
    await app.inject({ method: 'GET', url: '/accept-invite?token=the-secret&next=&flag' })
    const incoming = JSON.parse(logs.find((line) => line.includes('"incoming request"'))!)
    expect(incoming.req).toEqual({
      method: 'GET',
      url: '/accept-invite?token=[redacted]&next=[redacted]&flag',
      host: 'localhost:80',
      remoteAddress: '127.0.0.1',
    })
    expect(logs.join('')).not.toContain('the-secret')
  })

  it('leaves URLs without a query string as they are', () => {
    expect(withoutQueryValues('/api/admin/artists/a=b')).toBe('/api/admin/artists/a=b')
    expect(withoutQueryValues('/api/radio?')).toBe('/api/radio?')
  })
})

describe('logWithRequest', () => {
  it("adds fields to the request's lines, each key once, and leaves out those that are undefined", async () => {
    const logs: string[] = []
    const app = Fastify({ loggerInstance: createLogger({ write: (line: string) => logs.push(line) }) })
    app.get('/', async (request) => {
      logWithRequest(request, { error: 'First', other: undefined })
      logWithRequest(request, { error: 'Second', other: 'Other' })
      return { ok: true }
    })
    await app.inject({ method: 'GET', url: '/' })
    const line = logs.find((line) => line.includes('"request completed"'))!
    expect(line.match(/"error"/g)).toHaveLength(1)
    expect(JSON.parse(line)).toMatchObject({ error: 'First', other: 'Other', res: { statusCode: 200 } })
  })

  it('does nothing in apps without a logger', async () => {
    const app = Fastify()
    app.get('/', async (request) => {
      logWithRequest(request, { error: 'Nowhere' })
      return { ok: true }
    })
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200)
  })
})
