import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import type { AdminsStore, InviteOutcome } from '../admins.js'
import { SESSION_COOKIE, signSessionToken } from '../auth.js'
import { EmailNotSent } from '../email.js'
import type { SendEmail } from '../email.js'
import { adminRoutes } from './admin.js'

// What the store says inviting does.
let outcome: InviteOutcome
const store = { invite: vi.fn<AdminsStore['invite']>(async () => outcome) }
const send = vi.fn<SendEmail>(async () => {})

async function buildApp({ canEmail = true } = {}) {
  const app = Fastify()
  await app.register(fastifyCookie)
  await app.register(adminRoutes, { store, sendEmail: canEmail ? send : null, origin: 'https://parking.radio' })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function invite(app: App, payload: object) {
  const cookies = { [SESSION_COOKIE]: await signSessionToken({ id: 'admin-id', email: 'admin@example.com' }) }
  return app.inject({ method: 'POST', url: '/api/admin/invite', payload, cookies })
}

describe('admin routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    outcome = { kind: 'invited', token: 'the-token', admin: 'new' }
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  describe('POST /api/admin/invite', () => {
    it('requires a session', async () => {
      const app = await buildApp()
      const response = await app.inject({ method: 'POST', url: '/api/admin/invite', payload: { email: 'new-admin@example.com' } })
      expect(response.statusCode).toBe(401)
      expect(store.invite).not.toHaveBeenCalled()
    })

    it('creates an invite, refusing active admins, and emails its link', async () => {
      const app = await buildApp()
      const response = await invite(app, { email: 'new-admin@example.com' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(store.invite).toHaveBeenCalledWith('new-admin@example.com', { active: 'refuse' })
      expect(send).toHaveBeenCalledTimes(1)
      const [email] = send.mock.calls[0]
      expect(email.to).toEqual(['new-admin@example.com'])
      expect(email.text).toContain('https://parking.radio/accept-invite?token=the-token')
    })

    it('fails with 409 for an admin who already accepted their invite', async () => {
      outcome = { kind: 'active' }
      const app = await buildApp()
      const response = await invite(app, { email: 'already-admin@example.com' })
      expect(response.statusCode).toBe(409)
      expect(send).not.toHaveBeenCalled()
    })

    it('fails with 400 without an email', async () => {
      const app = await buildApp()
      const response = await invite(app, {})
      expect(response.statusCode).toBe(400)
      expect(store.invite).not.toHaveBeenCalled()
    })

    it("fails with 500, without replacing any earlier invite, when the server can't send emails", async () => {
      const app = await buildApp({ canEmail: false })
      const response = await invite(app, { email: 'new-admin@example.com' })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ ok: false, error: 'Server is not configured to send email' })
      expect(store.invite).not.toHaveBeenCalled()
    })

    it('still succeeds when the email fails to send', async () => {
      send.mockRejectedValueOnce(new EmailNotSent('MessageRejected'))
      const app = await buildApp()
      const response = await invite(app, { email: 'new-admin@example.com' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(store.invite).toHaveBeenCalledTimes(1)
    })
  })
})
