import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { users, invites } from '../schema.js'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    send = send
  },
  SendEmailCommand: class {
    constructor(input: unknown) {
      Object.assign(this as object, input)
    }
  },
}))

const { dbState } = vi.hoisted(() => ({
  dbState: {
    selectResult: [] as { id: string; passwordHash: string | null }[],
    insertedUsers: [] as { email: string }[],
    insertedInvites: [] as { userId: string; tokenHash: string; expiresAt: Date }[],
    deletedInviteFilters: [] as unknown[],
  },
}))

vi.mock('../db.js', () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(dbState.selectResult),
          }),
        }),
        insert: (table: unknown) => ({
          values: (values: { email: string } | { userId: string; tokenHash: string; expiresAt: Date }) => {
            if (table === users) {
              dbState.insertedUsers.push(values as { email: string })
              return { returning: () => Promise.resolve([{ id: 'new-user-id' }]) }
            }
            if (table === invites) {
              dbState.insertedInvites.push(values as { userId: string; tokenHash: string; expiresAt: Date })
              return Promise.resolve()
            }
            throw new Error('Unexpected insert target in test mock')
          },
        }),
        delete: () => ({
          where: (filter: unknown) => {
            dbState.deletedInviteFilters.push(filter)
            return Promise.resolve()
          },
        }),
      }
      return fn(tx)
    },
  },
}))

import { adminRoutes } from './admin.js'
import { signSessionToken, SESSION_COOKIE } from '../auth.js'

describe('admin routes', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    send.mockReset()
    dbState.selectResult = []
    dbState.insertedUsers = []
    dbState.insertedInvites = []
    dbState.deletedInviteFilters = []
    process.env.AWS_REGION = 'us-east-1'
    process.env.MAIL_DOMAIN = 'parking.radio'
    process.env.JWT_SECRET = 'test-secret'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  async function buildAuthenticatedApp() {
    const app = Fastify()
    await app.register(fastifyCookie)
    await app.register(adminRoutes)
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com' })
    return { app, cookie: `${SESSION_COOKIE}=${token}` }
  }

  describe('POST /api/admin/invite', () => {
    it('returns 401 when there is no session cookie', async () => {
      const app = Fastify()
      await app.register(fastifyCookie)
      await app.register(adminRoutes)

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/invite',
        payload: { email: 'new-admin@example.com' },
      })

      expect(response.statusCode).toBe(401)
    })

    it('creates a user and invite, and emails the invite link, for a brand new address', async () => {
      send.mockResolvedValueOnce({ MessageId: 'abc-123' })
      const { app, cookie } = await buildAuthenticatedApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/invite',
        headers: { cookie },
        payload: { email: 'new-admin@example.com' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(dbState.insertedUsers).toEqual([{ email: 'new-admin@example.com' }])
      expect(dbState.insertedInvites).toHaveLength(1)
      expect(dbState.insertedInvites[0].userId).toBe('new-user-id')
      expect(send).toHaveBeenCalledTimes(1)
      const [command] = send.mock.calls[0]
      expect(command.Destination.ToAddresses).toEqual(['new-admin@example.com'])
    })

    it('returns 409 when the email already belongs to an activated admin', async () => {
      dbState.selectResult = [{ id: 'existing-user-id', passwordHash: 'some-hash' }]
      const { app, cookie } = await buildAuthenticatedApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/invite',
        headers: { cookie },
        payload: { email: 'already-admin@example.com' },
      })

      expect(response.statusCode).toBe(409)
      expect(dbState.insertedUsers).toEqual([])
      expect(send).not.toHaveBeenCalled()
    })

    it('re-invites a pending user by reusing the row and invalidating prior invites', async () => {
      send.mockResolvedValueOnce({ MessageId: 'abc-123' })
      dbState.selectResult = [{ id: 'pending-user-id', passwordHash: null }]
      const { app, cookie } = await buildAuthenticatedApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/invite',
        headers: { cookie },
        payload: { email: 'pending@example.com' },
      })

      expect(response.statusCode).toBe(200)
      expect(dbState.insertedUsers).toEqual([])
      expect(dbState.insertedInvites).toHaveLength(1)
      expect(dbState.insertedInvites[0].userId).toBe('pending-user-id')
      // one delete for invalidating the pending user's prior invites, one for the expired-invite sweep
      expect(dbState.deletedInviteFilters).toHaveLength(2)
    })

    it('returns 400 when the email is missing', async () => {
      const { app, cookie } = await buildAuthenticatedApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/invite',
        headers: { cookie },
        payload: {},
      })

      expect(response.statusCode).toBe(400)
      expect(send).not.toHaveBeenCalled()
    })

    it('returns 500 when the mail domain is not configured', async () => {
      delete process.env.MAIL_DOMAIN
      const { app, cookie } = await buildAuthenticatedApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/invite',
        headers: { cookie },
        payload: { email: 'new-admin@example.com' },
      })

      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ ok: false, error: 'Server is not configured to send email' })
      expect(send).not.toHaveBeenCalled()
    })

    it('still creates the user and invite, and returns ok, when SES fails to send the email', async () => {
      send.mockRejectedValueOnce(new Error('MessageRejected'))
      const { app, cookie } = await buildAuthenticatedApp()

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/invite',
        headers: { cookie },
        payload: { email: 'new-admin@example.com' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(dbState.insertedUsers).toEqual([{ email: 'new-admin@example.com' }])
      expect(dbState.insertedInvites).toHaveLength(1)
    })
  })
})
