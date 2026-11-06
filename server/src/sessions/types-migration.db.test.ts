import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrateDatabase } from '../db/migrate.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'

// The migration that gives sessions their types, 0009_session_types, on sessions as the migrations before it left them:
// each one gets the type and keeps the name that drizzle/0009_session_types.sql says.

describe('the migration 0009_session_types', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await testDatabase({ before: '0009_session_types' })
  })

  afterAll(async () => {
    await database?.drop()
  })

  it('gives each session a type from its takeover and its name, and keeps its name only when it is its own', async () => {
    const db = database.db as NodePgDatabase
    const { rows: added } = await db.execute<{ id: string; name: string }>(sql`
      insert into collectives (name, country, city, description, links, phone)
      values ('Saut de Clôture', '', '', '', '{}', ''), ('Les Sœurs Ondes', '', '', '', '{}', ''), ('COLLECTIF RYTHME NOCTURNE', '', '', '', '{}', '')
      returning id, name`)
    const collective = Object.fromEntries(added.map(({ id, name }) => [name, id]))
    // The name each session had, and its collective's name, if it had one, then the type and the name it gets.
    const cases: [string, string | null, string, string][] = [
      ['', 'Saut de Clôture', 'takeover', ''],
      ['SAUT DE CLÔTURE TAKEOVER', 'Saut de Clôture', 'takeover', ''],
      ['les sœurs ondes takeover', 'Les Sœurs Ondes', 'takeover', ''],
      ['LES SŒURS ONDES TAKEOVER', 'Les Sœurs Ondes', 'takeover', ''],
      ['VKT TAKEOVER', 'COLLECTIF RYTHME NOCTURNE', 'takeover', 'VKT TAKEOVER'],
      ['GUEST MIXES', 'Saut de Clôture', 'takeover', 'GUEST MIXES'],
      ['Guest Mixes', null, 'guest-mixes', ''],
      ['live performance', null, 'live-performance', ''],
      ['SYNTH MEETUPS', null, 'synth-meetup', ''],
      ['SYNTH MEETUP', null, 'other', 'SYNTH MEETUP'],
      ['T.I.T.S. TAKEOVER', null, 'other', 'T.I.T.S. TAKEOVER'],
      ['LISTENING PARTY', null, 'other', 'LISTENING PARTY'],
      ['', null, 'guest-mixes', ''],
    ]
    // Each one's RA event is its index, to read them back in order.
    for (const [i, [name, takeover]] of cases.entries()) {
      await db.execute(sql`
        insert into sessions (created_by, duration_minutes, name, takeover_id, ra_event_id)
        values ('seed', 60, ${name}, ${takeover && collective[takeover]}, ${String(i)})`)
    }

    await migrateDatabase(db)
    const { rows } = await db.execute<{ type: string; name: string }>(sql`select type, name from sessions order by ra_event_id::int`)
    expect(rows.map(({ type, name }) => [type, name])).toEqual(cases.map(([, , type, name]) => [type, name]))
  })
})
