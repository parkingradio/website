import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrateDatabase } from '../db/migrate.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'

// The migration that checks that every photo's and flyer's key is made from its content, in the folder of its kind,
// 0017_content_keys: it fails, applying nothing, while a row has another key, e.g. one from before keys were made from
// their content, or a collective's photo under `artists/`, from when it was an artist.

const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const UUID = '0b8a5f0e-3c4d-4e5f-8a9b-0c1d2e3f4a5b'

describe('the migration 0017_content_keys', () => {
  let database: TestDatabase | undefined

  afterEach(async () => {
    await database?.drop()
    database = undefined
  })

  // A database before the migration, with an artist, a collective and a session, which have these keys, or none.
  async function withKeys(keys: { artist?: string; collective?: string; session?: string }) {
    database = await testDatabase({ before: '0017_content_keys' })
    const db = database.db as NodePgDatabase
    // The database only checks that there's a type when there's a key.
    const type = (key: string | undefined) => (key === undefined ? null : 'image/jpeg')
    await db.execute(sql`
      insert into artists (name, country, city, genres, bio, links, phone, photo_key, photo_type)
      values ('Aurore', '', '', '{}', '', '{}', '', ${keys.artist ?? null}, ${type(keys.artist)})`)
    await db.execute(sql`
      insert into collectives (name, country, city, description, links, phone, photo_key, photo_type)
      values ('Les Ondes', '', '', '', '{}', '', ${keys.collective ?? null}, ${type(keys.collective)})`)
    await db.execute(sql`
      insert into sessions (created_by, duration_minutes, name, type, flyer_key, flyer_type)
      values ('admin@example.com', 60, 'SOIRÉE', 'other', ${keys.session ?? null}, ${type(keys.session)})`)
    return db
  }

  async function applied(db: NodePgDatabase) {
    const { rows } = await db.execute<{ applied: boolean }>(sql`select exists (select from pg_constraint where conname = 'artists_photo_key') as applied`)
    return rows[0].applied
  }

  it('applies when every key is made from its content, in the folder of its kind, and refuses any other key afterwards', async () => {
    const db = await withKeys({ artist: `artists/${HASH}.jpg`, collective: `collectives/${HASH}.png`, session: `sessions/${HASH}.webp` })
    await migrateDatabase(db)
    expect(await applied(db)).toBe(true)
    const refused = async (table: string, column: string, key: string, constraint: string) => {
      const update = sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${key}`
      await expect(db.execute(update), key).rejects.toMatchObject({ cause: { constraint } })
    }
    for (const key of [`collectives/${HASH}.jpg`, `artists/${HASH.toUpperCase()}.jpg`, `artists/${HASH}.gif`, `artists/${HASH.slice(1)}.jpg`, `artists/${UUID}.jpg`]) {
      await refused('artists', 'photo_key', key, 'artists_photo_key')
    }
    await refused('collectives', 'photo_key', `artists/${HASH}.jpg`, 'collectives_photo_key')
    await refused('sessions', 'flyer_key', `sessions/${HASH}.jpg.w320.webp`, 'sessions_flyer_key')
  })

  it('applies when there are no photos or flyers', async () => {
    const db = await withKeys({})
    await migrateDatabase(db)
    expect(await applied(db)).toBe(true)
  })

  it.each([
    ['an artist whose photo is under a random key', { artist: `artists/${UUID}.jpg` }, 'artists_photo_key'],
    ["a collective whose photo is under `artists/`, from when it was an artist", { collective: `artists/${HASH}.jpg` }, 'collectives_photo_key'],
    ['a session whose flyer is under a random key', { session: `sessions/${UUID}.png` }, 'sessions_flyer_key'],
  ])('fails, applying nothing, with %s', async (_, keys, constraint) => {
    const db = await withKeys(keys)
    await expect(migrateDatabase(db)).rejects.toMatchObject({ cause: { constraint } })
    expect(await applied(db)).toBe(false)
  })
})
