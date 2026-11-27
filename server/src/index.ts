import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import type { FastifyBaseLogger } from 'fastify'
import { frameworkErrors } from './api/errors.js'
import { registerRoutes } from './app.js'
import { config } from './core/config.js'
import { db } from './db/connection.js'
import { migrateDatabase } from './db/migrate.js'
import { logger } from './core/logger.js'
import { spaRoutes } from './site/spa.js'
import { notFoundRoutes } from './site/not-found.js'
import { soundCloudClient } from './radio/soundcloud.js'
import { soundCloudCredentialsStore } from './radio/soundcloud-credentials.js'
import { onAirStore } from './radio/on-air.js'
import { radioSettingsStore } from './radio/settings.js'
import { youTubeCredentialsStore } from './video/credentials.js'
import { youtube } from './video/youtube.js'
import { artistsStore, privatePhotos } from './artists/store.js'
import { sizesBackfill, storedImages } from './artists/backfill.js'
import { collectivesStore } from './collectives/store.js'
import { privateBucket } from './core/private-bucket.js'
import { applicationsStore } from './applications/store.js'
import { applicationsSettingsStore } from './applications/settings.js'
import { applyStore } from './applications/apply-store.js'
import { turnstileVerifier } from './api/turnstile.js'
import { sesEmailSender } from './core/email.js'
import { adminsStore } from './admins/store.js'
import { featuresStore } from './features/store.js'
import { sessionsStore } from './sessions/store.js'
import { eventsStore } from './events/store.js'
import { calendarFeedsStore } from './calendar/feeds.js'
import { calendarReads } from './calendar/reads.js'
import { discordCredentialsStore } from './chat/credentials.js'
import { discord } from './chat/discord.js'
import { discordStandIn } from './chat/stand-in.js'
import { oauthStore } from './oauth/store.js'
import { adminCalendarsStore } from './admin-calendars/store.js'

// As a FastifyBaseLogger, so that `app` is the FastifyInstance that registerRoutes takes.
const loggerInstance: FastifyBaseLogger = logger
// Errors are sent as an `ApiError` even when Fastify raises them before routing a request, e.g. for a URL that isn't
// valid: the error handler set by registerRoutes takes care of the others.
const app = Fastify({ loggerInstance, frameworkErrors })
const privateFiles = privateBucket(config.privateFiles)
const photos = privatePhotos(privateFiles, db, app.log)
// Started once the server listens, below, but its hooks can only be added before. It stops as soon as the server
// starts closing, and the server waits for the photo it's making, if any.
const backfill = sizesBackfill(() => storedImages(db), privateFiles, photos, app.log)
// Likewise for the reads of the calendar feeds, whose stopping also cuts short those of the feeds being added, so that
// their requests end.
const calendarFeeds = calendarFeedsStore(db)
const calendarFeedReads = calendarReads({ feeds: calendarFeeds, log: app.log })
const backgroundTasks = [backfill, calendarFeedReads]
app.addHook('preClose', async () => backgroundTasks.forEach((task) => task.stop()))
app.addHook('onClose', () => db.$client.end())
// After the database's hook, since Fastify runs the onClose hooks of the root instance from the last one added: the
// backfill and the reads are done with the database before it's closed, e.g. when the server closes while they list
// the photos or the feeds.
app.addHook('onClose', async () => {
  await Promise.all(backgroundTasks.map((task) => task.stopped()))
})

if (config.chatStandIn) app.log.info('Using the stand-in for Discord (CHAT_STAND_IN)')

try {
  await migrateDatabase(db)
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
  environment: config.environment,
  soundcloud: soundCloudClient,
  soundCloudCredentials: soundCloudCredentialsStore(db),
  onAir: onAirStore(db),
  radioSettings: radioSettingsStore(db),
  youtube,
  youtubeCredentials: youTubeCredentialsStore(db),
  artists: artistsStore(db),
  collectives: collectivesStore(db),
  photos,
  applications: applicationsStore(db),
  applicationsSettings: applicationsSettingsStore(db),
  apply: applyStore(db),
  verifyTurnstile: turnstileVerifier(config.turnstileSecretKey),
  sessions: sessionsStore(db),
  events: eventsStore(db),
  calendarFeeds,
  calendarReads: calendarFeedReads,
  adminCalendars: adminCalendarsStore(db),
  discord: config.chatStandIn ? discordStandIn : discord,
  discordCredentials: discordCredentialsStore(db),
  oauth: oauthStore(db),
})

const clientDist = path.join(import.meta.dirname, '../../client/dist')

if (existsSync(clientDist)) {
  await app.register(spaRoutes, { root: clientDist })
} else {
  // E.g. in development, where Vite serves the client. Rather than Fastify's own handler, which logs the request's URL with
  // its query string, e.g. an invite's token.
  await app.register(notFoundRoutes)
}

const port = config.port

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

for (const task of backgroundTasks) task.start()

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
