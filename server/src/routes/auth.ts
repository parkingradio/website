import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import type { RateLimitOptions } from '@fastify/rate-limit'
import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeResponse,
} from 'shared/auth'
import type { ApiError } from 'shared/error'
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
import { clientAddress } from '../client-address.js'

const MIN_PASSWORD_LENGTH = 8

// Throttle password guessing: each client gets this many login attempts per window.
export const LOGIN_ATTEMPTS_PER_WINDOW = 10
const LOGIN_WINDOW = '15 minutes'

export async function authRoutes(app: FastifyInstance) {
  // Only routes that opt in through `config.rateLimit` are limited.
  await app.register(rateLimit, { global: false, keyGenerator: clientAddress })

  const loginRateLimit: RateLimitOptions = {
    max: LOGIN_ATTEMPTS_PER_WINDOW,
    timeWindow: LOGIN_WINDOW,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      ok: false,
      error: `Too many login attempts, try again in ${context.after}`,
    }),
  }

  app.post<{ Body: Partial<LoginRequest>; Reply: LoginResponse | ApiError }>('/api/auth/login', { config: { rateLimit: loginRateLimit } }, async (request, reply) => {
    const { email, password } = request.body ?? {}
    if (!email || !password) {
      return reply.status(400).send({ ok: false, error: 'Missing email or password' })
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash, sessionVersion: users.sessionVersion })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)

    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return reply.status(401).send({ ok: false, error: 'Invalid email or password' })
    }

    const token = await signSessionToken(user)
    setSessionCookie(reply, token)
    return { ok: true, email: user.email }
  })

  app.post<{ Reply: LogoutResponse }>('/api/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply)
    return { ok: true }
  })

  app.post<{ Body: Partial<AcceptInviteRequest>; Reply: AcceptInviteResponse | ApiError }>('/api/auth/accept-invite', async (request, reply) => {
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

      // A new password ends the sessions that started with the old one, e.g. when an admin's password is reset with the
      // create-admin command.
      const passwordHash = await hashPassword(password)
      await tx
        .update(users)
        .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
        .where(eq(users.id, invite.userId))
      return true
    })

    if (!accepted) {
      return reply.status(400).send({ ok: false, error: 'Invalid or expired invite link' })
    }

    return { ok: true }
  })

  app.get<{ Reply: MeResponse }>('/api/admin/me', { preHandler: requireAuth }, async (request) => {
    return { ok: true, email: request.user!.email }
  })
}
