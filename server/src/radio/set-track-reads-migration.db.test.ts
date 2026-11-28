import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { desc, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrateDatabase } from '../db/migrate.js'
import { setTrackReads } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'

// The migration that has what's read of a set's track go with the set, 0024_set_track_reads, on reads as the migrations
// before it left them: those through the link a set has are kept, as that set's, and the others are dropped (see
// drizzle/0024_set_track_reads.sql).

describe('the migration 0024_set_track_reads', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await testDatabase({ before: '0024_set_track_reads' })
  })

  afterAll(async () => {
    await database?.drop()
  })

  it("keeps the reads through the link a set has, as that set's, and drops the others", async () => {
    const db = database.db as NodePgDatabase
    const [{ id: session }] = (
      await db.execute<{ id: string }>(sql`insert into sessions (created_by, duration_minutes, type, name) values ('seed', 240, 'other', 'SOIRÉE') returning id`)
    ).rows
    // Each set's name, which is its YouTube video's, its track and its link, if it has one.
    const sets: [name: string, track: string | null, link: string | null][] = [
      ['public', '1', 'https://soundcloud.com/a/public'],
      ['private', '2', 'https://soundcloud.com/a/private/s-SeCrEt'],
      ['relinked', '3', 'https://soundcloud.com/a/new'],
      ['trackless', null, null],
    ]
    const ids: Record<string, string> = {}
    for (const [position, [name, track, link]] of sets.entries()) {
      const { rows } = await db.execute<{ id: string }>(sql`
        insert into sets (session_id, position, created_by, performance_types, other_performance_type, genres, youtube_video_id, soundcloud_track_id, soundcloud_track_url)
        values (${session}, ${position}, 'seed', '{}', '', '{}', ${name}, ${track}, ${link}) returning id`)
      ids[name] = rows[0].id
    }
    const readAt = new Date('2026-11-27T12:00:00Z')
    const failedAt = new Date('2026-11-27T12:30:00Z')
    // Each read's track, link, state, length, secret, and why its last read failed.
    const reads: [track: string, link: string, state: string | null, durationMs: number | null, secret: string | null, error: string | null][] = [
      ['1', 'https://soundcloud.com/a/public', 'playable', 3_600_000, null, "SoundCloud didn't answer in time"],
      ['2', 'https://soundcloud.com/a/private/s-SeCrEt', 'preview', 30_000, 's-SeCrEt', null],
      // Through the link its set had before.
      ['3', 'https://soundcloud.com/a/old/s-OlD', 'playable', 1_800_000, 's-OlD', null],
      // Of a set that was deleted.
      ['4', 'https://soundcloud.com/a/deleted/s-GoNe', 'playable', 1_800_000, 's-GoNe', null],
    ]
    for (const [track, link, state, durationMs, secret, error] of reads) {
      await db.execute(sql`
        insert into soundcloud_track_reads (track_id, link, state, duration_ms, secret_token, read_at, attempted_at, error)
        values (${track}, ${link}, ${state}, ${durationMs}, ${secret}, ${readAt.toISOString()}, ${failedAt.toISOString()}, ${error})`)
    }

    await migrateDatabase(db)
    expect(await db.select().from(setTrackReads).orderBy(desc(setTrackReads.durationMs))).toEqual([
      {
        setId: ids.public,
        link: 'https://soundcloud.com/a/public',
        state: 'playable',
        durationMs: 3_600_000,
        secretToken: null,
        readAt: readAt,
        attemptedAt: failedAt,
        error: "SoundCloud didn't answer in time",
      },
      {
        setId: ids.private,
        link: 'https://soundcloud.com/a/private/s-SeCrEt',
        state: 'preview',
        durationMs: 30_000,
        secretToken: 's-SeCrEt',
        readAt: readAt,
        attemptedAt: failedAt,
        error: null,
      },
    ])
    const { rows: tables } = await db.execute(sql`select table_name from information_schema.tables where table_name = 'soundcloud_track_reads'`)
    expect(tables).toEqual([])
  })
})
