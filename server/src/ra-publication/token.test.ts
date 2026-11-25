import { hkdfSync } from 'node:crypto'
import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionToken, verifySessionToken } from '../admins/auth.js'
import { RA_PUBLICATION_SECONDS, signRaPublicationToken, verifyRaPublicationToken } from './token.js'

// The tokens with which the bookmarklet publishes a session's event on RA (see "The token" in
// docs/design/server/ra-publication.md).

const PUBLICATION = { session: 'session-1', admin: 'admin-1', sessionVersion: 2 }

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret'
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.JWT_SECRET
})

// A token signed with the tokens' key, with `claims`, e.g. without some of them.
const signed = (claims: object) =>
  new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new Uint8Array(hkdfSync('sha256', 'test-secret', '', 'parking-radio ra-publication', 32)))

describe('RA publication tokens', () => {
  it('are for a session, by an admin, with the version of their sessions', async () => {
    expect(await verifyRaPublicationToken(await signRaPublicationToken(PUBLICATION))).toEqual(PUBLICATION)
  })

  it('expire after an hour', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z') })
    const token = await signRaPublicationToken(PUBLICATION)
    vi.setSystemTime(Date.now() + RA_PUBLICATION_SECONDS * 1000 - 1000)
    expect(await verifyRaPublicationToken(token)).toEqual(PUBLICATION)
    vi.setSystemTime(Date.now() + 1000)
    expect(await verifyRaPublicationToken(token)).toBeNull()
  })

  it('are refused once changed, or when signed with another secret', async () => {
    const token = await signRaPublicationToken(PUBLICATION)
    const [header, payload, signature] = token.split('.')
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), session: 'session-2' })).toString('base64url')
    expect(await verifyRaPublicationToken(`${header}.${changed}.${signature}`)).toBeNull()
    expect(await verifyRaPublicationToken('not-a-token')).toBeNull()

    process.env.JWT_SECRET = 'another-secret'
    expect(await verifyRaPublicationToken(token)).toBeNull()
  })

  it("can't pass for an admin's session, nor the other way round", async () => {
    const admin = { id: 'admin-1', email: 'admin@example.com', sessionVersion: 0 }
    expect(await verifySessionToken(await signRaPublicationToken(PUBLICATION))).toBeNull()
    expect(await verifyRaPublicationToken(await signSessionToken(admin))).toBeNull()
  })

  it('need every claim, and an expiry', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    expect(await verifyRaPublicationToken(await signed({ sub: 'admin-1', session: 'session-1', ver: 0, exp }))).not.toBeNull()
    expect(await verifyRaPublicationToken(await signed({ sub: 'admin-1', session: 'session-1', ver: 0 }))).toBeNull()
    expect(await verifyRaPublicationToken(await signed({ sub: 'admin-1', ver: 0, exp }))).toBeNull()
    expect(await verifyRaPublicationToken(await signed({ sub: 'admin-1', session: 'session-1', ver: '0', exp }))).toBeNull()
    expect(await verifyRaPublicationToken(await signed({ session: 'session-1', ver: 0, exp }))).toBeNull()
  })
})
