import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrateDatabase } from '../db/migrate.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'

// The migration that only keeps what admins decided about applications, 0016_application_decisions, on applications as
// the migrations before it left them: "scheduled" and "done" become "accepted", the status's columns become the
// decision's, status_updated_by and status_updated_at included, and it fails rather than leave a rejected application
// with a set or a session that's planned or done.

describe('the migration 0016_application_decisions', () => {
  let database: TestDatabase | undefined

  afterEach(async () => {
    await database?.drop()
    database = undefined
  })

  // A database before the migration, with an artist, and an application of theirs with each of `statuses`, in order.
  async function withApplications(statuses: string[]): Promise<{ db: NodePgDatabase; artist: string; ids: string[] }> {
    database = await testDatabase({ before: '0016_application_decisions' })
    const db = database.db as NodePgDatabase
    const { rows } = await db.execute<{ id: string }>(sql`insert into artists (name, country, city, genres, bio, links, phone) values ('Aurore', '', '', '{}', '', '{}', '') returning id`)
    const artist = rows[0].id
    const ids: string[] = []
    for (const status of statuses) {
      const { rows: added } = await db.execute<{ id: string }>(sql`
        insert into applications (artist_id, dates, time_slots, performance_types, other_performance_type, details, status, status_updated_by, status_updated_at)
        values (${artist}, '{2026-11-14}', '[]', '{}', '', '', ${status}, 'admin@example.com', '2026-11-01T12:00:00Z') returning id`)
      ids.push(added[0].id)
    }
    return { db, artist, ids }
  }

  it("keeps what admins decided, makes scheduled and done applications accepted, and renames the status's columns to the decision's", async () => {
    const statuses = ['new', 'accepted', 'scheduled', 'done', 'rejected']
    const { db, ids } = await withApplications(statuses)
    await migrateDatabase(db)
    const { rows } = await db.execute<{ id: string; decision: string; by: string; at: boolean }>(
      sql`select id, decision, decision_updated_by as by, decision_updated_at = '2026-11-01T12:00:00Z' as at from applications`,
    )
    const migrated = new Map(rows.map(({ id, ...row }) => [id, row]))
    expect(ids.map((id) => migrated.get(id)?.decision)).toEqual(['new', 'accepted', 'accepted', 'accepted', 'rejected'])
    for (const id of ids) expect(migrated.get(id)).toMatchObject({ by: 'admin@example.com', at: true })
    await expect(db.execute(sql`update applications set decision = 'done'`)).rejects.toMatchObject({ cause: { constraint: 'applications_decision' } })
  })

  it('fails while a rejected application has a set or a session that is planned or done, and not when they are cancelled', async () => {
    const { db, artist, ids } = await withApplications(['rejected'])
    const { rows } = await db.execute<{ id: string }>(sql`
      insert into sessions (created_by, duration_minutes, name, type, status) values ('seed', 60, 'SOIRÉE', 'other', 'done') returning id`)
    const { rows: added } = await db.execute<{ id: string }>(sql`
      insert into sets (session_id, position, created_by, performance_types, other_performance_type, genres, application_id, status)
      values (${rows[0].id}, 0, 'seed', '{}', '', '{}', ${ids[0]}, 'done') returning id`)
    await db.execute(sql`insert into set_performers (set_id, artist_id, position) values (${added[0].id}, ${artist}, 0)`)
    const failed = await migrateDatabase(db).then(() => null, (error: Error) => error)
    expect(failed?.cause ?? failed).toMatchObject({ message: "A rejected application has a set or a session that's planned or done" })

    await db.execute(sql`update sessions set status = 'cancelled'`)
    await db.execute(sql`update sets set status = 'cancelled'`)
    await migrateDatabase(db)
    const { rows: migrated } = await db.execute<{ decision: string }>(sql`select decision from applications`)
    expect(migrated).toEqual([{ decision: 'rejected' }])
  })
})
