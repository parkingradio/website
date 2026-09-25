import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { healthRoutes } from './routes/health.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { configRoutes } from './routes/config.js'
import { notFoundRoutes } from './routes/not-found.js'
import { eventsRoutes } from './routes/events.js'
import { config } from './config.js'
import { db } from './db.js'
import { logger } from './logger.js'
import { ensureBootstrapAdmin } from './bootstrap-admin.js'
import { spaRoutes } from './spa.js'

const app = Fastify({ loggerInstance: logger })

try {
  await migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../drizzle') })
  await ensureBootstrapAdmin(db)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

await app.register(fastifyCookie)
await app.register(healthRoutes)
await app.register(configRoutes)
await app.register(authRoutes)
await app.register(adminRoutes)
await app.register(eventsRoutes)
await app.register(notFoundRoutes, { prefix: '/api' })

const clientDist = path.join(import.meta.dirname, '../../client/dist')

if (existsSync(clientDist)) {
  await app.register(spaRoutes, { root: clientDist })
}

const port = config.port

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
