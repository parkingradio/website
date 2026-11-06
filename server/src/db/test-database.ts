import { randomBytes } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { Queryable } from './connection.js'
import { MIGRATIONS_FOLDER, migrateDatabase } from './migrate.js'

// For the tests that need a real database (*.db.test.ts, see vitest.db.config.ts): a database of their own, created on
// the Postgres server at DATABASE_URL, e.g. the development one (`npm run db:up`), with every migration applied, and
// dropped once they're done. For the tests of a migration, `before` is its tag, e.g. "0009_session_types": only the
// migrations before it are applied, and `migrateDatabase` then applies the others.

export type TestDatabase = { db: Queryable; drop(): Promise<void> }

// Applies the migrations of drizzle/ before the one tagged `tag`, from a copy whose journal stops there.
async function migrateUntil(db: NodePgDatabase, tag: string) {
  const folder = await mkdtemp(path.join(tmpdir(), 'parking-radio-migrations-'))
  try {
    await cp(MIGRATIONS_FOLDER, folder, { recursive: true })
    const journalPath = path.join(folder, 'meta/_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] }
    const index = journal.entries.findIndex((entry) => entry.tag === tag)
    if (index < 0) throw new Error(`No migration is tagged ${tag}`)
    await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }))
    await migrate(db, { migrationsFolder: folder })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

export async function testDatabase({ before }: { before?: string } = {}): Promise<TestDatabase> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL isn't set: these tests need a Postgres server, e.g. the development one (npm run db:up)")
  const name = `parking_radio_test_${randomBytes(6).toString('hex')}`
  const server = new Pool({ connectionString: url, max: 1 })
  try {
    await server.query(`create database ${name}`)
  } catch (error) {
    await server.end()
    throw error
  }

  const own = new URL(url)
  own.pathname = `/${name}`
  const pool = new Pool({ connectionString: own.toString() })
  const db = drizzle(pool)
  const drop = async () => {
    await pool.end()
    await server.query(`drop database if exists ${name} with (force)`)
    await server.end()
  }
  try {
    await (before === undefined ? migrateDatabase(db) : migrateUntil(db, before))
  } catch (error) {
    await drop()
    throw error
  }
  return { db, drop }
}
