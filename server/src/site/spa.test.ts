import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { spaRoutes } from './spa.js'
import { useZodSchemas } from '../api/schemas.js'
import { notFoundRoutes } from './not-found.js'

const INDEX_HTML = '<title>parking.radio</title>'

describe('SPA fallback', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'spa-test-'))
    writeFileSync(path.join(root, 'index.html'), INDEX_HTML)
    writeFileSync(path.join(root, 'favicon.ico'), 'icon')
    mkdirSync(path.join(root, 'assets'))
    writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log(1)')
  })

  afterAll(() => {
    rmSync(root, { recursive: true })
  })

  // Registered the same way as in index.ts.
  async function buildApp(spaRoot = root) {
    const app = Fastify()
    useZodSchemas(app)
    app.get('/api/real', async () => ({ ok: true }))
    await app.register(notFoundRoutes, { prefix: '/api' })
    await app.register(spaRoutes, { root: spaRoot })
    return app
  }

  it('serves files from the client build', async () => {
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url: '/assets/app.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('console.log(1)')
  })

  it('lets the content-hashed build files be cached forever', async () => {
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url: '/assets/app.js' })

    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it.each(['/', '/archives', '/favicon.ico'])('has %s revalidated on every request', async (url) => {
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('public, max-age=0')
  })

  it('still serves existing API routes', async () => {
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url: '/api/real' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
  })

  it.each(['/', '/archives?foo=bar', '/apiary', '/assetsfoo'])('serves index.html for %s', async (url) => {
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/html/)
    expect(response.body).toBe(INDEX_HTML)
  })

  it.each(['/', '/archives', '/assets/app.js'])("can't be shown in another site's frame: %s", async (url) => {
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url })

    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['content-security-policy']).toBe("frame-ancestors 'none'")
  })

  it('answers HEAD requests for client-side routes', async () => {
    const app = await buildApp()

    const response = await app.inject({ method: 'HEAD', url: '/archives' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/html/)
    expect(response.body).toBe('')
  })

  it.each(['/api', '/api/', '/api/typo', '/api/admin/nope?x=1', '/api?x=1', '/assets/missing.js'])(
    'returns a JSON 404 for %s',
    async (url) => {
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'Not found' })
    },
  )

  it('returns a JSON 404 for non-GET requests to unknown paths, whatever their body', async () => {
    const app = await buildApp()

    const responses = [
      await app.inject({ method: 'POST', url: '/archives' }),
      await app.inject({ method: 'DELETE', url: '/archives', payload: '{not json', headers: { 'content-type': 'application/json' } }),
    ]

    for (const response of responses) {
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'Not found' })
    }
  })

  // Rather than with a 404, although it's the not-found handler that refuses them.
  it.each([
    [{ range: 'bytes=999-' }, 416, 'Range Not Satisfiable'],
    [{ 'if-match': '"nope"' }, 412, 'Precondition Failed'],
  ])('refuses to send index.html for %j with %i', async (headers, status, error) => {
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url: '/archives', headers })

    expect(response.statusCode).toBe(status)
    expect(response.json()).toEqual({ ok: false, error })
  })

  // Even for /archives, where it's the not-found handler that fails, and without the headers that would let the error be
  // cached as the file.
  it.skipIf(process.getuid?.() === 0).each(['/archives', '/assets/app.js'])("fails with 500 when it can't read the file for %s", async (url) => {
    // Which the tests can't read, since they don't run as root.
    const unreadable = path.join(root, `unreadable-${url.replaceAll('/', '-')}`)
    mkdirSync(path.join(unreadable, 'assets'), { recursive: true })
    writeFileSync(path.join(unreadable, 'index.html'), INDEX_HTML, { mode: 0o000 })
    writeFileSync(path.join(unreadable, 'assets', 'app.js'), 'console.log(1)', { mode: 0o000 })
    const app = await buildApp(unreadable)

    const response = await app.inject({ method: 'GET', url })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
    for (const header of ['cache-control', 'etag', 'last-modified']) expect(response.headers).not.toHaveProperty(header)
  })
})
