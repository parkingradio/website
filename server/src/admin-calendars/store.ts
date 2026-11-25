import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { TOKEN_FORMAT, randomToken } from '../core/tokens.js'
import type { Queryable } from '../db/connection.js'
import { users } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import { inFeed } from '../events/store.js'
import { sessionsWhere } from '../sessions/store.js'
import type { StoredSession } from '../sessions/store.js'

// The tokens of admins' calendars, and the sessions of their calendar of sessions (see
// docs/design/server/admin-calendars.md). Each admin's token is in their row, so that revoking them, which deletes it, makes
// their links stop working.

export type AdminCalendarsStore = {
  // The admin's token, which they get the first time it's asked for, or null when there's no such admin, e.g. once
  // they're revoked.
  token(adminId: string): Promise<string | null>
  // Replaces the admin's token, and returns the new one, or null when there's no such admin.
  replace(adminId: string): Promise<string | null>
  // Whether `token` is an admin's.
  isToken(token: string): Promise<boolean>
  // The sessions of the calendar of sessions at `now` (see `inFeed` in events/store.ts), whatever their status, announced or
  // not, in any order.
  sessions(now: Date): Promise<StoredSession[]>
}

export function adminCalendarsStore(db: Queryable): AdminCalendarsStore {
  // Sets the admin's token to `value`, and returns it as it is then.
  async function setToken(adminId: string, value: SQL | string): Promise<string | null> {
    if (!isUuid(adminId)) return null
    const [row] = await db.update(users).set({ icsSubscriptionToken: value }).where(eq(users.id, adminId)).returning({ token: users.icsSubscriptionToken })
    return row?.token ?? null
  }

  return {
    // In a single statement, so that two requests at once, e.g. from two tabs, both give the token that one of them keeps.
    token: (adminId) => setToken(adminId, sql`coalesce(${users.icsSubscriptionToken}, ${randomToken()})`),

    replace: (adminId) => setToken(adminId, randomToken()),

    async isToken(token) {
      if (!TOKEN_FORMAT.test(token)) return false
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.icsSubscriptionToken, token))
      return row !== undefined
    },

    sessions: (now) => sessionsWhere(db, inFeed(now)),
  }
}
