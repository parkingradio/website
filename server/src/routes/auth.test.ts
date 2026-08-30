import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'

const { selectResult } = vi.hoisted(() => ({
  selectResult: { rows: [] as { id: string; email: string; passwordHash: string | null }[] },
}))

vi.mock('../db.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectResult.rows),
      }),
    }),
  },
}))

import { authRoutes } from './auth.js'
import { hashPassword, SESSION_COOKIE } from '../auth.js'

describe('auth routes', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    selectResult.rows = []
    process.env.JWT_SECRET = 'test-secret'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  async function buildApp() {
    const app = Fastify()
    await app.register(fastifyCookie)
    await app.register(authRoutes)
    return app
  }

  describe('POST /api/auth/login', () => {
    it('logs in and sets a session cookie when the password matches', async () => {
      selectResult.rows = [
        { id: 'user-1', email: 'admin@example.com', passwordHash: await hashPassword('correct-password') },
      ]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@example.com', password: 'correct-password' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, email: 'admin@example.com' })
      expect(response.cookies.find((c) => c.name === SESSION_COOKIE)).toBeDefined()
    })

    it('returns 401 when the password does not match', async () => {
      selectResult.rows = [
        { id: 'user-1', email: 'admin@example.com', passwordHash: await hashPassword('correct-password') },
      ]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@example.com', password: 'wrong-password' },
      })

      expect(response.statusCode).toBe(401)
    })

    it('returns 401 when the email is unknown', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'whatever' },
      })

      expect(response.statusCode).toBe(401)
    })

    it('returns 401 for a pending user who has not set a password yet', async () => {
      selectResult.rows = [{ id: 'user-1', email: 'pending@example.com', passwordHash: null }]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'pending@example.com', password: 'whatever' },
      })

      expect(response.statusCode).toBe(401)
    })

    it('returns 400 when email or password is missing', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@example.com' },
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
