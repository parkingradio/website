import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

import { spaRoutes } from './spa.js'
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
  async function buildApp() {
    const app = Fastify()
    app.get('/api/real', async () => ({ ok: true }))
    await app.register(notFoundRoutes, { prefix: '/api' })
    await app.register(spaRoutes, { root })
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

  it('returns 404 for non-GET requests to unknown paths', async () => {
    const app = await buildApp()

    const response = await app.inject({ method: 'POST', url: '/archives' })

    expect(response.statusCode).toBe(404)
  })
})
