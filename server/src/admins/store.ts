import { eq, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Queryable } from '../db/connection.js'
import { invites, users } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import { generateInviteToken } from './auth.js'

// The admins, and the invites that let them choose their password. Admins are invited from the admin pages, or with the
// create-admin command (see create-admin.ts), which is also how the first admin is created.

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000

export type InviteOutcome =
  // `admin` is who the invite is for: a new admin, one who hadn't accepted their invite yet, or one who had, whose
  // password it resets.
  | { kind: 'invited'; token: string; admin: 'new' | 'pending' | 'active' }
  | { kind: 'active' } // only when `active` is 'refuse'

export type StoredAdmin = {
  id: string
  email: string
  // Whether they've chosen their password, i.e. accepted an invite.
  active: boolean
  // When their latest invite expires, or null if they have none, e.g. once it's accepted, or cleaned up after expiring.
  inviteExpiresAt: Date | null
  invitedBy: string | null
  createdAt: Date
}

export type AdminsStore = {
  // Every admin, by email whatever its case.
  list(): Promise<StoredAdmin[]>
  // Creates an invite to `email` that lasts INVITE_TTL_MS, replacing any earlier invite to that address, and creating the
  // admin if there's none, as invited by `invitedBy` (an admin's email, or null for the create-admin command). An admin
  // who already accepted an invite is refused, unless `active` is 'reinvite': then the invite resets their password once
  // accepted, and their current one keeps working until then.
  invite(email: string, options: { active: 'refuse' | 'reinvite'; invitedBy: string | null }): Promise<InviteOutcome>
  // Deletes an admin, with their invites, and returns their email. Null if there's no such admin.
  delete(id: string): Promise<{ email: string } | null>
  // The version of the admin's sessions (see `sessionVersion` in db/schema.ts), or null if there's no such admin, e.g.
  // once they were revoked. What requireAuth checks sessions against.
  sessionVersion(id: string): Promise<number | null>
}

// 'active' once the admin has chosen their password. Until then, 'invited' while their invite lasts, and 'expired' after.
export const AdminStatus = z.enum(['active', 'invited', 'expired'])
export type AdminStatus = z.infer<typeof AdminStatus>

// What the admin pages say of an admin, `now`.
export function adminStatus({ active, inviteExpiresAt }: Pick<StoredAdmin, 'active' | 'inviteExpiresAt'>, now: Date): AdminStatus {
  if (active) return 'active'
  return inviteExpiresAt && inviteExpiresAt > now ? 'invited' : 'expired'
}

export function adminsStore(db: Queryable): AdminsStore {
  return {
    async list() {
      // Admins only have more than one invite if two were sent at once, in which case the latest is the one that counts.
      return db
        .select({
          id: users.id,
          email: users.email,
          active: sql<boolean>`${users.passwordHash} is not null`,
          inviteExpiresAt: sql<Date | null>`max(${invites.expiresAt})`.mapWith(invites.expiresAt),
          invitedBy: users.invitedBy,
          createdAt: users.createdAt,
        })
        .from(users)
        .leftJoin(invites, eq(invites.userId, users.id))
        .groupBy(users.id)
        .orderBy(sql`lower(${users.email})`)
    },

    async invite(email, { active, invitedBy }) {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: users.id, passwordHash: users.passwordHash })
          .from(users)
          .where(sql`lower(${users.email}) = lower(${email})`)

        if (existing?.passwordHash && active === 'refuse') return { kind: 'active' as const }

        const userId = existing ? existing.id : (await tx.insert(users).values({ email, invitedBy }).returning({ id: users.id }))[0].id
        if (existing) await tx.delete(invites).where(eq(invites.userId, userId))

        const { token, tokenHash } = generateInviteToken()
        await tx.insert(invites).values({ userId, tokenHash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
        await tx.delete(invites).where(lt(invites.expiresAt, new Date())) // garbage collect expired invites

        const admin = !existing ? 'new' : existing.passwordHash ? 'active' : 'pending'
        return { kind: 'invited' as const, token, admin }
      })
    },

    async delete(id) {
      if (!isUuid(id)) return null
      const [row] = await db.delete(users).where(eq(users.id, id)).returning({ email: users.email })
      return row ?? null
    },

    async sessionVersion(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select({ sessionVersion: users.sessionVersion }).from(users).where(eq(users.id, id))
      return row?.sessionVersion ?? null
    },
  }
}

// Where an invite leads: the page where the admin chooses their password, on the site at `origin`.
export function inviteLink(origin: string, token: string): string {
  return `${origin}/accept-invite?token=${token}`
}

// What the create-admin command does: invites `email` whatever the admin's state, and returns what to tell whoever ran
// it, invite link included. The command gives them the link rather than emailing it, so that it works before email is set
// up, and so that whoever has access to the server can always get back into the admin pages.
export async function createAdmin(store: Pick<AdminsStore, 'invite'>, email: string, origin: string): Promise<string> {
  const outcome = await store.invite(email, { active: 'reinvite', invitedBy: null })
  if (outcome.kind !== 'invited') throw new Error(`Unexpected outcome: ${outcome.kind}`)
  const link = inviteLink(origin, outcome.token)
  const what = {
    new: `Created admin ${email}.`,
    pending: `${email} hadn't accepted their invite yet: earlier links no longer work.`,
    active:
      `${email} is already an admin: this link resets their password, which keeps working until then. ` +
      'Resetting it logs them out everywhere.',
  }[outcome.admin]
  return `${what}\nInvite link, valid for ${INVITE_TTL_MS / 3_600_000} hours and usable once:\n${link}`
}
