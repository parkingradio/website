import { sql } from 'drizzle-orm'
import { pgTable, uuid, text, timestamp, uniqueIndex, index, smallint, integer, check, jsonb, date, boolean, primaryKey } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { APPLICATION_STATUSES } from '../applications/fields.js'
import type { ApplicationStatus, PerformanceTypeId, TimeSlot } from '../applications/fields.js'
import type { Country, GenreId, LinkSiteId } from '../artists/profile.js'
import { SESSION_TYPES, STATUSES } from '../sessions/fields.js'
import type { SessionType, Status } from '../sessions/fields.js'

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

// The YouTube channel the server reads the site's video from, and the API key it reads it with, as entered on the admin
// pages. There is only ever one row, and none until they've been entered.
export const youtubeCredentials = pgTable(
  'youtube_credentials',
  {
    id: smallint('id').primaryKey().default(1),
    channelId: text('channel_id').notNull(),
    apiKey: text('api_key').notNull(),
    uploadsPlaylistId: text('uploads_playlist_id').notNull(), // the channel's uploads, read with the channel when it was entered
    updatedBy: text('updated_by').notNull(), // the email of the admin who last changed them
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [check('youtube_credentials_single_row', sql`${table.id} = 1`)],
)

// Artists. Two of them can't have the same email address, whatever its case. See the profile's schemas in
// artists/profile.ts for what each field may contain. Admins can leave out the country, city, genres, bio, links and
// phone, which are then empty, and the email, which is then null.
export const artists = pgTable(
  'artists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // The email of the admin who added the artist, or null when they came through the form, alone or with a collective.
    createdBy: text('created_by'),
    email: text('email'),
    name: text('name').notNull(),
    country: text('country').$type<Country | ''>().notNull(), // one of COUNTRIES, e.g. "CA", or "" when an admin left it out
    city: text('city').notNull(),
    genres: text('genres').array().$type<GenreId[]>().notNull(), // ids, most important first
    bio: text('bio').notNull(),
    links: jsonb('links').$type<Partial<Record<LinkSiteId, string>>>().notNull(), // by site, profile names, or the address for "web"
    phone: text('phone').notNull(),
    // Where the photo is stored (see `Photos` in artists/store.ts), and its MIME type, as checked from its contents.
    // Both null when the artist has no photo.
    photoKey: text('photo_key'),
    photoType: text('photo_type'),
    // The email of the admin who last changed the artist, and when (null until then).
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('artists_email_lower_idx').on(sql`lower(${table.email})`),
    check('artists_photo', sql`(${table.photoKey} is null) = (${table.photoType} is null)`),
  ],
)

// Collectives, whose members are artists. Two of them can't have the same email address, whatever its case, but a
// collective can have an artist's. See the profile's schema in collectives/profile.ts for what each field may contain.
// Admins can leave out the country, city, description, links and phone, which are then empty, and the email, which is
// then null.
export const collectives = pgTable(
  'collectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // The email of the admin who added the collective, or null when it added itself, by applying.
    createdBy: text('created_by'),
    name: text('name').notNull(),
    country: text('country').$type<Country | ''>().notNull(), // one of COUNTRIES, e.g. "CA", or "" when an admin left it out
    city: text('city').notNull(),
    description: text('description').notNull(),
    links: jsonb('links').$type<Partial<Record<LinkSiteId, string>>>().notNull(), // by site, profile names, or the address for "web"
    email: text('email'), // the contact's
    phone: text('phone').notNull(), // the contact's
    // Where the photo is stored (see `Photos` in artists/store.ts), and its MIME type, as checked from its contents.
    // Both null when the collective has no photo.
    photoKey: text('photo_key'),
    photoType: text('photo_type'),
    // The email of the admin who last changed the collective, and when (null until then).
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('collectives_email_lower_idx').on(sql`lower(${table.email})`),
    check('collectives_photo', sql`(${table.photoKey} is null) = (${table.photoType} is null)`),
  ],
)

// The artists of each collective, in order. An artist can be in several collectives, but only once in each. Deleting a
// collective or an artist deletes their memberships.
export const collectiveMembers = pgTable(
  'collective_members',
  {
    collectiveId: uuid('collective_id')
      .notNull()
      .references(() => collectives.id, { onDelete: 'cascade' }),
    artistId: uuid('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(), // the collective's members are in the order of their position
  },
  (table) => [primaryKey({ columns: [table.collectiveId, table.artistId] }), index('collective_members_artist_id_idx').on(table.artistId)],
)

// Applications for a set. Each one belongs to either an artist or a collective, never both, and is deleted with them.
// See `ApplicationFields` in applications/fields.ts for what each field can contain.
export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // The email of the admin who created the application, or null if the artist sent it themselves.
    createdBy: text('created_by'),
    // Exactly one of them isn't null (see `applications_owner` below).
    artistId: uuid('artist_id').references(() => artists.id, { onDelete: 'cascade' }),
    collectiveId: uuid('collective_id').references(() => collectives.id, { onDelete: 'cascade' }),
    // When the artist sent the application: when it was created, unless the admin who created it said otherwise, e.g.
    // for one that came by email.
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    dates: date('dates').array().notNull(), // sorted
    timeSlots: jsonb('time_slots').$type<TimeSlot[]>().notNull(), // sorted; empty means any time
    performanceTypes: text('performance_types').array().$type<PerformanceTypeId[]>().notNull(), // ids, in the order of PERFORMANCE_TYPES
    otherPerformanceType: text('other_performance_type').notNull(),
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
    index('applications_collective_id_idx').on(table.collectiveId),
    check('applications_owner', sql`(${table.artistId} is null) <> (${table.collectiveId} is null)`),
    check('applications_status', oneOf(table.status, APPLICATION_STATUSES)),
  ],
)

// Sessions: the occasions at the studio, e.g. an evening of three artists, or a collective's takeover. See
// `SessionFields` in sessions/fields.ts for what each field can contain.
//
// Sessions with a start can't overlap, unless one of them is cancelled. That's the exclusion constraint
// `sessions_no_overlap`, which drizzle can't declare, so it's only in the migration that adds it (0005_sessions.sql),
// with the function it uses:
//   EXCLUDE USING gist (session_period(start_at, duration_minutes) WITH &&)
//     WHERE (status <> 'cancelled' AND start_at IS NOT NULL)
// session_period(start, minutes) is tstzrange(start, start + minutes), from the start, included, to the end, excluded,
// so that sessions can follow each other. The transactions that write sessions or sets take a lock first, which keeps
// them from deadlocking on it, and lets the server check the rules that span both tables (see sessions/store.ts).
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').notNull(), // the email of the admin who added the session
    startAt: timestamp('start_at', { withTimezone: true }), // null until its date is known
    durationMinutes: integer('duration_minutes').notNull(), // minutes that actually pass, whatever the clocks say
    type: text('type').$type<SessionType>().notNull(),
    name: text('name').notNull(), // free text, "" for none, which a session of type "other" can't be
    // The collective whose takeover the session is, which only takeovers have, and they always do. So a collective can't
    // be deleted while it has takeovers, which the server checks first, under the sessions' lock (see sessions/store.ts).
    takeoverId: uuid('takeover_id').references(() => collectives.id, { onDelete: 'restrict' }),
    raEventId: text('ra_event_id'),
    description: text('description').notNull().default(''), // plain text, "" for none, which its type's then replaces
    // Where the flyer is stored (see `Photos` in artists/store.ts), and its MIME type, as checked from its contents. Both
    // null when the session has no flyer.
    flyerKey: text('flyer_key'),
    flyerType: text('flyer_type'),
    // The email of the admin who last changed the session, and when (null until then). Status changes don't count, and
    // neither do changes to its sets.
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    // The status admins gave the session, and the email of the admin who last changed it, and when (null until then).
    status: text('status').$type<Status>().notNull().default('planned'),
    statusUpdatedBy: text('status_updated_by'),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
  },
  (table) => [
    index('sessions_takeover_id_idx').on(table.takeoverId),
    check('sessions_duration', sql`${table.durationMinutes} between 1 and 1440`),
    check('sessions_status', oneOf(table.status, STATUSES)),
    check('sessions_type', oneOf(table.type, SESSION_TYPES)),
    check('sessions_takeover', sql`(${table.type} = 'takeover') = (${table.takeoverId} is not null)`),
    check('sessions_named', sql`${table.type} <> 'other' or ${table.name} <> ''`),
    check('sessions_flyer', sql`(${table.flyerKey} is null) = (${table.flyerType} is null)`),
  ],
)

// Sets: the performances of a session, each streamed as its own YouTube live and uploaded as its own SoundCloud track.
// See `SetFields` in sessions/fields.ts for what each field can contain. Deleting a session deletes its sets.
//
// A set's place in its session is relative to its start. A session's sets are meant to fit in it without overlapping each
// other, but they don't have to, so nothing checks it (see "Sets' places" in docs/design/server/sessions.md). That a
// cancelled session only has cancelled sets is checked by the server, since it spans both tables (see sessions/store.ts).
export const sets = pgTable(
  'sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').notNull(), // the email of the admin who added the set
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // In minutes after its session's start, and how long it lasts, in minutes that actually pass. Each one is null until
    // it's known, but a set with an offset has a duration.
    offsetMinutes: integer('offset_minutes'),
    durationMinutes: integer('duration_minutes'),
    performanceTypes: text('performance_types').array().$type<PerformanceTypeId[]>().notNull(), // ids, in the order of PERFORMANCE_TYPES
    otherPerformanceType: text('other_performance_type').notNull(), // free text, "" for none
    genres: text('genres').array().$type<GenreId[]>().notNull(), // ids, most important first
    // SoundCloud's id for the track, and the link it was resolved from, both null when the set has no track.
    soundcloudTrackId: text('soundcloud_track_id'),
    soundcloudTrackUrl: text('soundcloud_track_url'),
    youtubeVideoId: text('youtube_video_id'),
    // The email of the admin who last changed the set, and when (null until then). Status changes don't count.
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    // The status admins gave the set, and the email of the admin who last changed it, and when (null until then).
    status: text('status').$type<Status>().notNull().default('planned'),
    statusUpdatedBy: text('status_updated_by'),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
  },
  (table) => [
    index('sets_session_id_idx').on(table.sessionId),
    // A track, or a video, belongs to at most one set.
    uniqueIndex('sets_soundcloud_track_id_idx').on(table.soundcloudTrackId),
    uniqueIndex('sets_youtube_video_id_idx').on(table.youtubeVideoId),
    check('sets_place', sql`${table.offsetMinutes} is null or ${table.durationMinutes} is not null`),
    check('sets_offset', sql`${table.offsetMinutes} between 0 and 1439`),
    check('sets_duration', sql`${table.durationMinutes} between 1 and 1440`),
    check('sets_soundcloud_track', sql`(${table.soundcloudTrackId} is null) = (${table.soundcloudTrackUrl} is null)`),
    check('sets_status', oneOf(table.status, STATUSES)),
  ],
)

// The performers of each set, in order: artists, each only once in each set. Deleting a set or an artist deletes their
// rows, so the set stays without them.
export const setPerformers = pgTable(
  'set_performers',
  {
    setId: uuid('set_id')
      .notNull()
      .references(() => sets.id, { onDelete: 'cascade' }),
    artistId: uuid('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(), // the set's performers are in the order of their position
  },
  (table) => [
    primaryKey({ columns: [table.setId, table.position] }),
    // With the artist first, so that it also finds an artist's sets.
    uniqueIndex('set_performers_artist_id_set_id_idx').on(table.artistId, table.setId),
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

// The feature flags that admins turned on or off on the admin pages (see features/store.ts). A flag without a row
// is off, and rows for flags that were retired are ignored.
export const featureFlags = pgTable('feature_flags', {
  id: text('id').primaryKey(), // one of FEATURES
  enabled: boolean('enabled').notNull(),
  updatedBy: text('updated_by').notNull(), // the email of the admin who last turned it on or off
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

// The apps that admins allowed to act as them, e.g. Claude, through the MCP server (see oauth/store.ts and
// docs/design/server/oauth.md). An app uses its connection with an access token, whose hash is here, and a refresh token
// (see oauthRefreshTokens).
export const oauthConnections = pgTable(
  'oauth_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(), // one of OAUTH_CLIENTS
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    // When the connection ends unless it's used before then: when its latest refresh token expires.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    accessTokenHash: text('access_token_hash').notNull().unique(), // sha256 hex; the token itself is never stored
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('oauth_connections_user_id_idx').on(table.userId)],
)

// The codes that an admin's allowing an app gives it, which it exchanges for the tokens of a new connection. A used code
// is kept until it expires, with the connection it made, so that using it again ends that connection.
export const oauthCodes = pgTable(
  'oauth_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('code_hash').notNull().unique(), // sha256 hex; the code itself is never stored
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(), // PKCE's, with S256
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    connectionId: uuid('connection_id').references(() => oauthConnections.id, { onDelete: 'set null' }),
  },
  (table) => [index('oauth_codes_user_id_idx').on(table.userId), index('oauth_codes_connection_id_idx').on(table.connectionId)],
)

// The refresh tokens of connections. Each one can be used once, for the next one, and a used one is kept until it
// expires, so that using it again ends its connection.
export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(), // sha256 hex; the token itself is never stored
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => oauthConnections.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [index('oauth_refresh_tokens_connection_id_idx').on(table.connectionId)],
)
