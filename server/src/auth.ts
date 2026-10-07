import { createHash, randomBytes } from 'node:crypto'
import { hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type {} from '@fastify/cookie'
import type { ApiError } from 'shared/error'
import { config } from './config.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string }
  }
}

export const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60

export async function hashPassword(password: string): Promise<string> {
  return bcryptHash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcryptCompare(password, hash)
}

function jwtSecretKey(): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret)
}

export async function signSessionToken(user: { id: string; email: string }): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(jwtSecretKey())
}

export async function verifySessionToken(token: string): Promise<{ id: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecretKey())
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
    return { id: payload.sub, email: payload.email }
  } catch {
    return null
  }
}

export const SESSION_COOKIE = 'session'

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

// Whether a request that changes something was sent by another origin's page, e.g. a form on another subdomain
// posting to the admin endpoints, which SameSite=Lax still sends the session cookie with. Browsers say where requests
// come from in Sec-Fetch-Site, or else in Origin. Requests with neither don't come from a page, so they only have the
// cookie if whoever sends them has it.
function isCrossOrigin(request: FastifyRequest): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false
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

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isCrossOrigin(request)) {
    reply.code(403).send({ ok: false, error: 'Cross-origin request refused' } satisfies ApiError)
    return
  }
  const token = request.cookies[SESSION_COOKIE]
  const user = token ? await verifySessionToken(token) : null
  if (!user) {
    reply.code(401).send({ ok: false, error: 'Unauthorized' } satisfies ApiError)
    return
  }
  request.user = user
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
