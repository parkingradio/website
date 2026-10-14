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
import { artistsRoutes } from './routes/artists.js'
import { applicationsRoutes } from './routes/applications.js'
import { applyRoutes } from './routes/apply.js'
import { featuresRoutes } from './routes/features.js'
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

const app = Fastify({ loggerInstance: logger })
app.addHook('onClose', () => db.$client.end())

try {
  await migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../drizzle') })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

// Null when the server can't send emails, e.g. in development, where MAIL_DOMAIN isn't set.
const sendEmail = config.mailDomain ? sesEmailSender(config.awsRegion, config.mailDomain) : null

const admins = adminsStore(db)
app.decorate('sessions', admins)

await app.register(fastifyCookie)
await app.register(healthRoutes)
const features = featuresStore(db)
await app.register(configRoutes, { store: features })
await app.register(authRoutes)
await app.register(adminRoutes, { store: admins, sendEmail, origin: config.siteOrigin })
await app.register(eventsRoutes)
await app.register(radioRoutes, {
  soundcloud: soundCloudClient,
  credentials: soundCloudCredentialsStore(db),
  onAir: onAirStore(db),
  settings: radioSettingsStore(db),
})
const photos = artistPhotos(privateBucket(config.privateFiles))
await app.register(artistsRoutes, { store: artistsStore(db), photos })
const applicationsSettings = applicationsSettingsStore(db)
await app.register(applicationsRoutes, { store: applicationsStore(db), settings: applicationsSettings })
await app.register(applyRoutes, {
  store: applyStore(db),
  photos,
  verifyTurnstile: turnstileVerifier(config.turnstileSecretKey),
  settings: applicationsSettings,
  sendEmail,
})
await app.register(featuresRoutes, { store: features })
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
