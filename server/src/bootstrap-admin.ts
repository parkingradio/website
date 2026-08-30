import { sql } from 'drizzle-orm'
import type { db as Database } from './db.js'
import { users } from './schema.js'
import { config } from './config.js'

export async function ensureBootstrapAdmin(db: typeof Database): Promise<void> {
  const email = config.bootstrapAdminEmail
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)

  if (existing) return

  // Stored as-is for now; hashed once password hashing lands in a later patch.
  await db.insert(users).values({ email, passwordHash: config.bootstrapAdminPassword })
}

