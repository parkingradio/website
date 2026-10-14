import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { SignJWT } from 'jose'
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  generateInviteToken,
  hashInviteToken,
  SESSION_COOKIE,
  SESSION_DURATION_SECONDS,
} from './auth.js'
import { sessionCookies } from './test-sessions.js'

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

  it('round-trips a signed token back to the user it was signed for, and the version of their sessions', async () => {
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com', sessionVersion: 3 })
    expect(await verifySessionToken(token)).toEqual({ id: 'user-1', email: 'admin@example.com', sessionVersion: 3 })
  })

  it('reads the tokens signed before sessions had versions as being of the first version', async () => {
    const token = await new SignJWT({ email: 'admin@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('test-secret'))
    expect(await verifySessionToken(token)).toEqual({ id: 'user-1', email: 'admin@example.com', sessionVersion: 0 })
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com', sessionVersion: 0 })
    process.env.JWT_SECRET = 'different-secret'
    expect(await verifySessionToken(token)).toBeNull()
  })

  it('rejects a tampered token', async () => {
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com', sessionVersion: 0 })
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
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com', sessionVersion: 0 })
    vi.advanceTimersByTime((SESSION_DURATION_SECONDS + 1) * 1000)
    expect(await verifySessionToken(token)).toBeNull()
  })
})

describe('invite tokens', () => {
  it('produces a hash that hashInviteToken can reproduce from the raw token', () => {
    const { token, tokenHash } = generateInviteToken()
    expect(hashInviteToken(token)).toBe(tokenHash)
  })

  it('generates different tokens on each call', () => {
    const a = generateInviteToken()
    const b = generateInviteToken()
    expect(a.token).not.toBe(b.token)
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
    app.decorate('sessions', { sessionVersion })
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
      headers: { cookie: `${SESSION_COOKIE}=garbage` },
    })
    expect(response.statusCode).toBe(401)
  })

  it('calls the handler with request.user set when the session cookie is valid', async () => {
    const response = await getProtected(buildApp())
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ user: { id: 'user-1', email: 'admin@example.com' } })
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
    const cookie = `${SESSION_COOKIE}=${await signSessionToken({ id: 'user-1', email: 'admin@example.com', sessionVersion: 0 })}`
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

describe('session cookie helpers', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('setSessionCookie sets an httpOnly, sameSite=lax cookie', async () => {
    const app = Fastify()
    app.register(fastifyCookie)
    app.get('/set', async (_request, reply) => {
      setSessionCookie(reply, 'the-token')
      return { ok: true }
    })
    const response = await app.inject({ method: 'GET', url: '/set' })
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBe('the-token')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
  })

  it('marks the cookie secure in production, but not otherwise', async () => {
    const app = Fastify()
    app.register(fastifyCookie)
    app.get('/set', async (_request, reply) => {
      setSessionCookie(reply, 'the-token')
      return { ok: true }
    })

    delete process.env.NODE_ENV
    const devResponse = await app.inject({ method: 'GET', url: '/set' })
    expect(devResponse.cookies.find((c) => c.name === SESSION_COOKIE)?.secure).toBeFalsy()

    process.env.NODE_ENV = 'production'
    const prodResponse = await app.inject({ method: 'GET', url: '/set' })
    expect(prodResponse.cookies.find((c) => c.name === SESSION_COOKIE)?.secure).toBe(true)
  })

  it('clearCookie clears the session cookie', async () => {
    const app = Fastify()
    app.register(fastifyCookie)
    app.get('/clear', async (_request, reply) => {
      clearSessionCookie(reply)
      return { ok: true }
    })
    const response = await app.inject({ method: 'GET', url: '/clear' })
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)
    expect(cookie).toBeDefined()
    expect(cookie?.value).toBe('')
  })
})
