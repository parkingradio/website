import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
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

type LoginBody = {
  email?: string
  password?: string
}

type AcceptInviteBody = {
  token?: string
  password?: string
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
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
