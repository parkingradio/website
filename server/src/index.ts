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
import { radioRoutes } from './routes/radio.js'
import { config } from './config.js'
import { db } from './db.js'
import { logger } from './logger.js'
import { ensureBootstrapAdmin } from './bootstrap-admin.js'
import { spaRoutes } from './spa.js'
import { soundCloudClient } from './soundcloud.js'
import { onAirStore } from './on-air.js'
import { radioSettingsStore } from './radio-settings.js'

const app = Fastify({ loggerInstance: logger })
app.addHook('onClose', () => db.$client.end())

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
await app.register(radioRoutes, {
  soundcloud: soundCloudClient({ clientId: config.soundcloudClientId, clientSecret: config.soundcloudClientSecret }),
  onAir: onAirStore(db),
  settings: radioSettingsStore(db),
})
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

// Shut down gracefully when asked to: closing the app lets in-flight requests finish first. This is
// only set up once the server is listening, since closing the app while it's still starting would
// end the database pool under the startup code. Until then, signals keep their default handling.
// Signals received while already shutting down (e.g. Ctrl-C after a SIGTERM) are ignored.
//
// Requests that don't finish within SHUTDOWN_TIMEOUT_MS are cut short. This is kept under the 10s that
// `docker stop` waits before killing the server, so that the server still exits on its own terms.
const SHUTDOWN_TIMEOUT_MS = 8_000
let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info(`Received ${signal}, shutting down`)
    setTimeout(() => {
      app.log.error(`Shutdown did not complete within ${SHUTDOWN_TIMEOUT_MS}ms, exiting anyway`)
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error)
        process.exit(1)
      },
    )
  })
}
