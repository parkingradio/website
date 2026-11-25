import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { Conflict, HAS_RA_EVENT, sessionsStore } from './store.js'
import type { SessionsStore } from './store.js'

// Saving a session's event on RA as the bookmarklet does, with a token for publishing it, against a real database: only
// while the session has none (see docs/design/server/ra-publication.md).

let database: TestDatabase
let store: SessionsStore

async function createSession(raEventId: string | null = null): Promise<string> {
  const session = await store.create(
    {
      startAt: new Date('2026-11-15T02:00:00Z'),
      durationMinutes: 120,
      type: 'guest-mixes',
      name: '',
      takeoverId: null,
      applicationId: null,
      raEventId,
      description: '',
      flyer: null,
      createdBy: 'creator@example.com',
    },
    [],
  )
  return session.id
}

const by = (raEventId: string) => ({ raEventId, updatedBy: 'publisher@example.com', updatedAt: new Date('2026-11-01T12:00:00Z') })

beforeAll(async () => {
  database = await testDatabase()
  store = sessionsStore(database.db)
})

afterAll(async () => {
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions cascade`)
})

describe('setRaEvent', () => {
  it("sets the session's event on RA, as a change to the session, and leaves the rest as it is", async () => {
    const id = await createSession()
    const before = (await store.get(id))!
    const changed = { raEventId: '2400123', updatedBy: 'publisher@example.com', updatedAt: new Date('2026-11-01T12:00:00Z') }
    expect(await store.setRaEvent(id, by('2400123'))).toMatchObject({ id, ...changed })
    expect(await store.get(id)).toEqual({ ...before, ...changed })
  })

  it('refuses when the session already has one, even the same, without a session in the way', async () => {
    const id = await createSession('2400123')
    for (const raEventId of ['2400124', '2400123']) {
      const error = await store.setRaEvent(id, by(raEventId)).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Conflict)
      expect(error).toMatchObject({ message: HAS_RA_EVENT, session: null, set: null })
    }
    expect(await store.get(id)).toMatchObject({ raEventId: '2400123', updatedBy: null, updatedAt: null })
  })

  it('sets it once when it is sent twice at the same time', async () => {
    const id = await createSession()
    const results = await Promise.allSettled([store.setRaEvent(id, by('2400123')), store.setRaEvent(id, by('2400124'))])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const [refused] = results.filter((result) => result.status === 'rejected')
    expect(refused.reason).toBeInstanceOf(Conflict)
  })

  it("gives null when there's no such session", async () => {
    expect(await store.setRaEvent('6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b', by('2400123'))).toBeNull()
    expect(await store.setRaEvent('not-a-uuid', by('2400123'))).toBeNull()
  })
})
