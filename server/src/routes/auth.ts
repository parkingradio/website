import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { users } from '../schema.js'
import {
  verifyPassword,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from '../auth.js'

type LoginBody = {
  email?: string
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
}
