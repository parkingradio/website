import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import rateLimit, { normalizeIP } from '@fastify/rate-limit'
import type { RateLimitOptions } from '@fastify/rate-limit'
import { db } from '../db.js'
import { users, invites } from '../schema.js'
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  hashInviteToken,
} from '../auth.js'

const MIN_PASSWORD_LENGTH = 8

// Throttle password guessing: each client gets this many login attempts per window.
export const LOGIN_ATTEMPTS_PER_WINDOW = 10
const LOGIN_WINDOW = '15 minutes'

// In production, requests reach the app through Cloudflare and then nginx, so `request.ip` is nginx's
// address and would put every visitor in the same bucket. Cloudflare sets CF-Connecting-IP to the
// visitor's actual address (overwriting any value sent by the client), and the origin only accepts
// traffic from Cloudflare. Outside of that setup (e.g. in development), fall back to `request.ip`.
// Like the plugin's default key, IPv6 addresses are grouped by subnet so a client can't dodge the
// limit by cycling through the addresses it's been allocated.
function clientAddress(request: FastifyRequest): string {
  const cloudflareAddress = request.headers['cf-connecting-ip']
  return normalizeIP(typeof cloudflareAddress === 'string' ? cloudflareAddress : request.ip)
}

type LoginBody = {
  email?: string
  password?: string
}

type AcceptInviteBody = {
  token?: string
  password?: string
}

export async function authRoutes(app: FastifyInstance) {
  // Only routes that opt in through `config.rateLimit` are limited.
  await app.register(rateLimit, { global: false })

  const loginRateLimit: RateLimitOptions = {
    max: LOGIN_ATTEMPTS_PER_WINDOW,
    timeWindow: LOGIN_WINDOW,
    keyGenerator: clientAddress,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      ok: false,
      error: `Too many login attempts, try again in ${context.after}`,
    }),
  }

  app.post<{ Body: LoginBody }>('/api/auth/login', { config: { rateLimit: loginRateLimit } }, async (request, reply) => {
    const { email, password } = request.body ?? {}
    if (!email || !password) {
      return reply.status(400).send({ ok: false, error: 'Missing email or password' })
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)

    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return reply.status(401).send({ ok: false, error: 'Invalid email or password' })
    }

    const token = await signSessionToken({ id: user.id, email: user.email })
    setSessionCookie(reply, token)
    return { ok: true, email: user.email }
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply)
    return { ok: true }
  })

  app.post<{ Body: AcceptInviteBody }>('/api/auth/accept-invite', async (request, reply) => {
    const { token, password } = request.body ?? {}
    if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
      return reply.status(400).send({ ok: false, error: 'Missing token or password' })
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
    }

    const tokenHash = hashInviteToken(token)

    const accepted = await db.transaction(async (tx) => {
      const [invite] = await tx
        .delete(invites)
        .where(eq(invites.tokenHash, tokenHash))
        .returning({ userId: invites.userId, expiresAt: invites.expiresAt })

      if (!invite || invite.expiresAt.getTime() < Date.now()) {
        return false
      }

      const passwordHash = await hashPassword(password)
      await tx.update(users).set({ passwordHash }).where(eq(users.id, invite.userId))
      return true
    })

    if (!accepted) {
      return reply.status(400).send({ ok: false, error: 'Invalid or expired invite link' })
    }

    return { ok: true }
  })

  app.get('/api/admin/me', { preHandler: requireAuth }, async (request) => {
    return { ok: true, email: request.user!.email }
  })
}
