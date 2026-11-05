import path from 'node:path'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

// Applies the migrations of drizzle/ that the database doesn't have yet, as the server does when it starts.
export async function migrateDatabase(db: NodePgDatabase) {
  await migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../../drizzle') })
}
