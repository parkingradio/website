import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL_CA ? { ca: readFileSync(process.env.DATABASE_SSL_CA, 'utf8') } : undefined,
})

export const db = drizzle(pool)
