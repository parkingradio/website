import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, timestamp, uniqueIndex, index, smallint, integer, check, jsonb, date, boolean } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { APPLICATION_STATUSES } from 'shared/applications'
import type { ApplicationStatus, PrestationId, TimeSlot } from 'shared/applications'
import { ARTIST_KINDS } from './artist-profile.js'
import type { ArtistKind, Country, GenreId, LinkSiteId } from './artist-profile.js'

// A check that `column` is one of `values`.
function oneOf(column: AnyPgColumn, values: readonly string[]) {
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'), // null until the invite is accepted
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // The email of the admin who invited them, or null when they were created with the create-admin command.
    invitedBy: text('invited_by'),
    // Only the sessions that started with this version are valid. Sessions get it when they start, and choosing a new
    // password increments it, which ends the sessions that started with the old one.
    sessionVersion: integer('session_version').notNull().default(0),
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

// The credentials of the SoundCloud app the radio reads playlists through, as entered on the admin pages. There is only
// ever one row, and none until they've been entered.
export const soundcloudCredentials = pgTable(
  'soundcloud_credentials',
  {
    id: smallint('id').primaryKey().default(1),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret').notNull(),
    updatedBy: text('updated_by').notNull(), // the email of the admin who last changed them
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [check('soundcloud_credentials_single_row', sql`${table.id} = 1`)],
)

// Artists, known by their email address whatever its case. See the profile's schemas in artist-profile.ts for what each
// field may contain. Admins can leave out the country, city, genres, links and phone, which are then empty.
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
    country: text('country').$type<Country | ''>().notNull(), // one of COUNTRIES, e.g. "CA", or "" when an admin left it out
    city: text('city').notNull(),
    genres: text('genres').array().$type<GenreId[]>().notNull(), // ids, most important first
    bio: text('bio').notNull(),
    links: jsonb('links').$type<Partial<Record<LinkSiteId, string>>>().notNull(), // by site, profile names, or the address for "web"
    phone: text('phone').notNull(),
    // Where the photo is stored (see `Photos` in artists.ts), and its MIME type, as checked from its contents. Both null
    // when the artist has no photo.
    photoKey: text('photo_key'),
    photoType: text('photo_type'),
    // The email of the admin who last changed the artist, and when (null until then).
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('artists_email_lower_idx').on(sql`lower(${table.email})`),
    check('artists_kind', oneOf(table.kind, ARTIST_KINDS)),
    check('artists_photo', sql`(${table.photoKey} is null) = (${table.photoType} is null)`),
  ],
)

// Artists' applications for a set. Each one belongs to an artist, and is deleted with them. See `ApplicationFields` in
// shared/src/applications.ts for what each field can contain.
export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // The email of the admin who created the application, or null if the artist sent it themselves.
    createdBy: text('created_by'),
    artistId: uuid('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    // When the artist sent the application: when it was created, unless the admin who created it said otherwise, e.g.
    // for one that came by email.
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    dates: date('dates').array().notNull(), // sorted
    timeSlots: jsonb('time_slots').$type<TimeSlot[]>().notNull(), // sorted; empty means any time
    prestations: text('prestations').array().$type<PrestationId[]>().notNull(), // ids, in the order of PRESTATIONS
    otherPrestation: text('other_prestation').notNull(),
    details: text('details').notNull(),
    // The email of the admin who last changed the application, and when (null until then).
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    // The status admins gave the application, and the email of the admin who last changed it, and when (null until
    // then).
    status: text('status').$type<ApplicationStatus>().notNull().default('new'),
    statusUpdatedBy: text('status_updated_by'),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
  },
  (table) => [
    index('applications_artist_id_idx').on(table.artistId),
    check('applications_status', oneOf(table.status, APPLICATION_STATUSES)),
  ],
)

// Who the applications artists send are emailed to, as chosen on the admin pages. There is only ever one row, and none
// until they've been chosen.
export const applicationsSettings = pgTable(
  'applications_settings',
  {
    id: smallint('id').primaryKey().default(1),
    recipients: text('recipients').array().notNull(), // email addresses; empty means nobody
    updatedBy: text('updated_by').notNull(), // the email of the admin who last changed them
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [check('applications_settings_single_row', sql`${table.id} = 1`)],
)

// The feature flags that admins turned on or off on the admin pages (see features.ts). A flag without a row
// is off, and rows for flags that were retired are ignored.
export const featureFlags = pgTable('feature_flags', {
  id: text('id').primaryKey(), // one of FEATURES
  enabled: boolean('enabled').notNull(),
  updatedBy: text('updated_by').notNull(), // the email of the admin who last turned it on or off
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})
