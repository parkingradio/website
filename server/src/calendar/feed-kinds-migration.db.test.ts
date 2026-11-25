import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrateDatabase } from '../db/migrate.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'

// The migration that gives calendar feeds a kind, 0022_calendar_feed_kinds, on feeds as the migrations before it left
// them: every one becomes "occupations", and the column keeps no default, since the API has none.

describe('the migration 0022_calendar_feed_kinds', () => {
  let database: TestDatabase | undefined

  afterEach(async () => {
    await database?.drop()
    database = undefined
  })

  it('makes every existing feed an occupations feed, and then takes no feed without a kind, or with another kind', async () => {
    database = await testDatabase({ before: '0022_calendar_feed_kinds' })
    const db = database.db as NodePgDatabase
    await db.execute(sql`insert into calendar_feeds (name, link, created_by)
      values ('Équipe', 'https://example.com/team.ics', 'admin@example.com'), ('Séjours', 'https://example.com/stays.ics', 'admin@example.com')`)
    await migrateDatabase(db)

    const { rows } = await db.execute<{ name: string; kind: string }>(sql`select name, kind from calendar_feeds`)
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        { name: 'Équipe', kind: 'occupations' },
        { name: 'Séjours', kind: 'occupations' },
      ]),
    )
    const insert = (kind: string | null) =>
      kind === null
        ? db.execute(sql`insert into calendar_feeds (name, link, created_by) values ('New', 'https://example.com/new.ics', 'admin@example.com')`)
        : db.execute(sql`insert into calendar_feeds (name, kind, link, created_by) values ('New', ${kind}, 'https://example.com/new.ics', 'admin@example.com')`)
    await expect(insert(null)).rejects.toMatchObject({ cause: { code: '23502' } })
    await expect(insert('occupation')).rejects.toMatchObject({ cause: { constraint: 'calendar_feeds_kind' } })
    await insert('holds')
  })
})
