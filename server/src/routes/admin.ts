import type { FastifyInstance } from 'fastify'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

const ses = new SESv2Client({ region: process.env.AWS_REGION })

type SendTestEmailBody = {
  recipient?: string
}

export async function adminRoutes(app: FastifyInstance) {
  app.post<{ Body: SendTestEmailBody }>('/api/admin/send-test-email', async (request, reply) => {
    const recipient = request.body?.recipient
    if (!recipient) {
      return reply.status(400).send({ ok: false, error: 'Missing recipient email address' })
    }

    try {
      const response = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: `noreply@${process.env.MAIL_DOMAIN}`,
          Destination: { ToAddresses: [recipient] },
          Content: {
            Simple: {
              Subject: { Data: 'Parking Radio - test email' },
              Body: { Text: { Data: 'This is a test email sent from the Parking Radio admin stub.' } },
            },
          },
        }),
      )
      return { ok: true, messageId: response.MessageId }
    } catch (error) {
      app.log.error(error)
      return reply.status(500).send({ ok: false, error: String(error) })
    }
  })
}
