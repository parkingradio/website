import type { FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { authRoutes } from './admins/auth-routes.js'
import { adminRoutes } from './admins/routes.js'
import type { AdminsStore } from './admins/store.js'
import { useZodSchemas } from './api/schemas.js'
import { applyRoutes } from './applications/apply-routes.js'
import type { ApplyStore } from './applications/apply-store.js'
import { applicationsRoutes } from './applications/routes.js'
import type { ApplicationsSettingsStore } from './applications/settings.js'
import type { ApplicationsStore } from './applications/store.js'
import type { TurnstileVerifier } from './applications/turnstile.js'
import { artistsRoutes } from './artists/routes.js'
import type { ArtistsStore, Photos } from './artists/store.js'
import { collectivesRoutes } from './collectives/routes.js'
import type { CollectivesStore } from './collectives/store.js'
import type { SendEmail } from './core/email.js'
import type { Queryable } from './db/connection.js'
import { eventsRoutes } from './events/routes.js'
import { featuresRoutes } from './features/routes.js'
import type { FeaturesStore } from './features/store.js'
import type { OnAirStore } from './radio/on-air.js'
import { radioRoutes } from './radio/routes.js'
import type { RadioSettingsStore } from './radio/settings.js'
import { soundCloudApp } from './radio/soundcloud-app.js'
import type { SoundCloudClient, SoundCloudCredentials } from './radio/soundcloud.js'
import type { SoundCloudCredentialsStore } from './radio/soundcloud-credentials.js'
import { sessionsRoutes } from './sessions/routes.js'
import type { SessionsStore } from './sessions/store.js'
import { healthRoutes } from './site/health.js'
import { notFoundRoutes } from './site/not-found.js'
import { oauthAppRoutes } from './oauth/app-routes.js'
import { mcpRoutes } from './mcp/routes.js'
import { collectToolRoutes } from './mcp/tools.js'
import { oauthRoutes } from './oauth/routes.js'
import type { OAuthStore } from './oauth/store.js'
import { configRoutes } from './site/runtime-config.js'

// What the routes use to handle requests: the database, the stores built on it, and the services the server talks to.
export type Dependencies = {
  db: Queryable
  admins: AdminsStore
  features: FeaturesStore
  // Null when the server can't send emails, e.g. in development, where MAIL_DOMAIN isn't set.
  sendEmail: SendEmail | null
  // Where the site is, e.g. for the links in emails.
  siteOrigin: string
  // Which deployment the server is, e.g. "production" (see config.environment).
  environment: string
  // Builds a client for SoundCloud that uses the credentials it's given.
  soundcloud: (credentials: SoundCloudCredentials) => SoundCloudClient
  soundCloudCredentials: SoundCloudCredentialsStore
  onAir: OnAirStore
  radioSettings: RadioSettingsStore
  artists: ArtistsStore
  collectives: CollectivesStore
  // Artists' and collectives' photos.
  photos: Photos
  applications: ApplicationsStore
  applicationsSettings: ApplicationsSettingsStore
  apply: ApplyStore
  verifyTurnstile: TurnstileVerifier
  sessions: SessionsStore
  oauth: OAuthStore
}

// Registers every route of the server, other than the client's (see site/spa.ts). The routes only use `deps` to handle
// requests, so that generate-openapi.ts can register them without a database.
export async function registerRoutes(app: FastifyInstance, deps: Dependencies) {
  useZodSchemas(app)
  // Before the routes, which it collects as they're registered.
  const toolRoutes = collectToolRoutes(app)
  app.decorate('adminSessions', deps.admins)
  await app.register(fastifyCookie)
  await app.register(healthRoutes, { db: deps.db })
  await app.register(configRoutes, { store: deps.features })
  await app.register(authRoutes, { db: deps.db })
  await app.register(adminRoutes, { store: deps.admins, sendEmail: deps.sendEmail, origin: deps.siteOrigin })
  await app.register(eventsRoutes)
  // The radio and sessions share it (see radio/soundcloud-app.ts).
  const soundcloud = soundCloudApp(deps.soundcloud, deps.soundCloudCredentials)
  await app.register(radioRoutes, { soundcloud, onAir: deps.onAir, settings: deps.radioSettings })
  await app.register(artistsRoutes, { store: deps.artists, photos: deps.photos })
  await app.register(collectivesRoutes, { store: deps.collectives, photos: deps.photos })
  await app.register(applicationsRoutes, { store: deps.applications, settings: deps.applicationsSettings })
  await app.register(applyRoutes, {
    store: deps.apply,
    photos: deps.photos,
    verifyTurnstile: deps.verifyTurnstile,
    settings: deps.applicationsSettings,
    sendEmail: deps.sendEmail,
  })
  await app.register(sessionsRoutes, { store: deps.sessions, resolveTrack: soundcloud.resolveTrack })
  await app.register(featuresRoutes, { store: deps.features })
  // The site is the authorization server's issuer.
  await app.register(oauthRoutes, { store: deps.oauth, issuer: deps.siteOrigin })
  await app.register(oauthAppRoutes, { store: deps.oauth, issuer: deps.siteOrigin })
  await app.register(mcpRoutes, { store: deps.oauth, issuer: deps.siteOrigin, routes: toolRoutes, environment: deps.environment })
  await app.register(notFoundRoutes, { prefix: '/api' })
  await app.register(notFoundRoutes, { prefix: '/mcp' })
  await app.register(notFoundRoutes, { prefix: '/.well-known' })
}
