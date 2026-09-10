import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { healthRoutes } from './routes/health.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { configRoutes } from './routes/config.js'
import { config } from './config.js'
import { db } from './db.js'
import { ensureBootstrapAdmin } from './bootstrap-admin.js'

const app = Fastify({ logger: true })

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

const clientDist = path.join(import.meta.dirname, '../../client/dist')

if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist })

  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET') {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send()
  })
}

const port = config.port

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
