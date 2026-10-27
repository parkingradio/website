import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import type { FeatureId, FeaturesStore, StoredFeature } from '../features/store.js'
import { configRoutes } from './runtime-config.js'

// These tests use flags of their own, so that they don't depend on which flags there are.
vi.mock('../features/store.js', async (importOriginal) => {
  const { z } = await import('zod')
  const FEATURES = ['new-thing', 'other-thing'] as const
  return { ...(await importOriginal<typeof import('../features/store.js')>()), FEATURES, FeatureId: z.enum(FEATURES) }
})

describe('GET /api/config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  // If `logs` is given, every line the app logs is added to it.
  async function buildApp(store: Pick<FeaturesStore, 'load'>, logs?: string[]) {
    process.env.ASSETS_DOMAIN = 'assets.example.test'
    process.env.TURNSTILE_SITE_KEY = 'site-key'
    const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
    useZodSchemas(app)
    await app.register(configRoutes, { store })
    return app
  }

  const flag = (id: string, enabled: boolean): StoredFeature => ({ id: id as FeatureId, enabled, updatedBy: null, updatedAt: null })

  it('returns the assets domain, the Turnstile site key and whether each feature is on', async () => {
    const app = await buildApp({ load: async () => [flag('new-thing', true), flag('other-thing', false)] })

    const response = await app.inject({ method: 'GET', url: '/api/config' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      assetsDomain: 'assets.example.test',
      turnstileSiteKey: 'site-key',
      features: { 'new-thing': true, 'other-thing': false },
    })
  })

  it('is never cached, so that turning a flag off takes effect right away', async () => {
    const app = await buildApp({ load: async () => [] })
    const response = await app.inject({ method: 'GET', url: '/api/config' })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it("turns every flag off, rather than failing, when they can't be read", async () => {
    const logs: string[] = []
    const app = await buildApp(
      {
        load: async () => {
          throw new Error('connection refused')
        },
      },
      logs,
    )

    const response = await app.inject({ method: 'GET', url: '/api/config' })

    expect(response.statusCode).toBe(200)
    // A flag that isn't there is off (see `useFeature` in the client).
    expect(response.json()).toEqual({ assetsDomain: 'assets.example.test', turnstileSiteKey: 'site-key', features: {} })
    expect(logs.some((line) => line.includes('Failed to load the feature flags'))).toBe(true)
  })
})
