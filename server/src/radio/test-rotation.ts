import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { acceptSessions } from '../admins/test-sessions.js'
import { artistsRoutes } from '../artists/routes.js'
import { artistsStore } from '../artists/store.js'
import { NO_PHOTOS } from '../artists/test-photos.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsRoutes } from '../sessions/routes.js'
import { sessionsStore } from '../sessions/store.js'
import { rotationRoutes } from './rotation-routes.js'
import { rotationStore } from './rotation-store.js'
import type { SoundCloudApp } from './soundcloud-app.js'
import type { SoundCloudClient } from './soundcloud.js'
import { trackStreams } from './streams.js'
import { trackReads } from './track-reads.js'
import type { TrackReads } from './track-reads.js'

// For the tests of the rotation of sets against a real database (*.db.test.ts): a database of their own, and an app with
// the routes of the rotation, and those of sessions and artists, which its sets are added and changed through, and a fake
// SoundCloud, which reads tracks with `readTrack`. Each link is its own track, whose id is the link without its secret.

export type RotationTestApp = { database: TestDatabase; app: FastifyInstance; reads: TrackReads }

export async function rotationTestApp(readTrack: SoundCloudClient['readTrack']): Promise<RotationTestApp> {
  process.env.JWT_SECRET = 'test-secret'
  const database = await testDatabase()
  const app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  const resolveTrack = async (link: string) => `track:${link.replace(/\/s-[^/]+$/, '')}`
  await app.register(sessionsRoutes, { store: sessionsStore(database.db), photos: NO_PHOTOS, resolveTrack })
  await app.register(artistsRoutes, { store: artistsStore(database.db), photos: NO_PHOTOS })
  const client = { readTrack, hlsStream: async (trackId: string) => ({ url: `https://cdn.test/${encodeURIComponent(trackId)}.m3u8`, expiresAt: Date.now() + 7_200_000 }) }
  const soundcloud = { client: async () => client } as unknown as SoundCloudApp
  const store = rotationStore(database.db)
  const reads = trackReads({ store, soundcloud, log: app.log })
  await app.register(rotationRoutes, { soundcloud, store, reads, streams: trackStreams() })
  return { database, app, reads }
}

// Empties the database of sessions, artists and what was read of tracks, and the rotation, as it is at first.
export async function resetRotation({ database }: RotationTestApp) {
  await database.db.execute(sql`truncate sessions, artists, soundcloud_track_reads cascade`)
  await database.db.execute(
    sql`update radio_rotation set updated_by = null, updated_at = null, on_air_set_id = null, on_air_track_id = null, on_air_started_at = null, on_air_position = null`,
  )
}
