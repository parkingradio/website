import { asc, eq, inArray, sql } from 'drizzle-orm'
import { violatesConstraint } from '../api/errors.js'
import { EmailTaken, artistsStore } from '../artists/store.js'
import type { ArtistsStore, StoredPhoto } from '../artists/store.js'
import type { Reference } from '../api/schemas.js'
import type { Queryable } from '../db/connection.js'
import { artists, collectiveMembers, collectives } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'
import { COLLECTIVE_AS_MEMBER, NO_SUCH_MEMBER } from './profile.js'
import type { CollectiveProfile, SentMember } from './profile.js'

// Keeps collectives, and their members, in the database. Their photos are kept like artists' (see artists/store.ts).

// A collective, as the database keeps it, and with its members, in order.
export type CollectiveRow = typeof collectives.$inferSelect
export type StoredCollective = CollectiveRow & { members: Reference[] }

// Thrown when a collective's members can't be saved: its message, `NO_SUCH_MEMBER` or `COLLECTIVE_AS_MEMBER`, says why.
export class InvalidMember extends Error {}

// The collectives, as the admin pages manage them. Each method that's about one collective returns null when there's no
// such collective, which is the case of any id that isn't a UUID.
export type CollectivesStore = {
  // By name, whatever its case.
  list(): Promise<StoredCollective[]>
  get(id: string): Promise<StoredCollective | null>
  // `createdBy` is the email of the admin who adds the collective. The members sent by name are created, as artists
  // whom `createdBy` adds. Throws an EmailTaken or an InvalidMember.
  create(collective: CollectiveProfile & StoredPhoto & { createdBy: string }): Promise<StoredCollective>
  // Replaces the collective's profile and members, and its photo when there's a new one, or nulls to remove it. The
  // members sent by name are created, as artists whom `updatedBy` adds. Returns the collective as it was, so that a
  // photo that was replaced or removed can be deleted, and as it is then. Throws an EmailTaken or an InvalidMember.
  update(
    id: string,
    changes: CollectiveProfile & (StoredPhoto | Record<never, never>) & { updatedBy: string; updatedAt: Date },
  ): Promise<{ before: CollectiveRow; after: StoredCollective } | null>
  // Returns the collective as it was, so that its photo can be deleted too. Its members stay.
  delete(id: string): Promise<CollectiveRow | null>
}

// The members of each collective, in order, or only those of the collective with `collectiveId`.
async function membersOf(db: Queryable, collectiveId?: string): Promise<Map<string, Reference[]>> {
  const rows = await db
    .select({ collectiveId: collectiveMembers.collectiveId, id: artists.id, name: artists.name })
    .from(collectiveMembers)
    .innerJoin(artists, eq(artists.id, collectiveMembers.artistId))
    .where(collectiveId === undefined ? undefined : eq(collectiveMembers.collectiveId, collectiveId))
    .orderBy(asc(collectiveMembers.position))
  const found = new Map<string, Reference[]>()
  for (const { collectiveId, ...member } of rows) {
    if (!found.has(collectiveId)) found.set(collectiveId, [])
    found.get(collectiveId)!.push(member)
  }
  return found
}

async function withMembers(db: Queryable, row: CollectiveRow): Promise<StoredCollective> {
  return { ...row, members: (await membersOf(db, row.id)).get(row.id) ?? [] }
}

// Checks that the members sent by id are artists, rather than collectives of their own, and locks them until the
// transaction `tx` ends (`for share`), so that they can't be deleted or become collectives until their memberships are
// saved: changing an artist into a collective checks that they aren't a member while it holds the artist's row (see
// artists/store.ts). Throws an InvalidMember otherwise.
async function lockMembers(tx: Queryable, members: SentMember[]) {
  const ids = members.flatMap((member) => ('id' in member ? [member.id] : []))
  if (ids.length === 0) return
  if (!ids.every(isUuid)) throw new InvalidMember(NO_SUCH_MEMBER)
  const found = await tx.select({ kind: artists.kind }).from(artists).where(inArray(artists.id, ids)).for('share')
  if (found.length < ids.length) throw new InvalidMember(NO_SUCH_MEMBER)
  if (found.some((artist) => artist.kind === 'collective')) throw new InvalidMember(COLLECTIVE_AS_MEMBER)
}

// A member sent by name, as the artist to create: everything but their name is left out, as admins can leave it out
// (see `AdminArtistProfile` in artists/profile.ts).
function newMember(name: string, createdBy: string): Parameters<ArtistsStore['create']>[0] {
  return {
    kind: 'artist',
    name,
    members: [],
    country: '',
    city: '',
    genres: [],
    bio: '',
    links: {},
    email: null,
    phone: '',
    photoKey: null,
    photoType: null,
    createdBy,
  }
}

// Saves the members of the collective `collectiveId`, which has none, in order, once lockMembers has checked them. Those
// sent by name are created first, as artists whom `createdBy` adds.
async function addMembers(tx: Queryable, collectiveId: string, members: SentMember[], createdBy: string) {
  const ids: string[] = []
  for (const member of members) {
    ids.push('id' in member ? member.id : (await artistsStore(tx).create(newMember(member.name, createdBy))).id)
  }
  await tx.insert(collectiveMembers).values(ids.map((artistId, position) => ({ collectiveId, artistId, position })))
}

// Runs `save`, throwing an EmailTaken when it gives the collective the email of another one.
async function checkingEmail<T>(save: () => Promise<T>): Promise<T> {
  try {
    return await save()
  } catch (error) {
    if (violatesConstraint(error, 'collectives_email_lower_idx')) throw new EmailTaken()
    throw error
  }
}

export function collectivesStore(db: Queryable): CollectivesStore {
  return {
    async list() {
      const rows = await db.select().from(collectives).orderBy(asc(sql`lower(${collectives.name})`))
      const found = await membersOf(db)
      return rows.map((row) => ({ ...row, members: found.get(row.id) ?? [] }))
    },

    async get(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select().from(collectives).where(eq(collectives.id, id))
      return row ? withMembers(db, row) : null
    },

    create({ members, ...collective }) {
      return checkingEmail(() =>
        db.transaction(async (tx) => {
          await lockMembers(tx, members)
          const [row] = await tx.insert(collectives).values(collective).returning()
          await addMembers(tx, row.id, members, collective.createdBy)
          return withMembers(tx, row)
        }),
      )
    },

    async update(id, { members, ...changes }) {
      if (!isUuid(id)) return null
      return checkingEmail(() =>
        db.transaction(async (tx) => {
          // The collective is locked first, then its new members, and only then are its memberships replaced. Deleting
          // an artist locks the artist, then their memberships, so taking the memberships before the artists could
          // deadlock with it.
          const [before] = await tx.select().from(collectives).where(eq(collectives.id, id)).for('update')
          if (!before) return null
          await lockMembers(tx, members)
          const [after] = await tx.update(collectives).set(changes).where(eq(collectives.id, id)).returning()
          await tx.delete(collectiveMembers).where(eq(collectiveMembers.collectiveId, id))
          await addMembers(tx, id, members, changes.updatedBy)
          return { before, after: await withMembers(tx, after) }
        }),
      )
    },

    async delete(id) {
      if (!isUuid(id)) return null
      const [row] = await db.delete(collectives).where(eq(collectives.id, id)).returning()
      return row ?? null
    },
  }
}
