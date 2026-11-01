import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import type { FastifyBaseLogger } from 'fastify'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { frameworkErrors } from './api/errors.js'
import { registerRoutes } from './app.js'
import { config } from './core/config.js'
import { db } from './db/connection.js'
import { logger } from './core/logger.js'
import { spaRoutes } from './site/spa.js'
import { soundCloudClient } from './radio/soundcloud.js'
import { soundCloudCredentialsStore } from './radio/soundcloud-credentials.js'
import { onAirStore } from './radio/on-air.js'
import { radioSettingsStore } from './radio/settings.js'
import { artistsStore, privatePhotos } from './artists/store.js'
import { collectivesStore } from './collectives/store.js'
import { privateBucket } from './core/private-bucket.js'
import { applicationsStore } from './applications/store.js'
import { applicationsSettingsStore } from './applications/settings.js'
import { applyStore } from './applications/apply-store.js'
import { turnstileVerifier } from './applications/turnstile.js'
import { sesEmailSender } from './core/email.js'
import { adminsStore } from './admins/store.js'
import { featuresStore } from './features/store.js'

// As a FastifyBaseLogger, so that `app` is the FastifyInstance that registerRoutes takes.
const loggerInstance: FastifyBaseLogger = logger
// Errors are sent as an `ApiError` even when Fastify raises them before routing a request, e.g. for a URL that isn't
// valid: the error handler set by registerRoutes takes care of the others.
const app = Fastify({ loggerInstance, frameworkErrors })
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
  collectives: collectivesStore(db),
  photos: privatePhotos(privateBucket(config.privateFiles)),
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
