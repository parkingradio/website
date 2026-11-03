import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import type { AdminsStore, InviteOutcome, StoredAdmin } from './store.js'
import { EmailNotSent } from '../core/email.js'
import type { SendEmail } from '../core/email.js'
import { TEST_ADMIN, acceptSessions, sessionCookies } from './test-sessions.js'
import { adminRoutes } from './routes.js'

// The admins, as the store would list them, and what it says inviting does.
let admins: StoredAdmin[] = []
let outcome: InviteOutcome
const store: AdminsStore = {
  list: async () => admins,
  invite: vi.fn<AdminsStore['invite']>(async () => outcome),
  delete: vi.fn<AdminsStore['delete']>(async (id) => {
    const deleted = admins.find((admin) => admin.id === id)
    admins = admins.filter((admin) => admin.id !== id)
    return deleted ? { email: deleted.email } : null
  }),
  sessionVersion: async () => 0,
}
const send = vi.fn<SendEmail>(async () => {})

async function buildApp({ canEmail = true, logs }: { canEmail?: boolean; logs?: string[] } = {}) {
  const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(adminRoutes, { store, sendEmail: canEmail ? send : null, origin: 'https://parking.radio' })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function request(app: App, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

const HOUR_MS = 60 * 60 * 1000

describe('admin routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    const createdAt = new Date('2026-10-01T12:00:00Z')
    const later = new Date(Date.now() + HOUR_MS)
    const earlier = new Date(Date.now() - HOUR_MS)
    admins = [
      { id: TEST_ADMIN.id, email: TEST_ADMIN.email, active: true, inviteExpiresAt: null, invitedBy: null, createdAt },
      { id: 'other-id', email: 'other@example.com', active: true, inviteExpiresAt: null, invitedBy: TEST_ADMIN.email, createdAt },
      // An admin whose password is being reset, e.g. with the create-admin command, is still active.
      { id: 'reset-id', email: 'reset@example.com', active: true, inviteExpiresAt: later, invitedBy: null, createdAt },
      { id: 'invited-id', email: 'invited@example.com', active: false, inviteExpiresAt: later, invitedBy: TEST_ADMIN.email, createdAt },
      { id: 'expired-id', email: 'expired@example.com', active: false, inviteExpiresAt: earlier, invitedBy: TEST_ADMIN.email, createdAt },
      { id: 'cleaned-up-id', email: 'cleaned-up@example.com', active: false, inviteExpiresAt: null, invitedBy: null, createdAt },
    ]
    outcome = { kind: 'invited', token: 'the-token', admin: 'new' }
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it('requires a session, whatever the request', async () => {
    const app = await buildApp()
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/admin/admins' }),
      app.inject({ method: 'DELETE', url: '/api/admin/admins/other-id' }),
      app.inject({ method: 'POST', url: '/api/admin/invite', payload: { email: 'new-admin@example.com' } }),
      app.inject({ method: 'POST', url: '/api/admin/invite', payload: { email: 42 } }),
    ])
    for (const response of responses) {
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' })
    }
    expect(store.delete).not.toHaveBeenCalled()
    expect(store.invite).not.toHaveBeenCalled()
  })

  it('refuses changes from another origin, whatever the request', async () => {
    const app = await buildApp()
    const requests = [
      { method: 'DELETE' as const, url: '/api/admin/admins/other-id' },
      { method: 'POST' as const, url: '/api/admin/invite', payload: { email: 'new-admin@example.com' } },
      { method: 'POST' as const, url: '/api/admin/invite', payload: { email: 42 } },
    ]
    for (const request of requests) {
      const response = await app.inject({ ...request, headers: { 'sec-fetch-site': 'cross-site' }, cookies: await sessionCookies() })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ ok: false, error: 'Cross-origin request refused' })
    }
    expect(store.delete).not.toHaveBeenCalled()
    expect(store.invite).not.toHaveBeenCalled()
  })

  describe('GET /api/admin/admins', () => {
    it('lists every admin, with their status, who invited them, and which one is the admin who asks', async () => {
      const app = await buildApp()
      const response = await request(app, 'GET', '/api/admin/admins')
      expect(response.statusCode).toBe(200)
      // When invites expire is only said for admins who are invited.
      const expires = admins[3].inviteExpiresAt!.toISOString()
      const createdAt = '2026-10-01T12:00:00.000Z'
      expect(response.json().admins).toEqual([
        { id: TEST_ADMIN.id, email: TEST_ADMIN.email, status: 'active', inviteExpiresAt: null, invitedBy: null, createdAt, you: true },
        { id: 'other-id', email: 'other@example.com', status: 'active', inviteExpiresAt: null, invitedBy: TEST_ADMIN.email, createdAt, you: false },
        { id: 'reset-id', email: 'reset@example.com', status: 'active', inviteExpiresAt: null, invitedBy: null, createdAt, you: false },
        { id: 'invited-id', email: 'invited@example.com', status: 'invited', inviteExpiresAt: expires, invitedBy: TEST_ADMIN.email, createdAt, you: false },
        { id: 'expired-id', email: 'expired@example.com', status: 'expired', inviteExpiresAt: null, invitedBy: TEST_ADMIN.email, createdAt, you: false },
        { id: 'cleaned-up-id', email: 'cleaned-up@example.com', status: 'expired', inviteExpiresAt: null, invitedBy: null, createdAt, you: false },
      ])
      expect(response.json().total).toBe(6)
    })
  })

  describe('DELETE /api/admin/admins/:id', () => {
    it('revokes an admin, and logs who did', async () => {
      const logs: string[] = []
      const app = await buildApp({ logs })
      const response = await request(app, 'DELETE', '/api/admin/admins/other-id')
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(store.delete).toHaveBeenCalledWith('other-id')
      const logged = logs.map((line) => JSON.parse(line)).find((line) => line.msg === 'Revoked an admin')
      expect(logged).toMatchObject({ admin: 'other@example.com', by: TEST_ADMIN.email })
    })

    it('cancels the invite of an admin who has not accepted it', async () => {
      const app = await buildApp()
      expect((await request(app, 'DELETE', '/api/admin/admins/invited-id')).statusCode).toBe(200)
      expect(admins.map(({ id }) => id)).not.toContain('invited-id')
    })

    it('fails with 409 for the admin who asks, whatever the case of their id', async () => {
      const app = await buildApp()
      for (const id of [TEST_ADMIN.id, TEST_ADMIN.id.toUpperCase()]) {
        const response = await request(app, 'DELETE', `/api/admin/admins/${id}`)
        expect(response.statusCode).toBe(409)
        expect(response.json()).toEqual({ ok: false, error: "You can't revoke yourself" })
      }
      expect(store.delete).not.toHaveBeenCalled()
    })

    it("fails with 404 for an admin who doesn't exist", async () => {
      const app = await buildApp()
      const response = await request(app, 'DELETE', '/api/admin/admins/no-such-id')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such admin' })
    })
  })

  describe('POST /api/admin/invite', () => {
    it('creates an invite, as invited by the admin who asks, refusing active admins, and emails its link', async () => {
      const app = await buildApp()
      const response = await request(app, 'POST', '/api/admin/invite', { email: 'new-admin@example.com' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(store.invite).toHaveBeenCalledWith('new-admin@example.com', { active: 'refuse', invitedBy: TEST_ADMIN.email })
      expect(send).toHaveBeenCalledTimes(1)
      const [email] = send.mock.calls[0]
      expect(email.to).toEqual(['new-admin@example.com'])
      expect(email.text).toContain('https://parking.radio/accept-invite?token=the-token')
    })

    it('fails with 409 for an admin who already accepted their invite', async () => {
      outcome = { kind: 'active' }
      const app = await buildApp()
      const response = await request(app, 'POST', '/api/admin/invite', { email: 'already-admin@example.com' })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'This email address is already an activated admin' })
      expect(send).not.toHaveBeenCalled()
    })

    it('fails with 400 without an email, saying why', async () => {
      const app = await buildApp()
      const refused: [unknown, string][] = [
        [{}, '`email`: Invalid input: expected string, received undefined'],
        [{ email: '' }, '`email`: Too small: expected string to have >=1 characters'],
        [{ email: ['new-admin@example.com'] }, '`email`: Invalid input: expected string, received array'],
        [null, 'body: Invalid input: expected object, received null'],
      ]
      for (const [body, error] of refused) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/admin/invite',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify(body),
          cookies: await sessionCookies(),
        })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      expect(store.invite).not.toHaveBeenCalled()
    })

    it("fails with 500, without replacing any earlier invite, when the server can't send emails", async () => {
      const app = await buildApp({ canEmail: false })
      const response = await request(app, 'POST', '/api/admin/invite', { email: 'new-admin@example.com' })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ ok: false, error: 'Server is not configured to send email' })
      expect(store.invite).not.toHaveBeenCalled()
    })

    it("keeps the invited admin's email out of the logs and the response when the database fails", async () => {
      const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
      const query = 'insert into "users" ("email") values ($1)'
      vi.mocked(store.invite).mockRejectedValueOnce(new DrizzleQueryError(query, ['new-admin@example.com'], cause))
      const logs: string[] = []
      const app = await buildApp({ logs })
      const response = await request(app, 'POST', '/api/admin/invite', { email: 'new-admin@example.com' })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
      expect(logs.join('')).toContain('57P01')
      expect(logs.join('')).not.toContain('new-admin@example.com')
      expect(send).not.toHaveBeenCalled()
    })

    it('still succeeds when the email fails to send', async () => {
      send.mockRejectedValueOnce(new EmailNotSent('MessageRejected'))
      const app = await buildApp()
      const response = await request(app, 'POST', '/api/admin/invite', { email: 'new-admin@example.com' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(store.invite).toHaveBeenCalledTimes(1)
    })
  })
})
