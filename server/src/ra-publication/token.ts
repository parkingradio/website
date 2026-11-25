import { hkdfSync } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { config } from '../core/config.js'

// The tokens with which the bookmarklet publishes a session's event on RA (see "The token" in
// docs/design/server/ra-publication.md). The server keeps nothing of them.

export const RA_PUBLICATION_SECONDS = 60 * 60

// What a token is for: a session, by the admin who asked for it, with the version their sessions had then (see
// `sessionVersion` in db/schema.ts), so that revoking them, or their choosing a new password, ends it.
export type RaPublication = { session: string; admin: string; sessionVersion: number }

// The tokens' key, derived from the server's secret for them only, so that they can never pass for another kind of token
// signed with that secret, e.g. an admin's session (see admins/auth.ts), nor the other way round.
function key(): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', config.jwtSecret, '', 'parking-radio ra-publication', 32))
}

export async function signRaPublicationToken({ session, admin, sessionVersion }: RaPublication): Promise<string> {
  return new SignJWT({ session, ver: sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(admin)
    .setExpirationTime(`${RA_PUBLICATION_SECONDS}s`)
    .sign(key())
}

// What `token` is for, or null if it isn't one of these tokens that the server signed, or has expired. Whether its admin's
// sessions still have its version is for the caller to check.
export async function verifyRaPublicationToken(token: string): Promise<RaPublication | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'], requiredClaims: ['exp'] })
    const { sub, session, ver } = payload
    if (typeof sub !== 'string' || typeof session !== 'string' || typeof ver !== 'number') return null
    return { session, admin: sub, sessionVersion: ver }
  } catch {
    return null
  }
}
