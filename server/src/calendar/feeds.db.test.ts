import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { calendarFeeds } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { calendarFeedsStore, LinkTaken } from './feeds.js'
import type { CalendarFeedsStore } from './feeds.js'
import type { FeedKind } from './fields.js'

// The calendar feeds, as the database keeps them (see docs/design/server/calendar.md).

let database: TestDatabase
let store: CalendarFeedsStore

const feed = (name: string, link: string, kind: FeedKind = 'occupations') => ({ name, kind, link, createdBy: 'admin@example.com' })

beforeAll(async () => {
  database = await testDatabase()
  store = calendarFeedsStore(database.db)
})

afterAll(async () => {
  await database?.drop()
})

beforeEach(async () => {
  await database.db.delete(calendarFeeds)
})

describe('calendarFeedsStore', () => {
  it('lists the feeds in the order they were added, and finds them by their link', async () => {
    const first = await store.add(feed('First', 'https://example.com/1.ics'))
    const second = await store.add(feed('Second', 'https://example.com/2.ics', 'holds'))
    expect(await store.list()).toEqual([first, second])
    expect(first).toMatchObject({ name: 'First', kind: 'occupations' })
    expect(second).toMatchObject({ name: 'Second', kind: 'holds', link: 'https://example.com/2.ics', createdBy: 'admin@example.com' })
    expect(second).toMatchObject({ updatedBy: null, updatedAt: null })
    expect(await store.withLink('https://example.com/2.ics')).toEqual(second)
    expect(await store.withLink('https://example.com/3.ics')).toBeNull()
  })

  it('refuses a link that another feed has, even when both are added at once, naming that feed', async () => {
    const results = await Promise.allSettled([store.add(feed('One', 'https://example.com/x.ics')), store.add(feed('Two', 'https://example.com/x.ics'))])
    const added = results.filter((result) => result.status === 'fulfilled')
    const refused = results.filter((result) => result.status === 'rejected')
    expect(added).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0].reason).toBeInstanceOf(LinkTaken)
    expect((refused[0].reason as LinkTaken).feed).toMatchObject({ name: added[0].value.name })
    expect(await store.list()).toHaveLength(1)
  })

  it('gets a feed by its id, or null when there is none', async () => {
    const added = await store.add(feed('First', 'https://example.com/1.ics'))
    expect(await store.get(added.id.toUpperCase())).toEqual(added)
    expect(await store.get('not-a-uuid')).toBeNull()
    expect(await store.get('6f1c3c8e-1b7a-4c1e-9d3f-2a1b0c9d8e7f')).toBeNull()
  })

  it('changes the fields of a feed it is given, and says who changed it, and when', async () => {
    const added = await store.add(feed('First', 'https://example.com/1.ics'))
    const renamed = await store.update(added.id, { name: 'Renamed' }, 'other@example.com')
    expect(renamed).toEqual({ ...added, name: 'Renamed', updatedBy: 'other@example.com', updatedAt: expect.any(Date) })
    expect(renamed!.updatedAt!.getTime()).toBeGreaterThanOrEqual(added.createdAt.getTime())
    const changed = await store.update(added.id, { link: 'https://example.com/2.ics' }, 'admin@example.com')
    expect(changed).toMatchObject({ name: 'Renamed', kind: 'occupations', link: 'https://example.com/2.ics', updatedBy: 'admin@example.com' })
    const kind = await store.update(added.id, { kind: 'holds' }, 'admin@example.com')
    expect(kind).toMatchObject({ name: 'Renamed', kind: 'holds', link: 'https://example.com/2.ics' })
    expect(await store.list()).toEqual([kind])
    expect(await store.update('not-a-uuid', { name: 'x' }, 'admin@example.com')).toBeNull()
    expect(await store.update('6f1c3c8e-1b7a-4c1e-9d3f-2a1b0c9d8e7f', { name: 'x' }, 'admin@example.com')).toBeNull()
  })

  it("refuses to change a feed's link to another feed's, naming that feed", async () => {
    await store.add(feed('One', 'https://example.com/1.ics'))
    const two = await store.add(feed('Two', 'https://example.com/2.ics'))
    const error = await store.update(two.id, { link: 'https://example.com/1.ics' }, 'admin@example.com').catch((error: unknown) => error)
    expect(error).toBeInstanceOf(LinkTaken)
    expect((error as LinkTaken).feed).toMatchObject({ name: 'One' })
    expect(await store.get(two.id)).toEqual(two)
  })

  it('refuses a feed without a kind, or with another kind', async () => {
    const insert = (kind: string | null) =>
      database.db.execute(sql`insert into calendar_feeds (name, kind, link, created_by) values ('Bad', ${kind}, 'https://example.com/bad.ics', 'admin@example.com')`)
    await expect(insert(null)).rejects.toMatchObject({ cause: { code: '23502' } })
    await expect(insert('occupation')).rejects.toMatchObject({ cause: { constraint: 'calendar_feeds_kind' } })
    expect(await store.list()).toEqual([])
  })

  it('removes a feed, and gives its id, or null when there was none', async () => {
    const added = await store.add(feed('First', 'https://example.com/1.ics'))
    expect(await store.remove('not-a-uuid')).toBeNull()
    expect(await store.remove(added.id.toUpperCase())).toBe(added.id)
    expect(await store.remove(added.id)).toBeNull()
    expect(await store.list()).toEqual([])
  })
})
