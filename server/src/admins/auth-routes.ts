import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import type { RateLimitOptions } from '@fastify/rate-limit'
import { z } from 'zod'
import { ApiError, Ok, zodRoutes } from '../api/schemas.js'
import type { Queryable } from '../db/connection.js'
import { users, invites } from '../db/schema.js'
import { hashPassword, verifyPassword, setSessionCookie, clearSessionCookie } from './auth.js'
import { hashToken } from '../core/tokens.js'
import { endConnections } from '../oauth/store.js'
import { clientAddress } from '../api/client-address.js'
import { checkTurnstile } from '../api/turnstile.js'
import type { TurnstileVerifier } from '../api/turnstile.js'

// Logging in and out, and choosing a password from an invite. Admins themselves are seen and invited through
// admins/routes.ts.

const MIN_PASSWORD_LENGTH = 8

// Throttle password guessing: each client gets this many login attempts per window.
export const LOGIN_ATTEMPTS_PER_WINDOW = 10
const LOGIN_WINDOW = '15 minutes'

const TURNSTILE_REFUSED = { ok: false as const, error: 'The anti-bot check failed, try again' }
const TURNSTILE_UNAVAILABLE = { ok: false as const, error: "The anti-bot check couldn't be done, try again in a few minutes" }

// What a password is checked against when there's none to check it against: no admin has the email, or they haven't
// chosen their password yet. That way, logging in takes as long either way, so how long a 401 takes doesn't tell which
// emails are admins'. Made by hashPassword, so that checking it takes as long as checking an admin's. No password
// matches it, and it's never taken as a match anyway.
const dummyHash = hashPassword(randomBytes(32).toString('hex'))

// The logged-in admin.
const LoggedIn = z.object({ ok: z.literal(true), email: z.string() }).meta({ id: 'LoggedIn' })

export async function authRoutes(app: FastifyInstance, { db, verifyTurnstile }: { db: Queryable; verifyTurnstile: TurnstileVerifier }) {
  const api = zodRoutes(app)
  // Only routes that opt in through `config.rateLimit` are limited.
  await app.register(rateLimit, { global: false, keyGenerator: clientAddress })

  const loginRateLimit: RateLimitOptions = {
    max: LOGIN_ATTEMPTS_PER_WINDOW,
    timeWindow: LOGIN_WINDOW,
    // The plugin throws this error, and the app's error handler sends its message (see `useApiErrors`).
    errorResponseBuilder: (_request, context) =>
      Object.assign(new Error(`Too many login attempts, try again in ${context.after}`), { statusCode: 429 }),
  }

  api.post(
    '/api/auth/login',
    {
      config: { rateLimit: loginRateLimit },
      schema: {
        summary: 'Logs in as an admin',
        tags: ['Admins'],
        // An empty token is a refused one rather than a missing field, as Turnstile refuses it.
        body: z.object({
          email: z.string().min(1),
          password: z.string().min(1),
          turnstileToken: z.string().meta({ description: 'The token the Turnstile widget gave the page' }),
        }),
        response: { 200: LoggedIn, 400: ApiError, 401: ApiError, 429: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const { email, password, turnstileToken } = request.body
      // Before anything about the email or the password, so that guessing passwords takes passing Turnstile each time.
      const turnstile = await checkTurnstile(request, verifyTurnstile, turnstileToken)
      if (turnstile === 'unavailable') return reply.status(502).send(TURNSTILE_UNAVAILABLE)
      if (turnstile === 'refused') return reply.status(400).send(TURNSTILE_REFUSED)

      const [user] = await db
        .select({ id: users.id, email: users.email, passwordHash: users.passwordHash, sessionVersion: users.sessionVersion })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)

      const matches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash))
      if (!user?.passwordHash || !matches) {
        return reply.status(401).send({ ok: false, error: 'Invalid email or password' })
      }

      await setSessionCookie(reply, user)
      return { ok: true as const, email: user.email }
    },
  )

  api.post(
    '/api/auth/logout',
    { schema: { summary: 'Logs out', tags: ['Admins'], response: { 200: Ok } } },
    async (_request, reply) => {
      clearSessionCookie(reply)
      return { ok: true as const }
    },
  )

  api.post(
    '/api/auth/accept-invite',
    {
      schema: {
        summary: "Sets an invited admin's password",
        tags: ['Admins'],
        // An empty token is an invalid one rather than a missing field, e.g. from a link without one.
        body: z.object({ token: z.string(), password: z.string().min(MIN_PASSWORD_LENGTH) }),
        response: { 200: Ok, 400: ApiError },
      },
    },
    async (request, reply) => {
      const { token, password } = request.body
      const tokenHash = hashToken(token)

      const accepted = await db.transaction(async (tx) => {
        const [invite] = await tx
          .delete(invites)
          .where(eq(invites.tokenHash, tokenHash))
          .returning({ userId: invites.userId, expiresAt: invites.expiresAt })

        if (!invite || invite.expiresAt.getTime() < Date.now()) {
          return false
        }

        // A new password ends the sessions that started with the old one, e.g. when an admin's password is reset with the
        // create-admin command, and the apps they connected.
        const passwordHash = await hashPassword(password)
        await tx
          .update(users)
          .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
          .where(eq(users.id, invite.userId))
        await endConnections(tx, invite.userId)
        return true
      })

      if (!accepted) {
        return reply.status(400).send({ ok: false, error: 'Invalid or expired invite link' })
      }

      // As logging out does, so that whoever was logged in in this browser, e.g. the admin who sent the invite, isn't
      // anymore.
      clearSessionCookie(reply)
      return { ok: true as const }
    },
  )

  api.get(
    '/api/admin/me',
    { config: { admin: true, tool: null }, schema: { summary: 'The logged-in admin', tags: ['Admins'], response: { 200: LoggedIn } } },
    async (request) => ({ ok: true as const, email: request.user!.email }),
  )
}
