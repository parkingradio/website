import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import { notFoundRoutes } from '../site/not-found.js'
import { frameworkErrors } from './errors.js'
import { useZodSchemas } from './schemas.js'

// An app with every error handled as by the server, whose routes aren't declared with zodRoutes, so that it's the app's
// error handler that sends their errors. `logs` gets every line it logs.
async function buildApp(logs: string[] = []) {
  const app = Fastify({ frameworkErrors, logger: { stream: { write: (line: string) => logs.push(line) } } })
  useZodSchemas(app)
  app.get('/api/fails', async () => {
    const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
    throw new DrizzleQueryError('select * from "users" where "email" = $1', ['secret@example.com'], cause)
  })
  app.get('/api/refuses', async () => {
    throw Object.assign(new Error('No coffee here'), { statusCode: 418 })
  })
  app.get('/api/redirects', async () => {
    throw Object.assign(new Error('Somewhere else'), { statusCode: 302 })
  })
  app.post('/api/takes-json', async () => ({ ok: true }))
  // Errors that don't go through the error handler.
  app.get('/api/missing', async (_request, reply) => reply.status(404).send({ ok: false, error: 'No such thing', thing: 'secret' }))
  app.get('/api/guarded', { onRequest: async (_request, reply) => reply.status(401).send({ ok: false, error: 'Unauthorized' }) }, async () => ({ ok: true }))
  app.get('/api/things/:id', async () => ({ ok: true }))
  await app.register(notFoundRoutes, { prefix: '/api' })
  return app
}

const json = { 'content-type': 'application/json' }

// The line logged once the last request was answered, with its status.
const completed = (logs: string[]) => JSON.parse(logs.findLast((line) => line.includes('"request completed"'))!)
const tooLarge = JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) })

describe("the app's error handler", () => {
  it("keeps a failed query's values out of the logs and the response, saying only that something went wrong", async () => {
    const logs: string[] = []
    const app = await buildApp(logs)
    const response = await app.inject({ method: 'GET', url: '/api/fails' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
    const line = JSON.parse(logs.find((line) => line.includes('Failed to handle GET /api/fails'))!)
    expect(line.err).toEqual({
      type: 'DrizzleQueryError',
      query: 'select * from "users" where "email" = $1',
      cause: { message: 'terminating connection due to administrator command', code: '57P01' },
    })
    expect(logs.join('')).not.toContain('secret@example.com')
  })

  it('keeps the message of a 4xx that Fastify or a plugin raises', async () => {
    const app = await buildApp()
    const responses = [
      await app.inject({ method: 'GET', url: '/api/refuses' }),
      await app.inject({ method: 'POST', url: '/api/takes-json', payload: '{not json', headers: json }),
      await app.inject({ method: 'POST', url: '/api/takes-json', payload: tooLarge, headers: json }),
      await app.inject({ method: 'POST', url: '/api/takes-json', payload: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      await app.inject({ method: 'POST', url: '/api/takes-json', payload: '', headers: json }),
      await app.inject({ method: 'POST', url: '/api/takes-json', payload: '{}', headers: { ...json, 'content-length': '10' } }),
    ]
    expect(responses.map((response) => [response.statusCode, response.json()])).toEqual([
      [418, { ok: false, error: 'No coffee here' }],
      [400, { ok: false, error: "Body is not valid JSON but content-type is set to 'application/json'" }],
      [413, { ok: false, error: 'Request body is too large' }],
      [415, { ok: false, error: 'Unsupported Media Type' }],
      [400, { ok: false, error: "Body cannot be empty when content-type is set to 'application/json'" }],
      [400, { ok: false, error: 'Request body size did not match Content-Length' }],
    ])
  })

  it('logs why a request failed with a 4xx, however its error is sent, without its other fields', async () => {
    const logs: string[] = []
    const app = await buildApp(logs)
    const failures = [
      ['/api/refuses', 418, 'No coffee here'],
      ['/api/missing', 404, 'No such thing'],
      ['/api/guarded', 401, 'Unauthorized'],
      ['/api/nope', 404, 'Not found'],
    ] as const
    for (const [url, status, error] of failures) {
      await app.inject({ method: 'GET', url })
      expect(completed(logs), url).toMatchObject({ res: { statusCode: status }, error })
    }
    expect(logs.join('')).not.toContain('secret')
  })

  it("doesn't log why a request that succeeded or failed unexpectedly failed", async () => {
    const logs: string[] = []
    const app = await buildApp(logs)
    await app.inject({ method: 'POST', url: '/api/takes-json', payload: '{}', headers: json })
    expect(completed(logs)).not.toHaveProperty('error')
    await app.inject({ method: 'GET', url: '/api/fails' })
    expect(completed(logs)).toMatchObject({ res: { statusCode: 500 } })
    expect(completed(logs)).not.toHaveProperty('error')
  })

  it("treats an error whose status isn't one of an error as unexpected", async () => {
    const logs: string[] = []
    const app = await buildApp(logs)
    const response = await app.inject({ method: 'GET', url: '/api/redirects' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
    expect(logs.join('')).toContain('Failed to handle GET /api/redirects')
  })

  it("sends a 404 for a path that no route matches, even when its body can't be read", async () => {
    const app = await buildApp()
    const responses = [
      await app.inject({ method: 'POST', url: '/api/nope', payload: '{not json', headers: json }),
      await app.inject({ method: 'POST', url: '/api/nope', payload: tooLarge, headers: json }),
      await app.inject({ method: 'POST', url: '/api/nope', payload: '', headers: json }),
      await app.inject({ method: 'POST', url: '/api/nope', payload: '{}', headers: { ...json, 'content-length': '10' } }),
      await app.inject({ method: 'POST', url: '/nope', payload: '{not json', headers: json }),
    ]
    for (const response of responses) {
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'Not found' })
    }
  })

  it('treats the unexpected errors of a not-found handler as such', async () => {
    const logs: string[] = []
    const app = await buildApp(logs)
    app.setNotFoundHandler(async () => {
      throw Object.assign(new Error('Could not read index.html'), { statusCode: 500 })
    })
    const response = await app.inject({ method: 'GET', url: '/nope' })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
    expect(logs.join('')).toContain('Failed to handle a GET request that matched no route')
  })

  it("doesn't quote a URL that can't be routed, and logs the request once it's answered, like the others", async () => {
    const logs: string[] = []
    const app = await buildApp(logs)
    const responses = [
      await app.inject({ method: 'GET', url: '/api/things/%zz' }),
      await app.inject({ method: 'GET', url: `/api/things/${'x'.repeat(101)}` }),
    ]
    expect(responses.map((response) => [response.statusCode, response.json()])).toEqual([
      [400, { ok: false, error: 'Invalid URL' }],
      [414, { ok: false, error: 'URL too long' }],
    ])
    const completed = logs.filter((line) => line.includes('"request completed"'))
    expect(completed.map((line) => JSON.parse(line))).toMatchObject([
      { res: { statusCode: 400 }, error: 'Invalid URL', responseTime: expect.any(Number) },
      { res: { statusCode: 414 }, error: 'URL too long' },
    ])
    for (const line of completed) expect(line.match(/"error"/g)).toHaveLength(1)
  })
})
