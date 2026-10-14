import type { FastifyInstance } from 'fastify'
import type { Admin, AdminsResponse, DeleteAdminResponse, InviteRequest, InviteResponse } from 'shared/admin'
import type { ApiError } from 'shared/error'
import { adminStatus, inviteLink } from '../admins.js'
import type { AdminsStore, StoredAdmin } from '../admins.js'
import { requireAuth } from '../auth.js'
import type { SendEmail } from '../email.js'

// Admin routes for the admins themselves: see them, invite them, and revoke them.

const NO_SUCH_ADMIN: ApiError = { ok: false, error: 'No such admin' }

// An admin, as the admin pages show them to `you`, the admin who asked, `now`.
function admin(stored: StoredAdmin, you: string, now: Date): Admin {
  const status = adminStatus(stored, now)
  return {
    id: stored.id,
    email: stored.email,
    status,
    inviteExpiresAt: status === 'invited' ? stored.inviteExpiresAt!.toISOString() : null,
    invitedBy: stored.invitedBy,
    createdAt: stored.createdAt.toISOString(),
    you: stored.id === you,
  }
}

type AdminOptions = {
  store: AdminsStore
  // Null when the server can't send emails, e.g. in development, where MAIL_DOMAIN isn't set.
  sendEmail: SendEmail | null
  // Where the site that invites link to is.
  origin: string
}

export async function adminRoutes(app: FastifyInstance, { store, sendEmail, origin }: AdminOptions) {
  app.get<{ Reply: AdminsResponse }>('/api/admin/admins', { preHandler: requireAuth }, async (request) => {
    const now = new Date()
    return { ok: true, admins: (await store.list()).map((stored) => admin(stored, request.user!.id, now)) }
  })

  app.delete<{ Params: { id: string }; Reply: DeleteAdminResponse | ApiError }>(
    '/api/admin/admins/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      // There's always an admin left this way, and if two revoke each other at once, the create-admin command remains. Ids
      // are UUIDs, which the database matches whatever their case, and are lowercase in sessions.
      if (request.params.id.toLowerCase() === request.user!.id) {
        return reply.status(409).send({ ok: false, error: "You can't revoke yourself" })
      }
      const revoked = await store.delete(request.params.id)
      if (!revoked) return reply.status(404).send(NO_SUCH_ADMIN)
      // Nothing else keeps track of it once the admin is gone.
      request.log.info({ admin: revoked.email, by: request.user!.email }, 'Revoked an admin')
      return { ok: true }
    },
  )

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

      const outcome = await store.invite(email, { active: 'refuse', invitedBy: request.user!.email })
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
