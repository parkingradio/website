import { asc, eq } from 'drizzle-orm'
import { violatesConstraint } from '../api/errors.js'
import type { Queryable } from '../db/connection.js'
import { calendarFeeds } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'

// The calendar feeds that admins added (see docs/design/server/calendar.md). What's read from them is kept in memory
// (see reads.ts).

export type StoredFeed = {
  id: string
  name: string
  // A secret, which only the admin pages show (see "Feeds" in docs/design/server/calendar.md).
  link: string
  privateTitles: boolean
  createdBy: string
  createdAt: Date
  updatedBy: string | null
  updatedAt: Date | null
}

export type NewFeed = Pick<StoredFeed, 'name' | 'link' | 'privateTitles' | 'createdBy'>
export type FeedChanges = Partial<Pick<StoredFeed, 'name' | 'link' | 'privateTitles'>>

// Another feed has the link of a feed being added or changed: `feed`, when it's known.
export class LinkTaken extends Error {
  constructor(readonly feed: Pick<StoredFeed, 'name'> | null) {
    super('Another feed has this link')
  }
}

export type CalendarFeedsStore = {
  // Every feed, in the order they were added.
  list(): Promise<StoredFeed[]>
  // The feed `id`, or null when there's no such feed.
  get(id: string): Promise<StoredFeed | null>
  // The feed with `link`, if any.
  withLink(link: string): Promise<StoredFeed | null>
  // Adds a feed. Throws a LinkTaken when another feed has its link.
  add(feed: NewFeed): Promise<StoredFeed>
  // Changes a feed, as `by` (an admin's email), and returns it as it is then, or null when there's no such feed. Throws a
  // LinkTaken when another feed has its new link.
  update(id: string, changes: FeedChanges, by: string): Promise<StoredFeed | null>
  // Removes a feed, and returns its id as it's kept, or null when there's no such feed.
  remove(id: string): Promise<string | null>
}

export function calendarFeedsStore(db: Queryable): CalendarFeedsStore {
  const withLink = async (link: string) => (await db.select().from(calendarFeeds).where(eq(calendarFeeds.link, link)))[0] ?? null
  // A LinkTaken for `link`, when `error` is that another feed has it, which it took meanwhile.
  const linkTaken = async (error: unknown, link: string | undefined) =>
    link !== undefined && violatesConstraint(error, 'calendar_feeds_link_idx') ? new LinkTaken(await withLink(link)) : error

  return {
    list: () => db.select().from(calendarFeeds).orderBy(asc(calendarFeeds.createdAt), asc(calendarFeeds.id)),

    async get(id) {
      if (!isUuid(id)) return null
      return (await db.select().from(calendarFeeds).where(eq(calendarFeeds.id, id)))[0] ?? null
    },

    withLink,

    async add(feed) {
      try {
        const [added] = await db.insert(calendarFeeds).values(feed).returning()
        return added
      } catch (error) {
        throw await linkTaken(error, feed.link)
      }
    },

    async update(id, changes, by) {
      if (!isUuid(id)) return null
      try {
        const [updated] = await db
          .update(calendarFeeds)
          .set({ ...changes, updatedBy: by, updatedAt: new Date() })
          .where(eq(calendarFeeds.id, id))
          .returning()
        return updated ?? null
      } catch (error) {
        throw await linkTaken(error, changes.link)
      }
    },

    async remove(id) {
      if (!isUuid(id)) return null
      const [removed] = await db.delete(calendarFeeds).where(eq(calendarFeeds.id, id)).returning({ id: calendarFeeds.id })
      return removed?.id ?? null
    },
  }
}
