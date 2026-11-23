import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { calendarFeeds } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { calendarFeedsStore, LinkTaken } from './feeds.js'
import type { CalendarFeedsStore } from './feeds.js'

// The calendar feeds, as the database keeps them (see docs/design/server/calendar.md).

let database: TestDatabase
let store: CalendarFeedsStore

const feed = (name: string, link: string) => ({ name, kind: 'occupation' as const, link, createdBy: 'admin@example.com' })

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
    const second = await store.add({ ...feed('Second', 'https://example.com/2.ics'), kind: 'quiet-time' })
    expect(await store.list()).toEqual([first, second])
    expect(second).toMatchObject({ name: 'Second', kind: 'quiet-time', link: 'https://example.com/2.ics', createdBy: 'admin@example.com' })
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

  it('only keeps the kinds of feeds there are', async () => {
    await expect(database.db.execute(sql`insert into calendar_feeds (name, kind, link, created_by) values ('x', 'session', 'https://example.com/k.ics', 'a')`)).rejects.toThrow()
  })

  it('removes a feed, and gives its id, or null when there was none', async () => {
    const added = await store.add(feed('First', 'https://example.com/1.ics'))
    expect(await store.remove('not-a-uuid')).toBeNull()
    expect(await store.remove(added.id.toUpperCase())).toBe(added.id)
    expect(await store.remove(added.id)).toBeNull()
    expect(await store.list()).toEqual([])
  })
})
