import { buffer } from 'node:stream/consumers'
import { and, eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Queryable } from '../db/connection.js'
import { artists, collectives, sessions } from '../db/schema.js'
import { lockSessions } from '../sessions/store.js'
import type { StoredImage } from './backfill.js'
import { PHOTO_WIDTHS } from './sizes.js'
import type { PhotoWidth } from './sizes.js'
import { forgetPhoto, isContentKey } from './store.js'
import type { PhotoFolder, Photos } from './store.js'

// Photos and flyers used to be stored under a random key each. When the server starts, before the missing sizes are made
// (see backfill.ts), the photos and flyers it keeps under such a key are moved to the key made from their content (see
// `photoKey` in store.ts), one at a time, so that those that are the same are kept once, e.g. the flyers of the synth
// meetups, which were stored once per session (see "Private files" in docs/deployment.md). Once nothing is left to move
// in every deployment, this goes.

const FOLDERS: Record<StoredImage['of'], PhotoFolder> = { artist: 'artists', collective: 'collectives', session: 'sessions' }

// Moves the photos and flyers that `list` gives, those whose key isn't made from their content, once called, until
// `stopping()`. Every failure is logged, rather than thrown: the server goes on without them, and tries again the next
// time it starts.
export function contentKeysMigration(
  list: () => Promise<StoredImage[]>,
  db: Queryable,
  photos: Photos,
  log: FastifyBaseLogger,
) {
  const left = async () => (await list()).filter(({ key }) => !isContentKey(key))

  return async (stopping: () => boolean) => {
    try {
      const images = await left()
      log.info({ images: images.length }, 'Moving photos and flyers to keys made from their content')
      const counts = { moved: 0, changed: 0, missing: 0, failed: 0 }
      for (const image of images) {
        if (stopping()) {
          log.info(counts, 'Stopped moving photos and flyers to keys made from their content')
          return
        }
        const { of, id, key } = image
        try {
          const outcome = await move(db, photos, log, image)
          counts[outcome]++
          if (outcome === 'missing') {
            log.warn({ of, id, key }, 'A photo or flyer to move to a key made from its content is missing')
          }
        } catch (error) {
          counts.failed++
          log.error({ of, id, key, err: error }, 'Failed to move a photo or flyer to a key made from its content')
        }
      }
      log.info({ ...counts, left: (await left()).length }, 'Moved photos and flyers to keys made from their content')
    } catch (error) {
      log.error({ err: error }, 'Failed to move photos and flyers to keys made from their content')
    }
  }
}

// Moves the image to the key made from its content, with the sizes it has, rather than making them again, unless its
// row has another key by then, e.g. because an admin replaced it meanwhile, which it then keeps. Returns whether it was
// moved, whether its row had changed, or whether it's missing.
async function move(db: Queryable, photos: Photos, log: FastifyBaseLogger, image: StoredImage): Promise<'moved' | 'changed' | 'missing'> {
  const original = await photos.read(image.key)
  if (!original) return 'missing'
  const sizes = new Map<PhotoWidth, Buffer>()
  for (const width of PHOTO_WIDTHS) {
    const size = await photos.readSize(image.key, width)
    if (size) sizes.set(width, await buffer(size))
  }
  const photo = await photos.store({ body: await buffer(original), type: image.type, sizes }, FOLDERS[image.of])
  let moved: boolean
  try {
    moved = await db.transaction(async (tx) => {
      // It writes the session's row (see `lockSessions`).
      if (image.of === 'session') await lockSessions(tx)
      await photo.keep(tx)
      return switchKey(tx, image, photo.key)
    })
  } catch (error) {
    await forgetPhoto(photos, log, photo.key)
    throw error
  }
  // Once the transaction is over, which held the lock of the new key (see `Photos` in store.ts). The old key is only
  // deleted when the row was moved: otherwise, whoever changed it deleted it.
  await forgetPhoto(photos, log, moved ? image.key : photo.key)
  return moved ? 'moved' : 'changed'
}

// Gives the image's row the key `to`, only if it still has the image's key, without changing who changed it last, or
// when. Returns whether it did.
async function switchKey(tx: Queryable, { of, id, key }: StoredImage, to: string): Promise<boolean> {
  const switched =
    of === 'session'
      ? await tx
          .update(sessions)
          .set({ flyerKey: to })
          .where(and(eq(sessions.id, id), eq(sessions.flyerKey, key)))
          .returning({ id: sessions.id })
      : of === 'artist'
        ? await tx
            .update(artists)
            .set({ photoKey: to })
            .where(and(eq(artists.id, id), eq(artists.photoKey, key)))
            .returning({ id: artists.id })
        : await tx
            .update(collectives)
            .set({ photoKey: to })
            .where(and(eq(collectives.id, id), eq(collectives.photoKey, key)))
            .returning({ id: collectives.id })
  return switched.length > 0
}
