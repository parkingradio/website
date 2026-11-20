import { isNotNull, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { PrivateFiles } from '../core/private-bucket.js'
import type { Queryable } from '../db/connection.js'
import { artists, collectives, sessions } from '../db/schema.js'
import { UnreadablePhoto } from './sizes.js'
import { completeSizes } from './store.js'
import type { Photos } from './store.js'

// The sizes of photos and flyers are made when they're sent (see `withSizes` in store.ts). Those that the photos and
// flyers the server keeps don't have, e.g. those sent before there were sizes, or of a width added since, are made when
// the server starts, in the background, one photo at a time, so that it only takes the memory of one (see "Photos" in
// docs/design/server/artists.md).

// A photo or a flyer that the server keeps: what it's of, its id, its key and its MIME type.
export type StoredImage = { of: 'artist' | 'collective' | 'session'; id: string; key: string; type: string }

// Every photo and flyer the server keeps, sessions' flyers first, the latest first, since Programmation shows them.
export async function storedImages(db: Queryable): Promise<StoredImage[]> {
  const flyers = await db
    .select({ id: sessions.id, key: sessions.flyerKey, type: sessions.flyerType })
    .from(sessions)
    .where(isNotNull(sessions.flyerKey))
    .orderBy(sql`${sessions.startAt} desc nulls last`)
  const artistPhotos = await db
    .select({ id: artists.id, key: artists.photoKey, type: artists.photoType })
    .from(artists)
    .where(isNotNull(artists.photoKey))
  const collectivePhotos = await db
    .select({ id: collectives.id, key: collectives.photoKey, type: collectives.photoType })
    .from(collectives)
    .where(isNotNull(collectives.photoKey))
  // Both are there, or neither, which the database checks.
  const of = (what: StoredImage['of']) => (row: { id: string; key: string | null; type: string | null }) => ({
    of: what,
    id: row.id,
    key: row.key!,
    type: row.type!,
  })
  return [...flyers.map(of('session')), ...artistPhotos.map(of('artist')), ...collectivePhotos.map(of('collective'))]
}

// Makes the sizes that the photos and flyers `list` gives don't have, once started, one after another, once `first` is
// done, e.g. moving them to the keys they're kept under (see artists/content-keys.ts), unless it stopped. Every failure is
// logged, rather than thrown, `first`'s too: the server goes on without them, and tries again the next time it starts.
export function sizesBackfill(
  list: () => Promise<StoredImage[]>,
  files: PrivateFiles,
  photos: Pick<Photos, 'deleteUnused'>,
  log: FastifyBaseLogger,
  first: (stopping: () => boolean) => Promise<void> = async () => {},
) {
  let stopping = false
  let running: Promise<void> = Promise.resolve()

  async function run() {
    await first(() => stopping)
    if (stopping) return
    const images = await list()
    log.info({ images: images.length }, 'Making the missing sizes of photos and flyers')
    const counts = { complete: 0, made: 0, missing: 0, unreadable: 0, failed: 0 }
    for (const { of, id, key } of images) {
      if (stopping) {
        log.info(counts, 'Stopped making the missing sizes of photos and flyers')
        return
      }
      try {
        const outcome = await completeSizes(files, photos, key, log)
        counts[outcome]++
        if (outcome === 'missing') {
          // Unless it was deleted or replaced meanwhile, it's lost: the public endpoints, which only read sizes, can't tell.
          log.warn({ of, id, key }, 'A photo or flyer whose sizes were missing is missing too, e.g. because it was deleted or replaced meanwhile')
        }
      } catch (error) {
        if (error instanceof UnreadablePhoto) {
          counts.unreadable++
          log.warn({ of, id, key, err: error.cause }, "Can't make the sizes of a photo or flyer: it can't be read")
        } else {
          counts.failed++
          log.error({ of, id, key, err: error }, 'Failed to make the sizes of a photo or flyer')
        }
      }
    }
    log.info(counts, 'Made the missing sizes of photos and flyers')
  }

  return {
    start() {
      running = run().catch((error: unknown) => {
        log.error({ err: error }, 'Failed to make the missing sizes of photos and flyers')
      })
    },
    // Stops before the next photo, once the one being made, or moved, is.
    stop() {
      stopping = true
    },
    // Once it's stopped, or done.
    stopped: () => running,
  }
}
