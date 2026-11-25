import { createHash, randomBytes } from 'node:crypto'

// Random tokens that the server gives out, e.g. in invites, or to the apps admins connect, which can't be guessed. The
// server keeps only their hashes, so that its database can't be used to act as whoever has them, except for the tokens of
// admins' own calendar feeds, which it keeps as they are, so that the admin pages can show their links again (see
// subscriptions/store.ts).

// What every token looks like: 64 hexadecimal digits.
export const TOKEN_FORMAT = /^[0-9a-f]{64}$/

// A new token, which the server keeps as it is.
export function randomToken(): string {
  return randomBytes(32).toString('hex')
}

// A new token, and the hash the server keeps of it.
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomToken()
  return { token, tokenHash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
