import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'

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

import { adminRoutes } from './admin.js'
import { signSessionToken, SESSION_COOKIE } from '../auth.js'

describe('POST /api/admin/send-test-email', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    send.mockReset()
    process.env.AWS_REGION = 'us-east-1'
    process.env.MAIL_DOMAIN = 'parking.radio'
    process.env.JWT_SECRET = 'test-secret'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  async function buildAuthenticatedApp(options?: { logger?: boolean }) {
    const app = Fastify({ logger: options?.logger ?? true })
    await app.register(fastifyCookie)
    await app.register(adminRoutes)
    const token = await signSessionToken({ id: 'user-1', email: 'admin@example.com' })
    return { app, cookie: `${SESSION_COOKIE}=${token}` }
  }

  it('returns 401 when there is no session cookie', async () => {
    const app = Fastify()
    await app.register(fastifyCookie)
    await app.register(adminRoutes)

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/send-test-email',
      payload: { recipient: 'you@example.com' },
    })

    expect(response.statusCode).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it('returns ok and a message id when SES accepts the email', async () => {
    send.mockResolvedValueOnce({ MessageId: 'abc-123' })
    const { app, cookie } = await buildAuthenticatedApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/send-test-email',
      headers: { cookie },
      payload: { recipient: 'you@example.com' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, messageId: 'abc-123' })
  })

  it('returns 400 when the recipient is missing', async () => {
    const { app, cookie } = await buildAuthenticatedApp()

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/send-test-email',
      headers: { cookie },
      payload: {},
    })

    expect(response.statusCode).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })

  it('returns 500 when SES rejects the email', async () => {
    send.mockRejectedValueOnce(new Error('MessageRejected'))
    const { app, cookie } = await buildAuthenticatedApp({ logger: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/send-test-email',
      headers: { cookie },
      payload: { recipient: 'you@example.com' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Error: MessageRejected' })
  })

  it('returns 500 when AWS_REGION or MAIL_DOMAIN is not configured', async () => {
    delete process.env.MAIL_DOMAIN
    const { app, cookie } = await buildAuthenticatedApp({ logger: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/send-test-email',
      headers: { cookie },
      payload: { recipient: 'you@example.com' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Server is not configured to send email' })
    expect(send).not.toHaveBeenCalled()
  })
})
