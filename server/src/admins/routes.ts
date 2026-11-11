import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ApiError, Ok, Timestamp, Total, zodRoutes } from '../api/schemas.js'
import { AdminStatus, adminStatus, inviteLink } from './store.js'
import type { AdminsStore, StoredAdmin } from './store.js'
import type { SendEmail } from '../core/email.js'
import { EMAIL_MAX_LENGTH, isEmailAddress } from '../artists/profile.js'

// Admin routes for the admins themselves: see them, invite them, and revoke them. Logging in is in
// admins/auth-routes.ts.

const Admin = z
  .object({
    id: z.string(),
    email: z.string(),
    status: AdminStatus,
    // While they're invited.
    inviteExpiresAt: Timestamp.nullable(),
    // The email of the admin who invited them. Null when they were created with the create-admin command, or before that
    // was known.
    invitedBy: z.string().nullable(),
    // When they were invited.
    createdAt: Timestamp,
    // Whether this is the admin who asked.
    you: z.boolean(),
  })
  .meta({ id: 'Admin' })

const NO_SUCH_ADMIN: z.infer<typeof ApiError> = { ok: false, error: 'No such admin' }

// Who to invite: an email address like an artist's (see artists/profile.ts), trimmed. Whatever's wrong with it gets the
// same single error, which doesn't repeat it.
const NOT_AN_EMAIL_ADDRESS = 'Not an email address'
const InviteEmail = z
  .string()
  .trim()
  .max(EMAIL_MAX_LENGTH, { error: NOT_AN_EMAIL_ADDRESS, abort: true })
  .refine(isEmailAddress, NOT_AN_EMAIL_ADDRESS)
  .meta({ description: `An email address, which is trimmed, up to ${EMAIL_MAX_LENGTH} characters` })

// An admin, as the admin pages show them to `you`, the admin who asked, `now`.
function admin(stored: StoredAdmin, you: string, now: Date): z.infer<typeof Admin> {
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
  const api = zodRoutes(app)

  api.get(
    '/api/admin/admins',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Every admin, and whether they accepted their invite',
        tags: ['Admins'],
        response: { 200: z.object({ ok: z.literal(true), total: Total, admins: z.array(Admin) }) },
      },
    },
    async (request) => {
      const now = new Date()
      const admins = (await store.list()).map((stored) => admin(stored, request.user!.id, now))
      return { ok: true as const, total: admins.length, admins }
    },
  )

  api.delete(
    '/api/admin/admins/:id',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Revokes an admin, or cancels their invite',
        tags: ['Admins'],
        // Any id, so that one that isn't an admin's gets a 404.
        params: z.object({ id: z.string() }),
        response: { 200: Ok, 404: ApiError, 409: ApiError },
      },
    },
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
      return { ok: true as const }
    },
  )

  api.post(
    '/api/admin/invite',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Invites an admin by email',
        tags: ['Admins'],
        body: z.object({ email: InviteEmail }),
        // 500 when the server can't send emails.
        response: { 200: Ok, 409: ApiError, 500: ApiError },
      },
    },
    async (request, reply) => {
      const { email } = request.body
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

      return { ok: true as const }
    },
  )
}
