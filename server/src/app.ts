import type { FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import type { AdminsStore } from './admins.js'
import { useZodSchemas } from './api-schemas.js'
import type { ApplicationsStore } from './applications.js'
import type { ApplicationsSettingsStore } from './applications-settings.js'
import type { ApplyStore } from './apply.js'
import type { ArtistsStore, Photos } from './artists.js'
import type { Queryable } from './db.js'
import type { SendEmail } from './email.js'
import type { FeaturesStore } from './features.js'
import type { OnAirStore } from './on-air.js'
import type { RadioSettingsStore } from './radio-settings.js'
import type { SoundCloudClient, SoundCloudCredentials } from './soundcloud.js'
import type { SoundCloudCredentialsStore } from './soundcloud-credentials.js'
import type { TurnstileVerifier } from './turnstile.js'
import { adminRoutes } from './routes/admin.js'
import { applicationsRoutes } from './routes/applications.js'
import { applyRoutes } from './routes/apply.js'
import { artistsRoutes } from './routes/artists.js'
import { authRoutes } from './routes/auth.js'
import { configRoutes } from './routes/config.js'
import { eventsRoutes } from './routes/events.js'
import { featuresRoutes } from './routes/features.js'
import { healthRoutes } from './routes/health.js'
import { notFoundRoutes } from './routes/not-found.js'
import { radioRoutes } from './routes/radio.js'

// What the routes use to handle requests: the database, the stores built on it, and the services the server talks to.
export type Dependencies = {
  db: Queryable
  admins: AdminsStore
  features: FeaturesStore
  // Null when the server can't send emails, e.g. in development, where MAIL_DOMAIN isn't set.
  sendEmail: SendEmail | null
  // Where the site is, e.g. for the links in emails.
  siteOrigin: string
  // Builds a client for SoundCloud that uses the credentials it's given.
  soundcloud: (credentials: SoundCloudCredentials) => SoundCloudClient
  soundCloudCredentials: SoundCloudCredentialsStore
  onAir: OnAirStore
  radioSettings: RadioSettingsStore
  artists: ArtistsStore
  photos: Photos
  applications: ApplicationsStore
  applicationsSettings: ApplicationsSettingsStore
  apply: ApplyStore
  verifyTurnstile: TurnstileVerifier
}

// Registers every route of the server, other than the client's (see spa.ts). The routes only use `deps` to handle
// requests, so that generate-openapi.ts can register them without a database.
export async function registerRoutes(app: FastifyInstance, deps: Dependencies) {
  useZodSchemas(app)
  app.decorate('sessions', deps.admins)
  await app.register(fastifyCookie)
  await app.register(healthRoutes, { db: deps.db })
  await app.register(configRoutes, { store: deps.features })
  await app.register(authRoutes, { db: deps.db })
  await app.register(adminRoutes, { store: deps.admins, sendEmail: deps.sendEmail, origin: deps.siteOrigin })
  await app.register(eventsRoutes)
  await app.register(radioRoutes, {
    soundcloud: deps.soundcloud,
    credentials: deps.soundCloudCredentials,
    onAir: deps.onAir,
    settings: deps.radioSettings,
  })
  await app.register(artistsRoutes, { store: deps.artists, photos: deps.photos })
  await app.register(applicationsRoutes, { store: deps.applications, settings: deps.applicationsSettings })
  await app.register(applyRoutes, {
    store: deps.apply,
    photos: deps.photos,
    verifyTurnstile: deps.verifyTurnstile,
    settings: deps.applicationsSettings,
    sendEmail: deps.sendEmail,
  })
  await app.register(featuresRoutes, { store: deps.features })
  await app.register(notFoundRoutes, { prefix: '/api' })
}
