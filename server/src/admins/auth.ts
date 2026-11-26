import { hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type {} from '@fastify/cookie'
import type { ApiError } from '../api/schemas.js'
import type { AdminsStore } from './store.js'
import { config } from '../core/config.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: AdminSession
  }
  interface FastifyInstance {
    // What requireAuth checks sessions against, so that sessions end when their admin is revoked or chooses a new
    // password. app.ts sets it up, and so do the tests of routes that require a session.
    adminSessions: Pick<AdminsStore, 'sessionVersion'>
  }
}

// An admin, as their sessions have them, with the version their sessions have (see `sessionVersion` in db/schema.ts).
export type AdminSession = { id: string; email: string; sessionVersion: number }

const DAY_SECONDS = 24 * 60 * 60
// How long a session lasts from when its cookie was last set, and from logging in at most (see "Sessions" in
// docs/design/server/admins.md).
export const SESSION_IDLE_SECONDS = 7 * DAY_SECONDS
const SESSION_MAX_SECONDS = 30 * DAY_SECONDS
// How old a session's token gets before an admin request renews it.
const SESSION_RENEWAL_SECONDS = DAY_SECONDS

export async function hashPassword(password: string): Promise<string> {
  return bcryptHash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcryptCompare(password, hash)
}

function jwtSecretKey(): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret)
}

// A session token, as it's verified: its admin, and when it was signed and when its admin logged in, in seconds since the
// epoch.
export type VerifiedSession = { admin: AdminSession; issuedAt: number; loggedInAt: number }

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// A session for `user`, with the version their sessions have when it starts (see `sessionVersion` in db/schema.ts), whose
// admin logged in at `loggedInAt`, now unless told otherwise, and which lasts `seconds`, e.g. a short one for a request
// the server sends itself as them (see mcp/tools.ts).
export async function signSessionToken(
  user: AdminSession,
  { seconds = SESSION_IDLE_SECONDS, loggedInAt }: { seconds?: number; loggedInAt?: number } = {},
): Promise<string> {
  const now = nowSeconds()
  return sign(user, { now, seconds, loggedInAt: loggedInAt ?? now })
}

// As signSessionToken, signed at `now`.
function sign(user: AdminSession, { now, seconds, loggedInAt }: { now: number; seconds: number; loggedInAt: number }) {
  return new SignJWT({ email: user.email, ver: user.sessionVersion, auth_time: loggedInAt })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + seconds)
    .sign(jwtSecretKey())
}

// The session a token is, with the version its admin's sessions had when it started. Null if the token isn't one we
// signed, or has expired. Sessions that started before there were versions have none, and are of the first one, 0.
// Those signed before tokens had `auth_time` don't say when their admin logged in, which is when they were signed, since
// only logging in signed them.
export async function verifySessionToken(token: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecretKey(), { requiredClaims: ['iat', 'exp'] })
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
    const sessionVersion = typeof payload.ver === 'number' ? payload.ver : 0
    const issuedAt = payload.iat!
    const loggedInAt = typeof payload.auth_time === 'number' ? payload.auth_time : issuedAt
    return { admin: { id: payload.sub, email: payload.email, sessionVersion }, issuedAt, loggedInAt }
  } catch {
    return null
  }
}

// Sets the session cookie to a new token for `user`'s session, which they logged in to at `loggedInAt`, now unless told
// otherwise: it lasts SESSION_IDLE_SECONDS, or until SESSION_MAX_SECONDS after logging in if that's sooner.
export async function setSessionCookie(reply: FastifyReply, user: AdminSession, loggedInAt?: number): Promise<void> {
  // One instant, so that the token and the cookie expire together.
  const now = nowSeconds()
  const loggedIn = loggedInAt ?? now
  const seconds = Math.min(SESSION_IDLE_SECONDS, loggedIn + SESSION_MAX_SECONDS - now)
  reply.setCookie(config.sessionCookie, await sign(user, { now, seconds, loggedInAt: loggedIn }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: seconds,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.sessionCookie, { path: '/' })
}

// Whether requireAuth refuses requests with this method that come from another origin's page: those that can change
// something.
export function checksOrigin(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD'
}

// Whether a request that changes something was sent by another origin's page, e.g. a form on another subdomain
// posting to the admin endpoints, which SameSite=Lax still sends the session cookie with. Browsers say where requests
// come from in Sec-Fetch-Site, or else in Origin. Requests with neither don't come from a page, so they only have the
// cookie if whoever sends them has it.
function isCrossOrigin(request: FastifyRequest): boolean {
  if (!checksOrigin(request.method)) return false
  const site = request.headers['sec-fetch-site']
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = request.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host !== request.headers.host
  } catch {
    return true // e.g. "null", from a sandboxed page
  }
}

// What admin requests without a session get (see "Admin endpoints" in docs/design/server/README.md).
export const UNAUTHORIZED: ApiError = { ok: false, error: 'Unauthorized' }

// Refuses requests without an admin's session, and those from another origin's page, and renews the sessions of those it
// lets through once they're more than SESSION_RENEWAL_SECONDS old (see "Sessions" in docs/design/server/admins.md).
// Routes with zod schemas get it with `config: { admin: true }` (see api/schemas.ts). It returns the reply when it refuses
// a request, so that Fastify waits for it to be sent.
//
// A request still being answered when its session's cookie is cleared, e.g. by logging out or accepting an invite, can
// renew the session after the response that cleared it, if it's the session's first in a day, and so put it back.
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (isCrossOrigin(request)) {
    return reply.code(403).send({ ok: false, error: 'Cross-origin request refused' } satisfies ApiError)
  }
  if (!request.server.hasDecorator('adminSessions')) throw new Error("requireAuth needs the app's `adminSessions` (see app.ts)")
  const token = request.cookies[config.sessionCookie]
  const session = token ? await verifySessionToken(token) : null
  // The session also has to be one that hasn't ended since, by its admin being revoked or choosing a new password.
  if (!session || (await request.server.adminSessions.sessionVersion(session.admin.id)) !== session.admin.sessionVersion) {
    return reply.code(401).send(UNAUTHORIZED)
  }
  request.user = session.admin
  // The tokens of the requests the MCP server sends for its tools are only ever a few seconds old, so they're never renewed.
  if (nowSeconds() - session.issuedAt > SESSION_RENEWAL_SECONDS) {
    await setSessionCookie(reply, session.admin, session.loggedInAt)
  }
}
