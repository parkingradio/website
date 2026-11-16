import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrateDatabase } from '../db/migrate.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { checkSessionsInvariants } from './test-invariants.js'

// The migration that puts sets in an order, 0014_ordered_sets, on sets as the migrations before it left them: each
// session's sets get the order the server gave them, by offset, those without one last, then by when they were added,
// whatever their status, and keep their durations (see drizzle/0014_ordered_sets.sql).

describe('the migration 0014_ordered_sets', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await testDatabase({ before: '0014_ordered_sets' })
  })

  afterAll(async () => {
    await database?.drop()
  })

  it("orders each session's sets by offset, those without one last, then by when they were added, and keeps their durations", async () => {
    const db = database.db as NodePgDatabase
    const session = async (name: string) =>
      (await db.execute<{ id: string }>(sql`insert into sessions (created_by, duration_minutes, type, name) values ('seed', 240, 'other', ${name}) returning id`)).rows[0].id
    const [evening, other] = [await session('SOIRÉE'), await session('AUTRE')]
    await session('SANS SETS')
    // Each set's session, offset, duration, status and when it was added, by its name, which is its YouTube video's.
    const sets: [name: string, session: string, offset: number | null, duration: number | null, status: string, createdAt: string][] = [
      ['unplaced-late', evening, null, null, 'planned', '2026-10-03T00:00:00Z'],
      ['second', evening, 60, 90, 'planned', '2026-10-01T00:00:00Z'],
      // At the same offset as the one it replaced, which was added before it.
      ['replacement', evening, 0, 60, 'planned', '2026-10-02T00:00:00Z'],
      ['cancelled', evening, 0, 60, 'cancelled', '2026-10-01T00:00:00Z'],
      ['unplaced-early', evening, null, 30, 'done', '2026-10-01T00:00:00Z'],
      ['last', evening, 200, 60, 'planned', '2026-09-01T00:00:00Z'],
      ['only', other, 30, 60, 'planned', '2026-10-01T00:00:00Z'],
    ]
    for (const [name, sessionId, offset, duration, status, createdAt] of sets) {
      await db.execute(sql`
        insert into sets (session_id, offset_minutes, duration_minutes, status, created_at, created_by, performance_types, other_performance_type, genres, youtube_video_id)
        values (${sessionId}, ${offset}, ${duration}, ${status}, ${createdAt}, 'seed', '{}', '', '{}', ${name})`)
    }

    await migrateDatabase(db)
    const { rows } = await db.execute<{ name: string; session: string; position: number; duration: number | null; status: string }>(sql`
      select youtube_video_id as name, session_id as session, position, duration_minutes as duration, status from sets order by session_id = ${evening} desc, position`)
    expect(rows.map(({ name, session, position, duration, status }) => [name, session, position, duration, status])).toEqual([
      ['cancelled', evening, 0, 60, 'cancelled'],
      ['replacement', evening, 1, 60, 'planned'],
      ['second', evening, 2, 90, 'planned'],
      ['last', evening, 3, 60, 'planned'],
      ['unplaced-early', evening, 4, 30, 'done'],
      ['unplaced-late', evening, 5, null, 'planned'],
      ['only', other, 0, 60, 'planned'],
    ])
    const { rows: columns } = await db.execute<{ column_name: string }>(sql`select column_name from information_schema.columns where table_name = 'sets' and column_name = 'offset_minutes'`)
    expect(columns).toEqual([])
    await checkSessionsInvariants(db)

    // Each position is once in its session, from 0, and is always there.
    await expect(db.execute(sql`update sets set position = 0 where youtube_video_id = 'second'`)).rejects.toThrow()
    await expect(db.execute(sql`update sets set position = -1 where youtube_video_id = 'only'`)).rejects.toThrow()
    await expect(db.execute(sql`update sets set position = null where youtube_video_id = 'only'`)).rejects.toThrow()
    // But a single statement can shift them.
    await db.execute(sql`update sets set position = case when position = 0 then 5 else position - 1 end where session_id = ${evening}`)
    await checkSessionsInvariants(db)
  })
})
