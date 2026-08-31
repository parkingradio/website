import type { FastifyInstance } from 'fastify'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { eq, lt, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { requireAuth, generateInviteToken } from '../auth.js'
import { db } from '../db.js'
import { users, invites } from '../schema.js'

const ses = new SESv2Client({ region: config.awsRegion })

const INVITE_TTL_MS = 24 * 60 * 60 * 1000

type InviteBody = {
  email?: string
}

export async function adminRoutes(app: FastifyInstance) {
  app.post<{ Body: InviteBody }>(
    '/api/admin/invite',
    { preHandler: requireAuth },
    async (request, reply) => {
      const email = request.body?.email
      if (!email) {
        return reply.status(400).send({ ok: false, error: 'Missing email address' })
      }

      const outcome = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: users.id, passwordHash: users.passwordHash })
          .from(users)
          .where(sql`lower(${users.email}) = lower(${email})`)

        if (existing?.passwordHash) {
          return { status: 'already-activated' as const }
        }

        const userId = existing ? existing.id : (await tx.insert(users).values({ email }).returning({ id: users.id }))[0].id

        if (existing) {
          await tx.delete(invites).where(eq(invites.userId, userId))
        }

        const { token, tokenHash } = generateInviteToken()
        const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
        await tx.insert(invites).values({ userId, tokenHash, expiresAt })
        await tx.delete(invites).where(lt(invites.expiresAt, new Date())) // garbage collect expired invitations

        return { status: 'created' as const, token }
      })

      if (outcome.status === 'already-activated') {
        return reply.status(409).send({ ok: false, error: 'This email address is already an activated admin' })
      }

      if (!config.mailDomain) {
        return reply.status(500).send({ ok: false, error: 'Server is not configured to send email' })
      }

      try {
        await ses.send(
          new SendEmailCommand({
            FromEmailAddress: `noreply@${config.mailDomain}`,
            Destination: { ToAddresses: [email] },
            Content: {
              Simple: {
                Subject: { Data: 'Parking Radio - admin invite' },
                Body: {
                  Text: {
                    Data: `You've been invited to Parking Radio's admin panel. Set your password to activate your account: https://${config.mailDomain}/accept-invite?token=${outcome.token}`,
                  },
                },
              },
            },
          }),
        )
      } catch (error) {
        app.log.error(error)
      }

      return { ok: true }
    },
  )
}
