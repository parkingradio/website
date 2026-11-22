import { createHash } from 'node:crypto'
import { and, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { Queryable } from '../db/connection.js'

// The keys that photos and flyers are stored under (see `Photos` in store.ts), and the names their public URLs are
// named after (see `publicSizes` in photo-form.ts).

// Where new photos are stored: artists' under `artists/`, collectives' under `collectives/`, and sessions' flyers under
// `sessions/`, so that each kind only shares its photos with its own (see `photoKey`). Otherwise, what's stored is the
// photo's key, which is read and deleted as it is, whatever folder it's in.
export type PhotoFolder = 'artists' | 'collectives' | 'sessions'

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// The extension of the keys of photos of that MIME type.
export function extensionOf(type: string): string {
  return EXTENSIONS[type] ?? 'bin'
}

// The key of `photo` in `folder`: the SHA-256 of its content, in hex, so that a photo that's the same, byte for byte,
// as one that's stored in that folder is stored once, with its sizes, however many have it (see `Photos` in store.ts).
export function photoKey({ body, type }: { body: Buffer; type: string }, folder: PhotoFolder): string {
  return `${folder}/${createHash('sha256').update(body).digest('hex')}.${extensionOf(type)}`
}

// The name of the photo with `key`, without its folder and its extension: the SHA-256 of its content, for a key that
// `photoKey` made. Its public URLs are named after it (see `publicSizes` in photo-form.ts).
export function photoName(key: string): string {
  const file = key.slice(key.lastIndexOf('/') + 1)
  const dot = file.lastIndexOf('.')
  return dot === -1 ? file : file.slice(0, dot)
}

// The key of the photo named `name` (see `photoName`) in `folder`, whatever its type, that `column` has in a row of its
// table where `where` holds, or null when there's none, e.g. the key that a public artist's `photoKey` has.
export async function keyNamed(db: Queryable, column: AnyPgColumn, folder: PhotoFolder, name: string, where: SQL): Promise<string | null> {
  const keys = Object.values(EXTENSIONS).map((extension) => `${folder}/${name}.${extension}`)
  const { rows } = await db.execute<{ key: string }>(
    sql`select ${column} as key from ${column.table} where ${and(inArray(column, keys), where)} limit 1`,
  )
  return rows[0]?.key ?? null
}
