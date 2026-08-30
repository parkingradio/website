import { hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import type { FastifyReply } from 'fastify'
import type {} from '@fastify/cookie'
import { config } from './config.js'

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
