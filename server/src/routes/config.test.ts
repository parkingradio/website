import { afterEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

import { configRoutes } from './config.js'

describe('GET /api/config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns the assets domain', async () => {
    process.env.ASSETS_DOMAIN = 'assets.example.test'
    const app = Fastify()
    await app.register(configRoutes)

    const response = await app.inject({ method: 'GET', url: '/api/config' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ assetsDomain: 'assets.example.test' })
  })
})
