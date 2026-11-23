import { asc, eq } from 'drizzle-orm'
import { violatesConstraint } from '../api/errors.js'
import type { Queryable } from '../db/connection.js'
import { calendarFeeds } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import type { FeedKind } from './fields.js'

// The calendar feeds that admins added (see docs/design/server/calendar.md). What's read from them is kept in memory
// (see reads.ts).

export type StoredFeed = {
  id: string
  name: string
  kind: FeedKind
  // A secret, which is never sent back (see "Feeds" in docs/design/server/calendar.md).
  link: string
  createdBy: string
  createdAt: Date
}

export type NewFeed = Pick<StoredFeed, 'name' | 'kind' | 'link' | 'createdBy'>

// Another feed has the link of a feed being added: `feed`, when it's known.
export class LinkTaken extends Error {
  constructor(readonly feed: Pick<StoredFeed, 'name'> | null) {
    super('Another feed has this link')
  }
}

export type CalendarFeedsStore = {
  // Every feed, in the order they were added.
  list(): Promise<StoredFeed[]>
  // The feed with `link`, if any.
  withLink(link: string): Promise<StoredFeed | null>
  // Adds a feed. Throws a LinkTaken when another feed has its link.
  add(feed: NewFeed): Promise<StoredFeed>
  // Removes a feed, and returns its id as it's kept, or null when there's no such feed.
  remove(id: string): Promise<string | null>
}

export function calendarFeedsStore(db: Queryable): CalendarFeedsStore {
  const withLink = async (link: string) => (await db.select().from(calendarFeeds).where(eq(calendarFeeds.link, link)))[0] ?? null

  return {
    list: () => db.select().from(calendarFeeds).orderBy(asc(calendarFeeds.createdAt), asc(calendarFeeds.id)),

    withLink,

    async add(feed) {
      try {
        const [added] = await db.insert(calendarFeeds).values(feed).returning()
        return added
      } catch (error) {
        // A feed with the same link was added meanwhile.
        if (violatesConstraint(error, 'calendar_feeds_link_idx')) throw new LinkTaken(await withLink(feed.link))
        throw error
      }
    },

    async remove(id) {
      if (!isUuid(id)) return null
      const [removed] = await db.delete(calendarFeeds).where(eq(calendarFeeds.id, id)).returning({ id: calendarFeeds.id })
      return removed?.id ?? null
    },
  }
}
