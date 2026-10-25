import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'

const { selectResult, dbState } = vi.hoisted(() => ({
  selectResult: { rows: [] as Record<string, unknown>[] },
  dbState: {
    updatedPasswordHashes: [] as string[],
    updatedSessionVersions: [] as unknown[],
    deleteCallCount: 0,
    deleteWhereArgs: [] as unknown[],
  },
}))

vi.mock('../db.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectResult.rows),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        delete: () => ({
          where: (arg: unknown) => {
            dbState.deleteCallCount += 1
            dbState.deleteWhereArgs.push(arg)
            const rows = selectResult.rows
            selectResult.rows = [] // a real DELETE ... RETURNING can only return a row once
            return { returning: () => Promise.resolve(rows) }
          },
        }),
        update: () => ({
          set: (values: { passwordHash: string; sessionVersion: unknown }) => ({
            where: () => {
              dbState.updatedPasswordHashes.push(values.passwordHash)
              dbState.updatedSessionVersions.push(values.sessionVersion)
              return Promise.resolve()
            },
          }),
        }),
      }
      return fn(tx)
    },
  },
}))

import { eq } from 'drizzle-orm'
import { useZodSchemas } from '../api-schemas.js'
import { db } from '../db.js'
import { authRoutes, LOGIN_ATTEMPTS_PER_WINDOW } from './auth.js'
import { hashPassword, generateInviteToken, hashInviteToken, verifySessionToken } from '../auth.js'
import { config } from '../config.js'
import { acceptSessions, sessionCookies } from '../test-sessions.js'
import { invites } from '../schema.js'

describe('auth routes', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    selectResult.rows = []
    dbState.updatedPasswordHashes = []
    dbState.updatedSessionVersions = []
    dbState.deleteCallCount = 0
    dbState.deleteWhereArgs = []
    process.env.JWT_SECRET = 'test-secret'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  async function buildApp() {
    const app = Fastify()
    useZodSchemas(app)
    await app.register(fastifyCookie)
    acceptSessions(app)
    await app.register(authRoutes, { db })
    return app
  }

  describe('POST /api/auth/login', () => {
    it('logs in and sets a session cookie, of the current version of their sessions, when the password matches', async () => {
      selectResult.rows = [
        { id: 'user-1', email: 'admin@example.com', passwordHash: await hashPassword('correct-password'), sessionVersion: 2 },
      ]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin@example.com', password: 'correct-password' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, email: 'admin@example.com' })
      const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
      expect(await verifySessionToken(cookie!.value)).toEqual({ id: 'user-1', email: 'admin@example.com', sessionVersion: 2 })
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
      expect(response.json()).toEqual({ ok: false, error: 'Invalid email or password' })
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

    it('returns 400, saying why, when email or password is missing or not a string', async () => {
      const app = await buildApp()
      const refused: [unknown, string][] = [
        [{ email: 'admin@example.com' }, '`password`: Invalid input: expected string, received undefined'],
        [{ email: '', password: 'whatever' }, '`email`: Too small: expected string to have >=1 characters'],
        [{ email: 'admin@example.com', password: '' }, '`password`: Too small: expected string to have >=1 characters'],
        // Rather than failing with 500 once it gets to checking the password.
        [{ email: 'admin@example.com', password: 12345678 }, '`password`: Invalid input: expected string, received number'],
        [null, 'body: Invalid input: expected object, received null'],
      ]
      for (const [body, error] of refused) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify(body),
        })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
    })

    describe('rate limiting', () => {
      async function attemptLogin(app: FastifyInstance, clientAddress?: string) {
        return app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: clientAddress ? { 'cf-connecting-ip': clientAddress } : {},
          payload: { email: 'nobody@example.com', password: 'guess' },
        })
      }

      async function exhaustLoginAttempts(app: FastifyInstance, clientAddress?: string) {
        for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; ++i) {
          await attemptLogin(app, clientAddress)
        }
      }

      it('returns 429 once a client exceeds the allowed number of attempts', async () => {
        const app = await buildApp()

        for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; ++i) {
          expect((await attemptLogin(app)).statusCode).toBe(401)
        }

        const response = await attemptLogin(app)
        expect(response.statusCode).toBe(429)
        expect(response.json()).toEqual({ ok: false, error: 'Too many login attempts, try again in 15 minutes' })
      })

      it('counts attempts that fail with 400 too', async () => {
        const app = await buildApp()

        for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; ++i) {
          const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.com' } })
          expect(response.statusCode).toBe(400)
        }

        expect((await attemptLogin(app)).statusCode).toBe(429)
      })

      it('limits each client address reported by Cloudflare separately', async () => {
        const app = await buildApp()

        await exhaustLoginAttempts(app, '203.0.113.1')

        expect((await attemptLogin(app, '203.0.113.1')).statusCode).toBe(429)
        expect((await attemptLogin(app, '203.0.113.2')).statusCode).toBe(401)
      })

      it('does not limit other auth routes', async () => {
        const app = await buildApp()

        await exhaustLoginAttempts(app)

        const response = await app.inject({ method: 'POST', url: '/api/auth/logout' })
        expect(response.statusCode).toBe(200)
      })
    })
  })

  describe('POST /api/auth/logout', () => {
    it('clears the session cookie', async () => {
      const app = await buildApp()

      const response = await app.inject({ method: 'POST', url: '/api/auth/logout' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
      expect(cookie?.value).toBe('')
    })
  })

  describe('POST /api/auth/accept-invite', () => {
    it('activates the account and deletes the invite when the token is valid', async () => {
      const { token } = generateInviteToken()
      selectResult.rows = [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token, password: 'new-password-123' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(dbState.updatedPasswordHashes).toHaveLength(1)
      expect(dbState.updatedPasswordHashes[0]).not.toBe('new-password-123')
      // Which ends the sessions that started before, e.g. when the invite resets the password of an admin, by changing the
      // version of their sessions (incremented in SQL).
      expect(dbState.updatedSessionVersions[0]).toBeDefined()
      expect(dbState.deleteCallCount).toBe(1)
    })

    it('deletes only the redeemed invite, keyed by its token hash, not every invite for the user', async () => {
      // A sibling invite for the same user (e.g. created by a concurrent re-invite)
      // must survive redeeming this one.
      const { token } = generateInviteToken()
      selectResult.rows = [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }]
      const app = await buildApp()

      await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token, password: 'new-password-123' },
      })

      expect(dbState.deleteWhereArgs).toHaveLength(1)
      expect(dbState.deleteWhereArgs[0]).toEqual(eq(invites.tokenHash, hashInviteToken(token)))
      expect(dbState.deleteWhereArgs[0]).not.toEqual(eq(invites.userId, 'user-1'))
    })

    it('only lets one of two concurrent requests for the same token succeed', async () => {
      // Regression test for a TOCTOU race: the invite must be deleted atomically
      // as part of looking it up, not looked up and deleted in two separate steps,
      // or two concurrent requests could both pass the lookup before either delete runs.
      const { token } = generateInviteToken()
      selectResult.rows = [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }]
      const app = await buildApp()

      const [first, second] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/auth/accept-invite',
          payload: { token, password: 'new-password-123' },
        }),
        app.inject({
          method: 'POST',
          url: '/api/auth/accept-invite',
          payload: { token, password: 'other-password-456' },
        }),
      ])

      const statusCodes = [first.statusCode, second.statusCode].sort()
      expect(statusCodes).toEqual([200, 400])
      expect(dbState.updatedPasswordHashes).toHaveLength(1)
    })

    it('returns 400 for an unknown token, or an empty one', async () => {
      const app = await buildApp()

      for (const token of ['unknown-token', '']) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/accept-invite',
          payload: { token, password: 'new-password-123' },
        })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'Invalid or expired invite link' })
      }
      expect(dbState.updatedPasswordHashes).toHaveLength(0)
    })

    it('returns 400 for an expired token', async () => {
      const { token } = generateInviteToken()
      selectResult.rows = [{ userId: 'user-1', expiresAt: new Date(Date.now() - 60_000) }]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token, password: 'new-password-123' },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Invalid or expired invite link' })
      expect(dbState.updatedPasswordHashes).toHaveLength(0)
    })

    it('returns 400 when the password is shorter than 8 characters', async () => {
      const { token } = generateInviteToken()
      selectResult.rows = [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token, password: 'short' },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: '`password`: Too small: expected string to have >=8 characters' })
      expect(dbState.updatedPasswordHashes).toHaveLength(0)
    })

    it('returns 400 when token or password is missing', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: {},
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({
        ok: false,
        error: '`token`: Invalid input: expected string, received undefined, `password`: Invalid input: expected string, received undefined',
      })
    })

    it('returns 400 instead of crashing when token is not a string', async () => {
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token: 12345, password: 'new-password-123' },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: '`token`: Invalid input: expected string, received number' })
      expect(dbState.updatedPasswordHashes).toHaveLength(0)
    })

    it('returns 400 instead of crashing when password is not a string', async () => {
      const { token } = generateInviteToken()
      selectResult.rows = [{ id: 'invite-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token, password: 12345678 },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: '`password`: Invalid input: expected string, received number' })
      expect(dbState.updatedPasswordHashes).toHaveLength(0)
    })
  })

  describe('GET /api/admin/me', () => {
    it('returns 401 when there is no session cookie', async () => {
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/admin/me' })

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' })
    })

    it('returns the current user when the session cookie is valid', async () => {
      const app = await buildApp()

      const response = await app.inject({ method: 'GET', url: '/api/admin/me', cookies: await sessionCookies() })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, email: 'admin@example.com' })
    })
  })
})
