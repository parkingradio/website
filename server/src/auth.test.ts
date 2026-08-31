import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  SESSION_DURATION_SECONDS,
} from './auth.js'

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

  it('round-trips a signed token back to the user it was signed for', async () => {
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com' })
    expect(await verifySessionToken(token)).toEqual({ id: 'user-1', email: 'admin@example.com' })
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com' })
    process.env.JWT_SECRET = 'different-secret'
    expect(await verifySessionToken(token)).toBeNull()
  })

  it('rejects a tampered token', async () => {
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com' })
    expect(await verifySessionToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'))).toBeNull()
  })

  it('rejects garbage input', async () => {
    expect(await verifySessionToken('not-a-jwt')).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com' })
    vi.advanceTimersByTime((SESSION_DURATION_SECONDS + 1) * 1000)
    expect(await verifySessionToken(token)).toBeNull()
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
