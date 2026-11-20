import { createHash } from 'node:crypto'
import { and, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { Queryable } from '../db/connection.js'
import type { PhotoType } from './profile.js'

// The keys that photos and flyers are stored under (see `Photos` in store.ts), and the names their public URLs are
// named after (see `publicSizes` in photo-form.ts).

// Where photos are stored: artists' under `artists/`, collectives' under `collectives/`, and sessions' flyers under
// `sessions/`, so that each kind only shares its photos with its own (see `photoKey`), which the database checks (see
// `contentKey` in db/schema.ts).
export type PhotoFolder = 'artists' | 'collectives' | 'sessions'

// The extension of the keys of photos of each MIME type.
export const EXTENSIONS: Record<PhotoType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// Every extension a key can have, which the database checks (see `contentKey` in db/schema.ts).
export const KEY_EXTENSIONS = Object.values(EXTENSIONS)

// The key of `photo` in `folder`: the SHA-256 of its content, in hex, so that a photo that's the same, byte for byte,
// as one that's stored in that folder is stored once, with its sizes, however many have it (see "Private files" in
// docs/deployment.md).
export function photoKey({ body, type }: { body: Buffer; type: PhotoType }, folder: PhotoFolder): string {
  return `${folder}/${createHash('sha256').update(body).digest('hex')}.${EXTENSIONS[type]}`
}

// The name of the photo with `key`, without its folder and its extension: the SHA-256 of its content (see `photoKey`).
// Its public URLs are named after it (see `publicSizes` in photo-form.ts).
export function photoName(key: string): string {
  return key.slice(key.indexOf('/') + 1, key.lastIndexOf('.'))
}

// The key of the photo named `name` (see `photoName`) in `folder`, whatever its type, that `column` has in a row of its
// table where `where` holds, or null when there's none, e.g. the key that a public artist's `photoKey` has.
export async function keyNamed(db: Queryable, column: AnyPgColumn, folder: PhotoFolder, name: string, where: SQL): Promise<string | null> {
  const keys = KEY_EXTENSIONS.map((extension) => `${folder}/${name}.${extension}`)
  const { rows } = await db.execute<{ key: string }>(
    sql`select ${column} as key from ${column.table} where ${and(inArray(column, keys), where)} limit 1`,
  )
  return rows[0]?.key ?? null
}
