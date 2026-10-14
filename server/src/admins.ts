import { eq, lt, sql } from 'drizzle-orm'
import { generateInviteToken } from './auth.js'
import type { Queryable } from './db.js'
import { invites, users } from './schema.js'

// The admins, and the invites that let them choose their password. Admins are invited from the admin pages, or with the
// create-admin command (see create-admin.ts), which is also how the first admin is created.

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000

export type InviteOutcome =
  // `admin` is who the invite is for: a new admin, one who hadn't accepted their invite yet, or one who had, whose
  // password it resets.
  | { kind: 'invited'; token: string; admin: 'new' | 'pending' | 'active' }
  | { kind: 'active' } // only when `active` is 'refuse'

export type AdminsStore = {
  // Creates an invite to `email` that lasts INVITE_TTL_MS, replacing any earlier invite to that address, and creating the
  // admin if there's none. An admin who already accepted an invite is refused, unless `active` is 'reinvite': then the
  // invite resets their password once accepted, and their current one keeps working until then.
  invite(email: string, options: { active: 'refuse' | 'reinvite' }): Promise<InviteOutcome>
}

export function adminsStore(db: Queryable): AdminsStore {
  return {
    async invite(email, { active }) {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: users.id, passwordHash: users.passwordHash })
          .from(users)
          .where(sql`lower(${users.email}) = lower(${email})`)

        if (existing?.passwordHash && active === 'refuse') return { kind: 'active' as const }

        const userId = existing ? existing.id : (await tx.insert(users).values({ email }).returning({ id: users.id }))[0].id
        if (existing) await tx.delete(invites).where(eq(invites.userId, userId))

        const { token, tokenHash } = generateInviteToken()
        await tx.insert(invites).values({ userId, tokenHash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
        await tx.delete(invites).where(lt(invites.expiresAt, new Date())) // garbage collect expired invites

        const admin = !existing ? 'new' : existing.passwordHash ? 'active' : 'pending'
        return { kind: 'invited' as const, token, admin }
      })
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
export async function createAdmin(store: AdminsStore, email: string, origin: string): Promise<string> {
  const outcome = await store.invite(email, { active: 'reinvite' })
  if (outcome.kind !== 'invited') throw new Error(`Unexpected outcome: ${outcome.kind}`)
  const link = inviteLink(origin, outcome.token)
  const what = {
    new: `Created admin ${email}.`,
    pending: `${email} hadn't accepted their invite yet: earlier links no longer work.`,
    active:
      `${email} is already an admin: this link resets their password, which keeps working until then. ` +
      "It doesn't end the sessions they already have.",
  }[outcome.admin]
  return `${what}\nInvite link, valid for ${INVITE_TTL_MS / 3_600_000} hours and usable once:\n${link}`
}
