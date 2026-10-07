import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, timestamp, uniqueIndex, smallint, check, jsonb } from 'drizzle-orm/pg-core'
import { ARTIST_KINDS } from 'shared/artists'
import type { ArtistKind, GenreId, LinkSiteId } from 'shared/artists'

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'), // null until the invite is accepted
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`)],
)

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(), // sha256 hex; raw token is never stored
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

// The playlist the radio's rotation is read from. There is only ever one row, and none until a playlist
// has been chosen on the admin pages.
export const radioSettings = pgTable(
  'radio_settings',
  {
    id: smallint('id').primaryKey().default(1),
    playlistId: text('playlist_id').notNull(), // the SoundCloud id of the playlist
    playlistSecretToken: text('playlist_secret_token'), // what gives access to a private playlist, null otherwise
    playlistUrl: text('playlist_url').notNull(), // the playlist's link and title, as they were when it was chosen
    playlistTitle: text('playlist_title').notNull(),
    updatedBy: text('updated_by').notNull(), // the email of the admin who chose the playlist
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [check('radio_settings_single_row', sql`${table.id} = 1`)],
)

// The track on air on the radio, and when it started. There is only ever one row, which the server
// moves along the rotation as tracks end.
export const radioOnAir = pgTable(
  'radio_on_air',
  {
    id: smallint('id').primaryKey().default(1),
    playlistId: text('playlist_id').notNull(), // the SoundCloud id of the playlist the rotation was read from
    trackId: text('track_id').notNull(), // the SoundCloud id of the track
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    nextTrackIds: text('next_track_ids').array().notNull(), // the tracks after it in the rotation, in order
  },
  (table) => [check('radio_on_air_single_row', sql`${table.id} = 1`)],
)

// Artists, known by their email address whatever its case. See `ArtistProfile` in shared/src/artists.ts for what each
// field may contain.
export const artists = pgTable(
  'artists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // The email of the admin who added the artist, or null when they added themselves, by applying.
    createdBy: text('created_by'),
    email: text('email').notNull(),
    kind: text('kind').$type<ArtistKind>().notNull(),
    name: text('name').notNull(), // or the collective's name
    members: text('members').array().notNull(), // a collective's artists; empty for an artist
    country: text('country').notNull(), // one of COUNTRIES, e.g. "CA"
    city: text('city').notNull(),
    genres: text('genres').array().$type<GenreId[]>().notNull(), // ids, most important first
    bio: text('bio').notNull(),
    links: jsonb('links').$type<Partial<Record<LinkSiteId, string>>>().notNull(), // by site, profile names, or the address for "web"
    phone: text('phone').notNull(),
    // Where the photo is stored (see `Photos` in artists.ts), and its MIME type, as checked from its contents.
    photoKey: text('photo_key').notNull(),
    photoType: text('photo_type').notNull(),
    // The email of the admin who last changed the artist, and when (null until then).
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('artists_email_lower_idx').on(sql`lower(${table.email})`),
    check('artists_kind', sql`${table.kind} in (${sql.raw(ARTIST_KINDS.map((kind) => `'${kind}'`).join(', '))})`),
  ],
)
