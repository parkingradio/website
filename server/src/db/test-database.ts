import { randomBytes } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { Queryable } from './connection.js'
import { migrateDatabase } from './migrate.js'

// For the tests that need a real database (*.db.test.ts, see vitest.db.config.ts): a database of their own, created on
// the Postgres server at DATABASE_URL, e.g. the development one (`npm run db:up`), with every migration applied, and
// dropped once they're done.

export type TestDatabase = { db: Queryable; drop(): Promise<void> }

export async function testDatabase(): Promise<TestDatabase> {
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
    await migrateDatabase(db)
  } catch (error) {
    await drop()
    throw error
  }
  return { db, drop }
}
