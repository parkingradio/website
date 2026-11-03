import { createHash, randomBytes } from 'node:crypto'

// Random tokens that the server gives out, e.g. in invites, or to the apps admins connect, and keeps only the hashes of,
// so that its database can't be used to act as whoever has them.

export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
