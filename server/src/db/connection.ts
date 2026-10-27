import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import type { PoolConfig } from 'pg'
import { parseIntoClientConfig } from 'pg-connection-string'
import { config } from '../core/config.js'
import { logger } from '../core/logger.js'
import { secretsManagerPassword } from './password.js'

// pg waits forever for a new connection by default. Opening one includes fetching the password from
// Secrets Manager, so bound it to fail requests quickly rather than hang them if that call is slow.
const CONNECTION_TIMEOUT_MILLIS = 5_000

export function poolConfig(): PoolConfig {
  const ssl = config.databaseSslCa ? { ca: readFileSync(config.databaseSslCa, 'utf8') } : undefined
  const secretId = config.databasePasswordSecretId
  if (!secretId) {
    return {
      connectionString: config.databaseUrl,
      ssl,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
    }
  }

  // pg calls the `password` function for every new connection, so a rotated password is picked up
  // by the next connection. However, pg ignores that function when it's given a connection string,
  // so parse the URL into individual settings instead, the same way pg would.
  return {
    ssl,
    ...parseIntoClientConfig(config.databaseUrl),
    password: secretsManagerPassword(secretId, config.awsRegion),
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
  }
}

const pool = new Pool(poolConfig())

// An idle connection can be closed from the server's side at any time (e.g. during RDS maintenance).
// pg reports that as an 'error' event on the pool, which would crash the process if unhandled. The
// pool discards that connection and opens a new one when needed, so there is nothing else to do.
pool.on('error', (error) => logger.error(error, 'Idle database connection closed unexpectedly'))

export const db = drizzle(pool)

// The database, or a transaction on it. Both run queries the same way, so a store built on a transaction works like one
// built on the database, except that its queries are part of the transaction.
export type Queryable = PgDatabase<NodePgQueryResultHKT>
