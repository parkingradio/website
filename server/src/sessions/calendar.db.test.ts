import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { artists, sessions, setPerformers, sets } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import type { Status } from './fields.js'
import { sessionsStore } from './store.js'

// The sessions the calendar needs, against a real database (see "The calendar" in docs/design/server/calendar.md).

let database: TestDatabase

beforeAll(async () => {
  database = await testDatabase()
})

afterAll(async () => {
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions, artists cascade`)
})

// Times as hours after a base instant.
const at = (hours: number) => new Date(Date.UTC(2026, 10, 23) + hours * 3_600_000)

// Adds a session named `name`, which starts at `start`, or has no start, and lasts `hours`, and returns its id.
async function add(name: string, start: number | null, hours: number, status: Status = 'planned'): Promise<string> {
  const startAt = start === null ? null : at(start)
  const [{ id }] = await database.db
    .insert(sessions)
    .values({ createdBy: 'admin@example.com', startAt, durationMinutes: hours * 60, type: 'other', name, status })
    .returning({ id: sessions.id })
  return id
}

// Gives the session `sessionId` a set of an hour, played by a new artist, `performer`.
async function addSet(sessionId: string, performer: string) {
  const [artist] = await database.db
    .insert(artists)
    .values({ name: performer, country: '', city: '', genres: [], bio: '', links: {}, phone: '' })
    .returning({ id: artists.id })
  const [set] = await database.db
    .insert(sets)
    .values({ createdBy: 'admin@example.com', sessionId, position: 0, durationMinutes: 60, performanceTypes: [], otherPerformanceType: '', genres: [] })
    .returning({ id: sets.id })
  await database.db.insert(setPerformers).values({ setId: set.id, artistId: artist.id, position: 0 })
}

// The names of the sessions the calendar gives in full, and of the others it counts.
async function names(range: [number, number], window: [number, number]) {
  const { given, others } = await sessionsStore(database.db).forCalendar({ from: at(range[0]), to: at(range[1]) }, { from: at(window[0]), to: at(window[1]) })
  return { given: given.map(({ name }) => name).sort(), others: others.map(({ name }) => name).sort() }
}

describe('forCalendar', () => {
  it('gives the sessions that take some of the range, whatever their status, but not those that only touch it', async () => {
    await add('ends at its start', 7, 3)
    await add('starts at its end', 20, 1)
    await add('across it', 5, 20, 'cancelled')
    await add('in it', 12, 1, 'done')
    await add('across its start', 9, 2, 'cancelled')
    // The window is elsewhere, and has none of them.
    expect(await names([10, 20], [100, 200])).toEqual({ given: ['across it', 'across its start', 'in it'], others: [] })
  })

  it("gives those of the window that aren't cancelled, and those without a start that aren't cancelled", async () => {
    await add('in the window', 102, 1)
    await add('cancelled in the window', 104, 1, 'cancelled')
    await add('across its end', 190, 20, 'done')
    await add('before the window', 50, 50)
    await add('without a start', null, 1)
    await add('cancelled without a start', null, 1, 'cancelled')
    expect(await names([0, 10], [100, 200])).toEqual({ given: ['without a start'], others: ['across its end', 'in the window'] })
  })

  it('gives each session once, with its sets when it takes some of the range or has no start, and without them otherwise', async () => {
    for (const [name, start] of [['in both', 105], ['only in the window', 150], ['without a start', null]] as const) {
      await addSet(await add(name, start, 1), `Artist ${name}`)
    }
    const { given, others } = await sessionsStore(database.db).forCalendar({ from: at(100), to: at(110) }, { from: at(100), to: at(200) })
    const performers = (name: string) => given.find((session) => session.name === name)!.sets.map(({ performers }) => performers.map(({ name }) => name))
    expect(given.map(({ name }) => name).sort()).toEqual(['in both', 'without a start'])
    expect(performers('in both')).toEqual([['Artist in both']])
    expect(performers('without a start')).toEqual([['Artist without a start']])
    expect(others.map(({ name }) => name)).toEqual(['only in the window'])
    expect(others[0]).not.toHaveProperty('sets')
  })
})
