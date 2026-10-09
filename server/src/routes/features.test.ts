import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import type { FeatureId } from 'shared/features'
import { SESSION_COOKIE, signSessionToken } from '../auth.js'
import { NoSuchFeature } from '../features.js'
import type { FeaturesStore, StoredFeature } from '../features.js'
import { featuresRoutes } from './features.js'

// The flags, as the store would return them. There are no flags for now, so these tests use flags of their own.
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
  await app.register(fastifyCookie)
  await app.register(featuresRoutes, { store })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

// An admin's session cookie.
async function asAdmin() {
  return { [SESSION_COOKIE]: await signSessionToken({ id: 'admin-id', email: 'admin@example.com' }) }
}

async function send(app: App, method: 'GET' | 'PUT', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await asAdmin() })
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

  it('requires a session', async () => {
    const app = await buildApp()
    const requests = [
      app.inject({ method: 'GET', url: '/api/admin/features' }),
      app.inject({ method: 'PUT', url: '/api/admin/features/new-thing', payload: { enabled: true } }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(401)
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

    it("fails with 404 for a flag that doesn't exist", async () => {
      const app = await buildApp()
      const response = await send(app, 'PUT', '/api/admin/features/no-such-thing', { enabled: true })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such feature' })
    })

    it("refuses what isn't true or false", async () => {
      const app = await buildApp()
      for (const body of [{ enabled: 'true' }, { enabled: 1 }, { enabled: null }, {}]) {
        const response = await send(app, 'PUT', '/api/admin/features/new-thing', body)
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: '`enabled` must be true or false' })
      }
      expect(store.save).not.toHaveBeenCalled()
    })
  })
})
