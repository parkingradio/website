import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { NoSuchFeature } from './store.js'
import type { FeatureId, FeaturesStore, StoredFeature } from './store.js'
import { featuresRoutes } from './routes.js'

// These tests use flags of their own, so that they don't depend on which flags there are.
vi.mock('./store.js', async (importOriginal) => {
  const { z } = await import('zod')
  const FEATURES = ['new-thing', 'other-thing'] as const
  return { ...(await importOriginal<typeof import('./store.js')>()), FEATURES, FeatureId: z.enum(FEATURES) }
})

// The flags, as the store would return them.
let flags: StoredFeature[] = []
const store: FeaturesStore = {
  load: async () => flags,
  save: vi.fn<FeaturesStore['save']>(async (id, enabled, updatedBy) => {
    if (!flags.some((flag) => flag.id === id)) throw new NoSuchFeature()
    const saved = { id: id as FeatureId, enabled, updatedBy, updatedAt: new Date() }
    flags = flags.map((flag) => (flag.id === id ? saved : flag))
    return saved
  }),
}

async function buildApp() {
  const app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(featuresRoutes, { store })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function send(app: App, method: 'GET' | 'PUT', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

describe('features routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    flags = ['new-thing', 'other-thing'].map((id) => ({ id: id as FeatureId, enabled: false, updatedBy: null, updatedAt: null }))
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it('requires a session, whatever the request', async () => {
    const app = await buildApp()
    const requests = [
      app.inject({ method: 'GET', url: '/api/admin/features' }),
      app.inject({ method: 'PUT', url: '/api/admin/features/new-thing', payload: { enabled: true } }),
      app.inject({ method: 'PUT', url: '/api/admin/features/new-thing', payload: { enabled: 'yes' } }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' })
    }
    expect(store.save).not.toHaveBeenCalled()
  })

  it('refuses changes from another origin, whatever the request', async () => {
    const app = await buildApp()
    for (const payload of [{ enabled: true }, { enabled: 'yes' }]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/features/new-thing',
        payload,
        headers: { 'sec-fetch-site': 'cross-site' },
        cookies: await sessionCookies(),
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ ok: false, error: 'Cross-origin request refused' })
    }
    expect(store.save).not.toHaveBeenCalled()
  })

  it('lists every flag', async () => {
    const app = await buildApp()
    const response = await send(app, 'GET', '/api/admin/features')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      features: [
        { id: 'new-thing', enabled: false, updatedBy: null, updatedAt: null },
        { id: 'other-thing', enabled: false, updatedBy: null, updatedAt: null },
      ],
    })
  })

  it("fails rather than send flags that aren't the server's", async () => {
    flags = [{ id: 'retired-thing' as FeatureId, enabled: true, updatedBy: null, updatedAt: null }]
    const app = await buildApp()
    const response = await send(app, 'GET', '/api/admin/features')
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
  })

  describe('PUT /api/admin/features/:id', () => {
    it('turns a flag on or off, with who did it and when, and returns it', async () => {
      const app = await buildApp()
      const before = Date.now()
      const response = await send(app, 'PUT', '/api/admin/features/other-thing', { enabled: true })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toEqual({
        ok: true,
        feature: { id: 'other-thing', enabled: true, updatedBy: 'admin@example.com', updatedAt: expect.any(String) },
      })
      expect(Date.parse(body.feature.updatedAt)).toBeGreaterThanOrEqual(before)
      expect(store.save).toHaveBeenCalledWith('other-thing', true, 'admin@example.com')

      const off = await send(app, 'PUT', '/api/admin/features/other-thing', { enabled: false })
      expect(off.json().feature.enabled).toBe(false)
    })

    it("fails with 404 for a flag that doesn't exist, e.g. one that was retired", async () => {
      const app = await buildApp()
      const response = await send(app, 'PUT', '/api/admin/features/no-such-thing', { enabled: true })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such feature' })
    })

    it("refuses what isn't true or false, saying why", async () => {
      const app = await buildApp()
      const refused: [unknown, string][] = [
        [{ enabled: 'true' }, '`enabled`: Invalid input: expected boolean, received string'],
        [{ enabled: 1 }, '`enabled`: Invalid input: expected boolean, received number'],
        [{ enabled: null }, '`enabled`: Invalid input: expected boolean, received null'],
        [{}, '`enabled`: Invalid input: expected boolean, received undefined'],
        [null, 'body: Invalid input: expected object, received null'],
        ['true', 'body: Invalid input: expected object, received string'],
      ]
      for (const [body, error] of refused) {
        const response = await app.inject({
          method: 'PUT',
          url: '/api/admin/features/new-thing',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify(body),
          cookies: await sessionCookies(),
        })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      expect(store.save).not.toHaveBeenCalled()
    })
  })
})
