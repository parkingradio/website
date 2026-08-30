import { sql } from 'drizzle-orm'
import type { db as Database } from './db.js'
import { users } from './schema.js'
import { hashPassword } from './auth.js'
import { config } from './config.js'

export async function ensureBootstrapAdmin(db: typeof Database): Promise<void> {
  const email = config.bootstrapAdminEmail
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)

  if (existing) return

  const passwordHash = await hashPassword(config.bootstrapAdminPassword)
  await db.insert(users).values({ email, passwordHash })
}
