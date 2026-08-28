import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

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

describe('POST /api/admin/send-test-email', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    send.mockReset()
    process.env.AWS_REGION = 'us-east-1'
    process.env.MAIL_DOMAIN = 'parking.radio'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns ok and a message id when SES accepts the email', async () => {
    send.mockResolvedValueOnce({ MessageId: 'abc-123' })
    const app = Fastify()
    await app.register(adminRoutes)

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/send-test-email',
      payload: { recipient: 'you@example.com' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, messageId: 'abc-123' })
  })

  it('returns 400 when the recipient is missing', async () => {
    const app = Fastify()
    await app.register(adminRoutes)

    const response = await app.inject({ method: 'POST', url: '/api/admin/send-test-email', payload: {} })

    expect(response.statusCode).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })

  it('returns 500 when SES rejects the email', async () => {
    send.mockRejectedValueOnce(new Error('MessageRejected'))
    const app = Fastify({ logger: false })
    await app.register(adminRoutes)

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/send-test-email',
      payload: { recipient: 'you@example.com' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Error: MessageRejected' })
  })

  it('returns 500 when AWS_REGION or MAIL_DOMAIN is not configured', async () => {
    delete process.env.MAIL_DOMAIN
    const app = Fastify({ logger: false })
    await app.register(adminRoutes)

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/send-test-email',
      payload: { recipient: 'you@example.com' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Server is not configured to send email' })
    expect(send).not.toHaveBeenCalled()
  })
})
