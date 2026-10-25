import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import type { FastifyBaseLogger } from 'fastify'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { registerRoutes } from './app.js'
import { config } from './config.js'
import { db } from './db.js'
import { logger } from './logger.js'
import { spaRoutes } from './spa.js'
import { soundCloudClient } from './soundcloud.js'
import { soundCloudCredentialsStore } from './soundcloud-credentials.js'
import { onAirStore } from './on-air.js'
import { radioSettingsStore } from './radio-settings.js'
import { artistPhotos, artistsStore } from './artists.js'
import { privateBucket } from './private-bucket.js'
import { applicationsStore } from './applications.js'
import { applicationsSettingsStore } from './applications-settings.js'
import { applyStore } from './apply.js'
import { turnstileVerifier } from './turnstile.js'
import { sesEmailSender } from './email.js'
import { adminsStore } from './admins.js'
import { featuresStore } from './features.js'

// As a FastifyBaseLogger, so that `app` is the FastifyInstance that registerRoutes takes.
const loggerInstance: FastifyBaseLogger = logger
const app = Fastify({ loggerInstance })
app.addHook('onClose', () => db.$client.end())

try {
  await migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../drizzle') })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

await registerRoutes(app, {
  db,
  admins: adminsStore(db),
  features: featuresStore(db),
  sendEmail: config.mailDomain ? sesEmailSender(config.awsRegion, config.mailDomain) : null,
  siteOrigin: config.siteOrigin,
  soundcloud: soundCloudClient,
  soundCloudCredentials: soundCloudCredentialsStore(db),
  onAir: onAirStore(db),
  radioSettings: radioSettingsStore(db),
  artists: artistsStore(db),
  photos: artistPhotos(privateBucket(config.privateFiles)),
  applications: applicationsStore(db),
  applicationsSettings: applicationsSettingsStore(db),
  apply: applyStore(db),
  verifyTurnstile: turnstileVerifier(config.turnstileSecretKey),
})

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
