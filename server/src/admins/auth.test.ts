import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { SignJWT, decodeJwt } from 'jose'
import { z } from 'zod'
import { config } from '../core/config.js'
import { Ok, useZodSchemas, zodRoutes } from '../api/schemas.js'
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  nowSeconds as now,
  SESSION_IDLE_SECONDS,
} from './auth.js'
import { sessionCookies } from './test-sessions.js'

const DAY = 24 * 60 * 60
const ADMIN = { id: 'user-1', email: 'admin@example.com', sessionVersion: 0 }

// A token with `claims`, signed with the test secret, e.g. one signed before sessions were renewed.
function signed(claims: Record<string, unknown>) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('test-secret'))
}

describe('passwords', () => {
  it('does not just return the password unchanged', async () => {
    const hash = await hashPassword('correct-password')
    expect(hash).not.toBe('correct-password')
  })

  it('verifies a matching password against its hash', async () => {
    const hash = await hashPassword('correct-password')
    expect(await verifyPassword('correct-password', hash)).toBe(true)
  })

  it('rejects a non-matching password', async () => {
    const hash = await hashPassword('correct-password')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })
})

describe('session tokens', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.useRealTimers()
  })

  it('round-trips a signed token back to the user it was signed for, the version of their sessions, and when they logged in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com', sessionVersion: 3 })
    expect(await verifySessionToken(token)).toEqual({
      admin: { id: 'user-1', email: 'admin@example.com', sessionVersion: 3 },
      issuedAt: now(),
      loggedInAt: now(),
    })
    expect(decodeJwt(token).exp).toBe(now() + SESSION_IDLE_SECONDS)
  })

  it('keeps when the admin logged in, when told', async () => {
    const loggedInAt = now() - 20 * DAY
    expect((await verifySessionToken(await signSessionToken(ADMIN, { loggedInAt })))?.loggedInAt).toBe(loggedInAt)
  })

  it('reads the tokens signed before sessions had versions as being of the first version', async () => {
    const token = await signed({ sub: 'user-1', email: 'admin@example.com', iat: now(), exp: now() + 3600 })
    expect((await verifySessionToken(token))?.admin).toEqual({ id: 'user-1', email: 'admin@example.com', sessionVersion: 0 })
  })

  it('reads the tokens signed before sessions were renewed as logged in when they were signed', async () => {
    const issuedAt = now() - DAY
    const token = await signed({ sub: 'user-1', email: 'admin@example.com', ver: 0, iat: issuedAt, exp: now() + 3600 })
    expect(await verifySessionToken(token)).toEqual({ admin: ADMIN, issuedAt, loggedInAt: issuedAt })
  })

  it('rejects a token without when it was signed, or when it expires', async () => {
    const claims = { sub: 'user-1', email: 'admin@example.com', ver: 0, auth_time: now() }
    expect(await verifySessionToken(await signed({ ...claims, exp: now() + 3600 }))).toBeNull()
    expect(await verifySessionToken(await signed({ ...claims, iat: now() }))).toBeNull()
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signSessionToken(ADMIN)
    process.env.JWT_SECRET = 'different-secret'
    expect(await verifySessionToken(token)).toBeNull()
  })

  it('rejects a tampered token', async () => {
    const token = await signSessionToken(ADMIN)
    const [header, payload, signature] = token.split('.')
    const tamperedChar = signature[0] === 'a' ? 'b' : 'a'
    const tamperedSignature = tamperedChar + signature.slice(1)
    expect(await verifySessionToken(`${header}.${payload}.${tamperedSignature}`)).toBeNull()
  })

  it('rejects garbage input', async () => {
    expect(await verifySessionToken('not-a-jwt')).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    const token = await signSessionToken(ADMIN)
    vi.advanceTimersByTime((SESSION_IDLE_SECONDS + 1) * 1000)
    expect(await verifySessionToken(token)).toBeNull()
  })

  it('makes a shorter session when told to', async () => {
    vi.useFakeTimers()
    const token = await signSessionToken(ADMIN, { seconds: 60 })
    vi.advanceTimersByTime(59 * 1000)
    expect(await verifySessionToken(token)).not.toBeNull()
    vi.advanceTimersByTime(2 * 1000)
    expect(await verifySessionToken(token)).toBeNull()
  })
})

describe('requireAuth', () => {
  const originalEnv = { ...process.env }
  // The version of the sessions of the admin asked about, as the database would say. Null for an admin who was revoked.
  let version: number
  const sessionVersion = vi.fn(async (id: string) => (id === 'user-1' ? version : null))

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    version = 0
    sessionVersion.mockClear()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  function buildApp() {
    const app = Fastify()
    app.register(fastifyCookie)
    app.decorate('adminSessions', { sessionVersion })
    app.get('/protected', { preHandler: requireAuth }, async (request) => ({ user: request.user }))
    return app
  }

  async function getProtected(app: ReturnType<typeof buildApp>, user = { id: 'user-1', email: 'admin@example.com', sessionVersion: 0 }) {
    return app.inject({ method: 'GET', url: '/protected', cookies: await sessionCookies(user) })
  }

  it('returns 401 when there is no session cookie', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/protected' })
    expect(response.statusCode).toBe(401)
  })

  it('returns 401 when the session cookie is garbage', async () => {
    const app = buildApp()
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `${config.sessionCookie}=garbage` },
    })
    expect(response.statusCode).toBe(401)
  })

  it('calls the handler with request.user set when the session cookie is valid', async () => {
    const response = await getProtected(buildApp())
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ user: { id: 'user-1', email: 'admin@example.com', sessionVersion: 0 } })
    expect(sessionVersion).toHaveBeenCalledWith('user-1')
  })

  it('returns 401 for the session of an admin who was revoked', async () => {
    const response = await getProtected(buildApp(), { id: 'revoked-user', email: 'revoked@example.com', sessionVersion: 0 })
    expect(response.statusCode).toBe(401)
  })

  it('returns 401 for a session that started before the admin chose a new password', async () => {
    const app = buildApp()
    const cookies = await sessionCookies({ id: 'user-1', email: 'admin@example.com', sessionVersion: 0 })
    version = 1
    expect((await app.inject({ method: 'GET', url: '/protected', cookies })).statusCode).toBe(401)
    // While the sessions that started after it are valid.
    expect((await getProtected(app, { id: 'user-1', email: 'admin@example.com', sessionVersion: 1 })).statusCode).toBe(200)
  })

  it("refuses requests that change something from another origin's page, even with a valid session", async () => {
    const app = buildApp()
    app.post('/protected', { preHandler: requireAuth }, async () => ({ ok: true }))
    const cookie = `${config.sessionCookie}=${await signSessionToken(ADMIN)}`
    const post = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/protected', headers: { cookie, host: 'parking.radio', ...headers } })

    // E.g. a form on another subdomain, which SameSite=Lax sends the cookie from.
    for (const site of ['same-site', 'cross-site']) {
      const response = await post({ 'sec-fetch-site': site })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ ok: false, error: 'Cross-origin request refused' })
    }
    // Browsers that don't send Sec-Fetch-Site are told apart by Origin.
    expect((await post({ origin: 'https://beta.parking.radio' })).statusCode).toBe(403)
    expect((await post({ origin: 'null' })).statusCode).toBe(403)

    expect((await post({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(200)
    expect((await post({ origin: 'https://parking.radio' })).statusCode).toBe(200)
    // Not from a browser's page, e.g. curl.
    expect((await post({})).statusCode).toBe(200)
    // Reading is fine, e.g. an image on another page.
    const read = await app.inject({ method: 'GET', url: '/protected', headers: { cookie, 'sec-fetch-site': 'cross-site' } })
    expect(read.statusCode).toBe(200)
  })
})

describe('renewing sessions', () => {
  const originalEnv = { ...process.env }
  // The version of the sessions of the admin asked about, as the database would say.
  let version: number

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    version = 0
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.useRealTimers()
  })

  // An app set up like the server's, errors included, with admin routes that answer, that take a body, and that fail.
  async function buildApp() {
    const app = Fastify()
    useZodSchemas(app)
    await app.register(fastifyCookie)
    app.decorate('adminSessions', { sessionVersion: async (id: string) => (id === ADMIN.id ? version : null) })
    const api = zodRoutes(app)
    const admin = { admin: true, tool: null }
    api.get('/api/admin/thing', { config: admin, schema: { response: { 200: Ok } } }, async (request) => {
      // The admin, as routes get them, without when they logged in.
      expect(Object.keys(request.user!)).toEqual(['id', 'email', 'sessionVersion'])
      return { ok: true as const }
    })
    api.put('/api/admin/thing', { config: admin, schema: { body: z.object({ on: z.boolean() }), response: { 200: Ok } } }, async () => ({
      ok: true as const,
    }))
    api.get('/api/admin/broken', { config: admin, schema: { response: { 200: Ok } } }, async () => {
      throw new Error('broken')
    })
    return app
  }

  // The session cookie that a request with `token` gets back, if any.
  async function send(app: Awaited<ReturnType<typeof buildApp>>, token: string, request: { method?: 'GET' | 'PUT'; url?: string; payload?: object; headers?: Record<string, string> } = {}) {
    const response = await app.inject({ method: 'GET', url: '/api/admin/thing', ...request, cookies: { [config.sessionCookie]: token } })
    return { status: response.statusCode, cookie: response.cookies.find((c) => c.name === config.sessionCookie) }
  }

  function days(n: number) {
    vi.advanceTimersByTime(n * DAY * 1000)
  }

  it('gives a new cookie for the same session once its own is more than a day old, which lasts 7 days from then', async () => {
    const app = await buildApp()
    const loggedInAt = now()
    const token = await signSessionToken({ ...ADMIN, sessionVersion: 2 })
    version = 2

    days(1)
    expect(await send(app, token)).toEqual({ status: 200, cookie: undefined })
    vi.advanceTimersByTime(1000)
    const { status, cookie } = await send(app, token)
    expect(status).toBe(200)
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_IDLE_SECONDS })
    expect(cookie!.secure).toBeFalsy()
    expect(decodeJwt(cookie!.value)).toEqual({
      sub: ADMIN.id,
      email: ADMIN.email,
      ver: 2,
      auth_time: loggedInAt,
      iat: now(),
      exp: now() + SESSION_IDLE_SECONDS,
    })
    // Which isn't renewed again for a day.
    expect((await send(app, cookie!.value)).cookie).toBeUndefined()

    process.env.NODE_ENV = 'production'
    expect((await send(app, token)).cookie!.secure).toBe(true)
  })

  it('keeps a session going for 30 days after logging in at most', async () => {
    const app = await buildApp()
    const loggedInAt = now()
    let token = await signSessionToken(ADMIN)
    for (const day of [6, 12, 18, 24]) {
      days(6)
      const { cookie } = await send(app, token)
      expect(cookie!.maxAge, `on day ${day}`).toBe(Math.min(SESSION_IDLE_SECONDS, (30 - day) * DAY))
      token = cookie!.value
    }
    days(5.5)
    const { cookie } = await send(app, token)
    expect(cookie!.maxAge).toBe(DAY / 2)
    expect(decodeJwt(cookie!.value)).toMatchObject({ auth_time: loggedInAt, exp: loggedInAt + 30 * DAY })
    vi.advanceTimersByTime((DAY / 2 - 1) * 1000)
    expect((await send(app, cookie!.value)).status).toBe(200)
    vi.advanceTimersByTime(1000)
    expect(await send(app, cookie!.value)).toEqual({ status: 401, cookie: undefined })
  })

  it('counts the 30 days of the sessions that started before they were renewed from when they were signed', async () => {
    const app = await buildApp()
    const signedAt = now()
    const token = await signed({ sub: ADMIN.id, email: ADMIN.email, ver: 0, iat: signedAt, exp: signedAt + SESSION_IDLE_SECONDS })
    days(2)
    const renewed = (await send(app, token)).cookie!.value
    expect(decodeJwt(renewed)).toMatchObject({ auth_time: signedAt, exp: now() + SESSION_IDLE_SECONDS })
    days(6)
    expect(decodeJwt((await send(app, renewed)).cookie!.value)).toMatchObject({ auth_time: signedAt })
  })

  it('renews sessions whatever the response, e.g. a request that fails validation, or the server', async () => {
    const app = await buildApp()
    const token = await signSessionToken(ADMIN)
    days(2)
    const sameOrigin = { 'sec-fetch-site': 'same-origin' }
    const requests = [
      [200, { method: 'PUT', payload: { on: true }, headers: sameOrigin }],
      [400, { method: 'PUT', payload: { on: 'yes' }, headers: sameOrigin }],
      [500, { url: '/api/admin/broken' }],
    ] as const
    for (const [status, request] of requests) {
      const response = await send(app, token, request)
      expect(response.status).toBe(status)
      expect(decodeJwt(response.cookie!.value).iat).toBe(now())
    }
  })

  it("doesn't renew the sessions it refuses", async () => {
    const app = await buildApp()
    const token = await signSessionToken(ADMIN)
    days(2)
    // From another origin's page.
    expect(await send(app, token, { method: 'PUT', payload: { on: true }, headers: { 'sec-fetch-site': 'cross-site' } })).toEqual({
      status: 403,
      cookie: undefined,
    })
    // Once the admin chose a new password.
    version = 1
    expect(await send(app, token)).toEqual({ status: 401, cookie: undefined })
  })
})

describe('session cookie helpers', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.useRealTimers()
  })

  // An app whose `/set` sets the session cookie, for a session logged in to at `loggedInAt`, if it's given.
  function buildApp(loggedInAt?: number) {
    const app = Fastify()
    app.register(fastifyCookie)
    app.get('/set', async (_request, reply) => {
      await setSessionCookie(reply, ADMIN, loggedInAt)
      return { ok: true }
    })
    return app
  }

  it('setSessionCookie sets an httpOnly, sameSite=lax cookie, with a session that starts now and lasts 7 days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const response = await buildApp().inject({ method: 'GET', url: '/set' })
    const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_IDLE_SECONDS })
    expect(await verifySessionToken(cookie!.value)).toEqual({ admin: ADMIN, issuedAt: now(), loggedInAt: now() })
    expect(decodeJwt(cookie!.value).exp).toBe(now() + SESSION_IDLE_SECONDS)
  })

  it('sets a session that lasts until 30 days after logging in, when that comes sooner', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const loggedInAt = now() - 29 * DAY
    const response = await buildApp(loggedInAt).inject({ method: 'GET', url: '/set' })
    const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
    expect(cookie!.maxAge).toBe(DAY)
    expect(await verifySessionToken(cookie!.value)).toEqual({ admin: ADMIN, issuedAt: now(), loggedInAt })
    vi.advanceTimersByTime((DAY - 1) * 1000)
    expect(await verifySessionToken(cookie!.value)).not.toBeNull()
    vi.advanceTimersByTime(2 * 1000)
    expect(await verifySessionToken(cookie!.value)).toBeNull()
  })

  it('marks the cookie secure in production, but not otherwise', async () => {
    const app = buildApp()

    delete process.env.NODE_ENV
    const devResponse = await app.inject({ method: 'GET', url: '/set' })
    expect(devResponse.cookies.find((c) => c.name === config.sessionCookie)?.secure).toBeFalsy()

    process.env.NODE_ENV = 'production'
    const prodResponse = await app.inject({ method: 'GET', url: '/set' })
    expect(prodResponse.cookies.find((c) => c.name === config.sessionCookie)?.secure).toBe(true)
  })

  it('clearCookie clears the session cookie', async () => {
    const app = Fastify()
    app.register(fastifyCookie)
    app.get('/clear', async (_request, reply) => {
      clearSessionCookie(reply)
      return { ok: true }
    })
    const response = await app.inject({ method: 'GET', url: '/clear' })
    const cookie = response.cookies.find((c) => c.name === config.sessionCookie)
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBe('')
  })
})
