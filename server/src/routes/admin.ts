import type { FastifyInstance } from 'fastify'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { config } from '../config.js'
import { requireAuth } from '../auth.js'

const ses = new SESv2Client({ region: config.awsRegion })

type SendTestEmailBody = {
  recipient?: string
}

export async function adminRoutes(app: FastifyInstance) {
  app.post<{ Body: SendTestEmailBody }>(
    '/api/admin/send-test-email',
    { preHandler: requireAuth },
    async (request, reply) => {
      const recipient = request.body?.recipient
      if (!recipient) {
        return reply.status(400).send({ ok: false, error: 'Missing recipient email address' })
      }
      if (!config.awsRegion || !config.mailDomain) {
        return reply.status(500).send({ ok: false, error: 'Server is not configured to send email' })
      }

      try {
        const response = await ses.send(
          new SendEmailCommand({
            FromEmailAddress: `noreply@${config.mailDomain}`,
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
    },
  )
}
