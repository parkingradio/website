import type { FastifyInstance } from 'fastify'
import type { InviteRequest, InviteResponse } from 'shared/admin'
import type { ApiError } from 'shared/error'
import { inviteLink } from '../admins.js'
import type { AdminsStore } from '../admins.js'
import { requireAuth } from '../auth.js'
import type { SendEmail } from '../email.js'

type AdminOptions = {
  store: AdminsStore
  // Null when the server can't send emails, e.g. in development, where MAIL_DOMAIN isn't set.
  sendEmail: SendEmail | null
  // Where the site that invites link to is.
  origin: string
}

export async function adminRoutes(app: FastifyInstance, { store, sendEmail, origin }: AdminOptions) {
  app.post<{ Body: Partial<InviteRequest>; Reply: InviteResponse | ApiError }>(
    '/api/admin/invite',
    { preHandler: requireAuth },
    async (request, reply) => {
      const email = request.body?.email
      if (!email) {
        return reply.status(400).send({ ok: false, error: 'Missing email address' })
      }
      // Checked first, since inviting replaces the earlier invite, e.g. one the create-admin command printed.
      if (!sendEmail) {
        return reply.status(500).send({ ok: false, error: 'Server is not configured to send email' })
      }

      const outcome = await store.invite(email, { active: 'refuse' })
      if (outcome.kind === 'active') {
        return reply.status(409).send({ ok: false, error: 'This email address is already an activated admin' })
      }

      try {
        await sendEmail({
          to: [email],
          subject: 'Parking Radio - admin invite',
          text: `You've been invited to Parking Radio's admin panel. Set your password to activate your account: ${inviteLink(origin, outcome.token)}`,
        })
      } catch (error) {
        // An EmailNotSent, which leaves the addresses out.
        request.log.error({ err: error }, 'Failed to email an admin invite')
      }

      return { ok: true }
    },
  )
}
