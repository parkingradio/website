import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'

const { selectResult, dbState } = vi.hoisted(() => ({
  // `failure`, when set, is what selecting fails with.
  selectResult: { rows: [] as Record<string, unknown>[], failure: null as Error | null },
  dbState: {
    selects: 0,
    updatedPasswordHashes: [] as string[],
    updatedSessionVersions: [] as unknown[],
    deleteWhereArgs: [] as unknown[],
  },
}))

vi.mock('../db/connection.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          dbState.selects++
          return selectResult.failure ? Promise.reject(selectResult.failure) : Promise.resolve(selectResult.rows)
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        delete: () => ({
          where: (arg: unknown) => {
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

// Spied on, to check that logging in checks a password whoever the email is.
vi.mock('./auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.js')>()
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) }
})

import { DrizzleQueryError, eq } from 'drizzle-orm'
import { useZodSchemas } from '../api/schemas.js'
import { db } from '../db/connection.js'
import { authRoutes, LOGIN_ATTEMPTS_PER_WINDOW } from './auth-routes.js'
import { hashPassword, nowSeconds, signSessionToken, verifyPassword, verifySessionToken, SESSION_IDLE_SECONDS } from './auth.js'
import type { TurnstileVerifier } from '../api/turnstile.js'
import { generateToken, hashToken } from '../core/tokens.js'
import { config } from '../core/config.js'
import { acceptSessions, sessionCookies } from './test-sessions.js'
import { invites, oauthCodes, oauthConnections } from '../db/schema.js'

const DAY = 24 * 60 * 60

// Vouches for "the-token" only.
const verifyTurnstile = vi.fn<TurnstileVerifier>(async (token) =>
  token === 'the-token' ? { success: true } : { success: false, errorCodes: ['invalid-input-response'] },
)

describe('auth routes', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    selectResult.rows = []
    selectResult.failure = null
    dbState.selects = 0
    dbState.updatedPasswordHashes = []
    dbState.updatedSessionVersions = []
    dbState.deleteWhereArgs = []
    process.env.JWT_SECRET = 'test-secret'
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.useRealTimers()
  })

  // If `logs` is given, every line the app logs is added to it.
  async function buildApp(logs?: string[]) {
    const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
    useZodSchemas(app)
    await app.register(fastifyCookie)
    acceptSessions(app)
    await app.register(authRoutes, { db, verifyTurnstile })
    return app
  }

  describe('POST /api/auth/login', () => {
    // Logs in with the token Turnstile vouches for, unless `body` has another one.
    function login(app: FastifyInstance, body: object, { clientAddress, cookies }: { clientAddress?: string; cookies?: Record<string, string> } = {}) {
      return app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: clientAddress ? { 'cf-connecting-ip': clientAddress } : {},
        cookies,
        payload: { turnstileToken: 'the-token', ...body },
      })
    }

    it('logs in and sets a session cookie, of the current version of their sessions, when the password matches', async () => {
      selectResult.rows = [
        { id: 'user-1', email: 'admin@example.com', passwordHash: await hashPassword('correct-password'), sessionVersion: 2 },
      ]
      const app = await buildApp()

      const response = await login(app, { email: 'admin@example.com', password: 'correct-password' }, { clientAddress: '198.51.100.7' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, email: 'admin@example.com' })
      expect(verifyTurnstile).toHaveBeenCalledExactlyOnceWith('the-token', '198.51.100.7')
      const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
      const session = await verifySessionToken(cookie!.value)
      expect(session?.admin).toEqual({ id: 'user-1', email: 'admin@example.com', sessionVersion: 2 })
      // It starts now, and lasts 7 days.
      expect(session?.loggedInAt).toBe(session?.issuedAt)
      expect(cookie!.maxAge).toBe(SESSION_IDLE_SECONDS)
    })

    it('starts a new session when logging in again, rather than renewing the one there was', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const user = { id: 'user-1', email: 'admin@example.com', sessionVersion: 0 }
      const before = await signSessionToken(user, { loggedInAt: nowSeconds() - 20 * DAY })
      selectResult.rows = [{ ...user, passwordHash: await hashPassword('correct-password') }]
      const app = await buildApp()

      const response = await login(app, { email: 'admin@example.com', password: 'correct-password' }, { cookies: { [config.sessionCookie]: before } })

      const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
      expect((await verifySessionToken(cookie!.value))?.loggedInAt).toBe(nowSeconds())
      expect(cookie!.maxAge).toBe(SESSION_IDLE_SECONDS)
    })

    // A password is checked, once, whoever the email is, so that how long a 401 takes doesn't tell whether the email is an
    // admin's, nor whether that admin has chosen a password yet.
    it('returns 401, having checked the password once, for a wrong password, an unknown email, or an admin who has not chosen a password yet', async () => {
      const app = await buildApp()
      // Against a hash of the same cost as an admin's, which bcrypt's take as long to check: the first 7 characters of a
      // bcrypt hash are its version and its cost, e.g. "$2b$10$".
      const cost = (await hashPassword('x')).slice(0, 7)
      const users = [
        { id: 'user-1', email: 'admin@example.com', passwordHash: await hashPassword('correct-password') },
        null,
        { id: 'user-2', email: 'pending@example.com', passwordHash: null },
      ]
      for (const user of users) {
        selectResult.rows = user ? [user] : []
        vi.mocked(verifyPassword).mockClear()

        const response = await login(app, { email: user?.email ?? 'nobody@example.com', password: 'wrong-password' })

        expect(response.statusCode).toBe(401)
        expect(response.json()).toEqual({ ok: false, error: 'Invalid email or password' })
        expect(verifyPassword).toHaveBeenCalledOnce()
        const [password, hash] = vi.mocked(verifyPassword).mock.calls[0]
        expect(password).toBe('wrong-password')
        expect(hash.slice(0, 7)).toBe(cost)
      }
    })

    it('returns 400, without looking up the email or checking the password, when Turnstile refuses the token, even an empty one', async () => {
      selectResult.rows = [{ id: 'user-1', email: 'admin@example.com', passwordHash: await hashPassword('correct-password') }]
      const app = await buildApp()

      for (const turnstileToken of ['refused', '']) {
        const response = await login(app, { email: 'admin@example.com', password: 'correct-password', turnstileToken })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'The anti-bot check failed, try again' })
        expect(response.cookies).toEqual([])
      }
      expect(dbState.selects).toBe(0)
      expect(verifyPassword).not.toHaveBeenCalled()
    })

    it('returns 502, without looking up the email or checking the password, when Turnstile cannot be reached', async () => {
      verifyTurnstile.mockRejectedValueOnce(new Error('fetch failed'))
      const app = await buildApp()

      const response = await login(app, { email: 'admin@example.com', password: 'correct-password' })

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ ok: false, error: "The anti-bot check couldn't be done, try again in a few minutes" })
      expect(dbState.selects).toBe(0)
      expect(verifyPassword).not.toHaveBeenCalled()
    })

    it('returns 400, saying why, without checking the token, when a field is missing or not a string', async () => {
      const app = await buildApp()
      const refused: [unknown, string][] = [
        [{ email: 'admin@example.com', turnstileToken: 'the-token' }, '`password`: Invalid input: expected string, received undefined'],
        [{ email: '', password: 'whatever', turnstileToken: 'the-token' }, '`email`: Too small: expected string to have >=1 characters'],
        [{ email: 'admin@example.com', password: '', turnstileToken: 'the-token' }, '`password`: Too small: expected string to have >=1 characters'],
        // Rather than failing with 500 once it gets to checking the password.
        [{ email: 'admin@example.com', password: 12345678, turnstileToken: 'the-token' }, '`password`: Invalid input: expected string, received number'],
        [{ email: 'admin@example.com', password: 'whatever' }, '`turnstileToken`: Invalid input: expected string, received undefined'],
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
      expect(verifyTurnstile).not.toHaveBeenCalled()
    })

    it('keeps the email out of the logs and the response when the database fails', async () => {
      const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
      selectResult.failure = new DrizzleQueryError('select ... where lower("email") = lower($1)', ['admin@example.com'], cause)
      const logs: string[] = []
      const app = await buildApp(logs)

      const response = await login(app, { email: 'admin@example.com', password: 'whatever' })

      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
      expect(logs.join('')).toContain('57P01')
      expect(logs.join('')).not.toContain('admin@example.com')
    })

    describe('rate limiting', () => {
      async function attemptLogin(app: FastifyInstance, clientAddress?: string) {
        return login(app, { email: 'nobody@example.com', password: 'guess' }, { clientAddress })
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

      it('counts attempts that fail with 400 too, for their fields or their token', async () => {
        const app = await buildApp()

        for (let i = 0; i < LOGIN_ATTEMPTS_PER_WINDOW; ++i) {
          const body = i % 2 ? { email: 'nobody@example.com' } : { email: 'nobody@example.com', password: 'guess', turnstileToken: 'refused' }
          expect((await login(app, body)).statusCode).toBe(400)
        }

        expect((await attemptLogin(app)).statusCode).toBe(429)
        // Not even for the attempt that went over the limit.
        expect(verifyTurnstile).toHaveBeenCalledTimes(LOGIN_ATTEMPTS_PER_WINDOW / 2)
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
    it('activates the account, deletes the invite, and ends the connections of apps when the token is valid', async () => {
      const { token } = generateToken()
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
      // And the apps they connected, along with the codes they were given.
      expect(dbState.deleteWhereArgs.slice(1)).toEqual([eq(oauthCodes.userId, 'user-1'), eq(oauthConnections.userId, 'user-1')])
    })

    it("clears the session cookie, logging out whoever was logged in in this browser, e.g. the admin who sent the invite", async () => {
      const { token } = generateToken()
      selectResult.rows = [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token, password: 'new-password-123' },
        cookies: await sessionCookies(),
      })

      expect(response.statusCode).toBe(200)
      const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
      expect(cookie?.value).toBe('')
      expect(cookie?.path).toBe('/')
      expect(cookie?.expires!.getTime()).toBeLessThan(Date.now())
    })

    it('deletes only the redeemed invite, keyed by its token hash, not every invite for the user', async () => {
      // A sibling invite for the same user (e.g. created by a concurrent re-invite)
      // must survive redeeming this one.
      const { token } = generateToken()
      selectResult.rows = [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60_000) }]
      const app = await buildApp()

      await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token, password: 'new-password-123' },
      })

      expect(dbState.deleteWhereArgs[0]).toEqual(eq(invites.tokenHash, hashToken(token)))
      expect(dbState.deleteWhereArgs).not.toContainEqual(eq(invites.userId, 'user-1'))
    })

    it('only lets one of two concurrent requests for the same token succeed', async () => {
      // Regression test for a TOCTOU race: the invite must be deleted atomically
      // as part of looking it up, not looked up and deleted in two separate steps,
      // or two concurrent requests could both pass the lookup before either delete runs.
      const { token } = generateToken()
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
          cookies: await sessionCookies(),
        })

        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'Invalid or expired invite link' })
        // Whoever was logged in stays so.
        expect(response.headers['set-cookie']).toBeUndefined()
      }
      expect(dbState.updatedPasswordHashes).toHaveLength(0)
    })

    it('returns 400 for an expired token', async () => {
      const { token } = generateToken()
      selectResult.rows = [{ userId: 'user-1', expiresAt: new Date(Date.now() - 60_000) }]
      const app = await buildApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        payload: { token, password: 'new-password-123' },
        cookies: await sessionCookies(),
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Invalid or expired invite link' })
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(dbState.updatedPasswordHashes).toHaveLength(0)
    })

    it('returns 400 when the password is shorter than 8 characters', async () => {
      const { token } = generateToken()
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
      const { token } = generateToken()
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
      // A session that just started isn't renewed.
      expect(response.cookies).toEqual([])
    })

    it('renews a session whose cookie is more than a day old, as opening an admin page does', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const app = await buildApp()
      const cookies = await sessionCookies()
      vi.advanceTimersByTime(2 * DAY * 1000)

      const response = await app.inject({ method: 'GET', url: '/api/admin/me', cookies })

      expect(response.statusCode).toBe(200)
      const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
      const session = await verifySessionToken(cookie!.value)
      expect(session?.issuedAt).toBe(nowSeconds())
      expect(session?.loggedInAt).toBe(session!.issuedAt - 2 * DAY)
      expect(cookie!.maxAge).toBe(SESSION_IDLE_SECONDS)
    })
  })
})
