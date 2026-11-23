import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { sessions } from '../db/schema.js'
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
  await database.db.execute(sql`truncate sessions cascade`)
})

// Times as hours after a base instant.
const at = (hours: number) => new Date(Date.UTC(2026, 10, 23) + hours * 3_600_000)

// Adds a session named `name`, which starts at `start`, or has no start, and lasts `hours`.
async function add(name: string, start: number | null, hours: number, status: Status = 'planned') {
  const startAt = start === null ? null : at(start)
  await database.db.insert(sessions).values({ createdBy: 'admin@example.com', startAt, durationMinutes: hours * 60, type: 'other', name, status })
}

async function names(range: [number, number], window: [number, number]) {
  const found = await sessionsStore(database.db).forCalendar({ from: at(range[0]), to: at(range[1]) }, { from: at(window[0]), to: at(window[1]) })
  return found.map(({ name }) => name).sort()
}

describe('forCalendar', () => {
  it('gives the sessions that take some of the range, whatever their status, but not those that only touch it', async () => {
    await add('ends at its start', 7, 3)
    await add('starts at its end', 20, 1)
    await add('across it', 5, 20, 'cancelled')
    await add('in it', 12, 1, 'done')
    await add('across its start', 9, 2, 'cancelled')
    // The window is elsewhere, and has none of them.
    expect(await names([10, 20], [100, 200])).toEqual(['across it', 'across its start', 'in it'])
  })

  it("gives those of the window that aren't cancelled, and those without a start that aren't cancelled", async () => {
    await add('in the window', 102, 1)
    await add('cancelled in the window', 104, 1, 'cancelled')
    await add('across its end', 190, 20, 'done')
    await add('before the window', 50, 50)
    await add('without a start', null, 1)
    await add('cancelled without a start', null, 1, 'cancelled')
    expect(await names([0, 10], [100, 200])).toEqual(['across its end', 'in the window', 'without a start'])
  })

  it('gives each session once, with its sets', async () => {
    await add('in both', 105, 1)
    const found = await sessionsStore(database.db).forCalendar({ from: at(100), to: at(110) }, { from: at(100), to: at(200) })
    expect(found.map(({ name, sets }) => [name, sets])).toEqual([['in both', []]])
  })
})
