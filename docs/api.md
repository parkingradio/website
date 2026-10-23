# Server API

This document covers every endpoint provided by the server.

The request and response types live in `shared/src/` (see [shared/README.md](../shared/README.md)), where they're
documented next to their fields: those types are the source of truth, and this page is the overview. When you add
or change an endpoint, update both.

## Conventions

- **JSON.** Requests with a body send JSON (`Content-Type: application/json`), unless said otherwise, and every
  response is JSON, except for photos. Dates and times are ISO 8601 strings, and days are `"YYYY-MM-DD"`. One
  exception: in production, nginx itself refuses requests whose body is over 12 MB, with a 413 that isn't JSON.
- **Errors.** A request that fails gets a 4xx or 5xx status and an error: an object with `ok` set to `false` and
  `error`, a message meant for people, in English unless it's shown to the public (`ApiError` in
  `shared/src/error.ts`). Successful responses have `ok` set to `true`, except for those of `GET /api/config`,
  `GET /api/events`, `GET /api/radio` and `GET /api/radio/tracks/:id/stream`. Unknown paths under `/api` get a 404
  error.
- **Sessions.** Logging in sets a `session` cookie (`session-<port>` in development, with the server's port, see
  "Several checkouts" in the README): a JWT signed by the server, HTTP-only, `SameSite=Lax`, `Secure` in production,
  which lasts 7 days. Endpoints marked "admin" require it, and fail with 401
  (`{"ok": false, "error": "Unauthorized"}`) without a valid one. A session also ends when its admin is revoked, or
  chooses a new password. Every admin can do everything: there are no roles.
  Since `SameSite=Lax` still lets pages on other subdomains send the cookie, admin requests other than `GET` that a
  browser says come from another origin, in `Sec-Fetch-Site` or else `Origin`, fail with 403.
- **Rate limits.** A few endpoints limit how many requests each client makes. Clients are told apart by their
  address: the one Cloudflare puts in `CF-Connecting-IP` in production, since requests reach the server through
  Cloudflare and nginx. Over the limit, they get a 429 error.

Below, requests and responses are described field by field. A field whose type says "or null" is always there, but
can be `null`.

## Endpoints

| Endpoint | Access | What it's for | Types |
|---|---|---|---|
| `GET /healthz` | public | Whether the server and its database work | — |
| `GET /api/config` | public | Environment-specific values the client needs | `config.ts` |
| `POST /api/auth/login` | public | Logging in as an admin | `auth.ts` |
| `POST /api/auth/logout` | public | Logging out | `auth.ts` |
| `POST /api/auth/accept-invite` | public | Setting an invited admin's password | `auth.ts` |
| `GET /api/admin/me` | admin | The logged-in admin | `auth.ts` |
| `POST /api/admin/invite` | admin | Inviting a new admin by email | `admin.ts` |
| `GET /api/admin/admins` | admin | Every admin, and whether they accepted their invite | `admin.ts` |
| `DELETE /api/admin/admins/:id` | admin | Revoking an admin | `admin.ts` |
| `GET /api/events` | public | Parking Radio's events, from Resident Advisor | `events.ts` |
| `GET /api/radio` | public | What's on the radio, and what comes next | `radio.ts` |
| `GET /api/radio/tracks/:id/stream` | public | Where to stream a track of the rotation from | `radio.ts` |
| `GET /api/admin/radio` | admin | The playlist the radio's rotation is read from | `radio.ts` |
| `POST /api/admin/radio/preview` | admin | What the radio would read from a playlist | `radio.ts` |
| `POST /api/admin/radio/playlist` | admin | Choosing the playlist the rotation is read from | `radio.ts` |
| `GET /api/admin/radio/credentials` | admin | The SoundCloud app the radio reads playlists through | `radio.ts` |
| `PUT /api/admin/radio/credentials` | admin | Entering the credentials of that SoundCloud app | `radio.ts` |
| `POST /api/admin/radio/credentials/check` | admin | Whether SoundCloud accepts credentials, without saving them | `radio.ts` |
| `GET /api/admin/artists` | admin | Every artist | `artists.ts` |
| `POST /api/admin/artists` | admin | Adding an artist, with or without a photo | `artists.ts` |
| `GET /api/admin/artists/:id` | admin | An artist | `artists.ts` |
| `GET /api/admin/artists/:id/photo` | admin | An artist's photo | — |
| `PUT /api/admin/artists/:id` | admin | Changing an artist's profile, or replacing or removing their photo | `artists.ts` |
| `DELETE /api/admin/artists/:id` | admin | Deleting an artist, their photo and their applications | `artists.ts` |
| `POST /api/applications` | public | A new artist applying, with their profile and maybe a photo | `applications.ts` |
| `GET /api/admin/applications` | admin | Every application, or an artist's | `applications.ts` |
| `POST /api/admin/applications` | admin | Creating an application for an artist | `applications.ts` |
| `GET /api/admin/applications/:id` | admin | An application | `applications.ts` |
| `PUT /api/admin/applications/:id` | admin | Changing an application | `applications.ts` |
| `PUT /api/admin/applications/:id/status` | admin | Accepting or rejecting an application | `applications.ts` |
| `DELETE /api/admin/applications/:id` | admin | Deleting an application | `applications.ts` |
| `GET /api/admin/applications/recipients` | admin | Who applications from artists are emailed to | `applications.ts` |
| `PUT /api/admin/applications/recipients` | admin | Choosing who applications from artists are emailed to | `applications.ts` |
| `GET /api/admin/features` | admin | Every feature flag, and whether it's on | `features.ts` |
| `PUT /api/admin/features/:id` | admin | Turning a feature flag on or off | `features.ts` |

## Health and configuration

### `GET /healthz`

Checks that the database answers. Responds `{"ok": true}`, or 500 with `{"ok": false}` when it doesn't. The deploy
workflow and the integration tests use it. Be careful about polling it continuously (e.g. Docker's `HEALTHCHECK`, or an
uptime monitor), since every request queries the database.

### `GET /api/config`

Values that depend on the environment, which the client reads before anything else (so it's public).

| Response field | Type | |
|---|---|---|
| `assetsDomain` | string | The domain serving the static assets, e.g. `"assets.parking.radio"` |
| `turnstileSiteKey` | string | The site key of the Cloudflare Turnstile widget. Pages need it to show the widget, which gives them the token `POST /api/applications` asks for |
| `features` | object | Whether each feature flag is on (`true`) or off (`false`), by id, e.g. `{"some-flag": true}`. A flag that isn't there is off (see "Feature flags" below) |

The response is never cached (`Cache-Control: no-store`), so that switching a feature flag takes effect for every page
loaded after that. When the flags can't be read from the database, `features` is empty, so they're all off, rather than the request failing.

## Admins and sessions

### `POST /api/auth/login`

| Request field | Type | |
|---|---|---|
| `email` | string | Matched whatever its case |
| `password` | string | |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `email` | string | The admin's email, as it was invited |

Sets the session cookie. Fails with 400 (missing fields), 401 (wrong email or password, or an invite that wasn't
accepted yet) or 429: each client gets 10 attempts per 15 minutes.

### `POST /api/auth/logout`

Takes no body. Clears the session cookie, and responds `{"ok": true}`. There's nothing to revoke on the server: the
session is only in the cookie.

### `POST /api/auth/accept-invite`

| Request field | Type | |
|---|---|---|
| `token` | string | From the link the invite emailed |
| `password` | string | At least 8 characters |

Sets the password of the admin `token` invites, and responds `{"ok": true}`. The invite can't be used again, and the
admin's sessions end, e.g. when the invite resets their password. Fails with 400: missing fields, a password that's too
short, or an invalid or expired invite.

### `GET /api/admin/me` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `email` | string | The logged-in admin's email |

The admin pages use it to know whether there's a session.

### `POST /api/admin/invite` (admin)

| Request field | Type | |
|---|---|---|
| `email` | string | Who to invite |

Emails an invite to `email`, which lasts 24 hours, replacing any earlier invite to that address, and responds
`{"ok": true}`. Fails with 400 (missing email), 409 (already an admin who accepted their invite) or 500 (the server
isn't set up to send email). An email that fails to send is only logged.

### `GET /api/admin/admins` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `admins` | array of `Admin` | By email |

`Admin`:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `email` | string | |
| `status` | `"active"`, `"invited"` or `"expired"` | Active once they've chosen their password, and until then, invited while their invite lasts |
| `inviteExpiresAt` | string or null | When their invite expires, while they're invited |
| `invitedBy` | string or null | The email of the admin who invited them. Null when they were created with `tools/create-admin`, or before that was known |
| `createdAt` | string | When they were invited |
| `you` | boolean | Whether this is the admin who asks |

### `DELETE /api/admin/admins/:id` (admin)

Revokes the admin, and responds `{"ok": true}`: they can't log in anymore, and their sessions end. For an admin who
hasn't accepted their invite, this cancels it. Fails with 404 (no such admin) or 409 (the admin who asks).

## Events

### `GET /api/events`

| Response field | Type | |
|---|---|---|
| `promoterUrl` | string | Parking Radio's page on RA |
| `upcoming` | list of events | All of them, in no particular order |
| `past` | list of events | The 20 most recent, in no particular order |

An event has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `category` | `"synth-meetup"` or `"other"` | Derived by the server from the title |
| `start` | string | Local time, as RA gives it: `"YYYY-MM-DDTHH:mm"` |
| `end` | string or null | Same |
| `venue` | string or null | |
| `city` | string or null | |
| `lineup` | list of strings | |
| `url` | string | The event's page on RA |
| `flyer` | string or null | Full size, on images.ra.co |

Read from RA's GraphQL endpoint, which isn't a public API (see "Programmation" in [design.md](design.md)). What RA
answers, successfully or not, is kept for 2 minutes. Fails with 502 when the events can't be read from RA.

## Radio

The radio plays a rotation: the tracks of a SoundCloud playlist chosen on the admin pages, in order. The server
decides what's on air and moves along the rotation as tracks end, so that every listener hears the same track at
the same point.

The server reads playlists through a SoundCloud app, whose credentials are also entered on the admin pages (see
`PUT /api/admin/radio/credentials`). Until they are, it can't read any playlist, so the radio is off air.

A track has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `artist` | string | Parsed from the track's title on SoundCloud, `ARTIST \| [EVENT @ ]parking.radio \| YYYY.MM.DD`, or the whole title when it doesn't follow that pattern |
| `event` | string or null | The event the set was played at |
| `date` | string or null | The day the set was recorded |
| `durationMs` | number | In milliseconds |
| `url` | string | The track's page on SoundCloud |

### `GET /api/radio[?upcoming=N]`

| Response field | Type | |
|---|---|---|
| `current` | object | The track on air: `track`, a track, and `startedAt`, when it went on air. It's on air until `startedAt` plus its `durationMs` |
| `upcoming` | list of tracks | The next N tracks of the rotation, all of them by default. They can still change |

Fails with 400 (`upcoming` isn't a whole number), 502 (the playlist can't be read from SoundCloud, e.g. because the
credentials of the SoundCloud app haven't been entered yet) or 503 (no playlist has been chosen yet).

### `GET /api/radio/tracks/:id/stream`

| Response field | Type | |
|---|---|---|
| `url` | string | An HLS playlist on SoundCloud's CDN, which needs no credentials |
| `expiresAt` | string | When `url` stops working: the playlist has to be loaded by then |

Only for tracks of the rotation, or tracks that just left it, for as long as they last. Fails with 404 (not a track of
the rotation) or 502 (SoundCloud can't be reached).

### `GET /api/admin/radio` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `credentialsEntered` | boolean | Whether the credentials of the SoundCloud app have been entered. Until they are, no playlist can be read |
| `current` | object or null | The chosen playlist (below), or null until one has been chosen |

The chosen playlist has:

| Field | Type | |
|---|---|---|
| `url`, `title` | string | The playlist's link and title, as they were when it was chosen |
| `chosenBy` | string | The email of the admin who chose it |
| `chosenAt` | string | When |
| `playlist` | playlist or null | What the radio reads from it, or null when it couldn't be read yet, or the credentials haven't been entered |
| `error` | string or null | Why it couldn't be read the last time it was tried, if it couldn't |

A playlist has:

| Field | Type | |
|---|---|---|
| `url` | string | Its page on SoundCloud: for a private playlist, its private link |
| `title` | string | |
| `private` | boolean | |
| `account` | object | The SoundCloud account it belongs to: its `name` and the `url` of its page |
| `tracks` | list of objects | Its tracks, in the playlist's order, each with a `kind` (below) |

Each of a playlist's tracks is one of:

- `kind: "rotation"`: on the radio, with its `track`.
- `kind: "left-out"`: left out of the rotation because SoundCloud doesn't let it be played in full, with its `track`
  and the `reason`: `"preview"` (only a preview can be played), `"blocked"` or `"not-streamable"`.
- `kind: "unexpected"`: left out because SoundCloud describes it unexpectedly, with only its `title`.

### `POST /api/admin/radio/preview` (admin)

| Request field | Type | |
|---|---|---|
| `link` | string | A link to a SoundCloud playlist (see `playlistLink` in `shared/src/radio.ts`) |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `playlist` | playlist | What the radio would read from it |

Reads the playlist without choosing it. Fails with 400 (not a link to a playlist), 404 (SoundCloud shows no playlist
there), 409 (the credentials of the SoundCloud app haven't been entered yet) or 502 (SoundCloud can't be reached).

### `POST /api/admin/radio/playlist` (admin)

| Request field | Type | |
|---|---|---|
| `link` | string | Like for the preview |

Reads the rotation from the playlist at `link` from now on, and responds `{"ok": true}`: its first track goes on air
right away. Fails like the preview, and with 400 when none of the playlist's tracks can be played in full.

### `GET /api/admin/radio/credentials` (admin)

The SoundCloud app the radio reads playlists through. Its secret is never sent back: it can only be replaced.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `credentials` | object or null | The app's `clientId`, and who last changed the credentials (`updatedBy`, an admin's email) and when (`updatedAt`). Null until they're entered: until then, the radio is off air |

### `PUT /api/admin/radio/credentials` (admin)

| Request field | Type | |
|---|---|---|
| `clientId` | string | The app's client ID, up to 200 characters. Trimmed |
| `clientSecret` | string | The app's client secret, up to 200 characters. Trimmed |

Asks SoundCloud for a token with the credentials, and only if it gives one, saves them and responds like
`GET /api/admin/radio/credentials`. The radio reads its playlist through them right away. Fails with 400 (either one
is blank or too long, or SoundCloud refuses them) or 502 (SoundCloud can't be reached).

### `POST /api/admin/radio/credentials/check` (admin)

Takes the same request as `PUT /api/admin/radio/credentials`, and asks SoundCloud for a token with the credentials the
same way, but doesn't save them: it responds `{"ok": true}` when SoundCloud accepts them, and fails like `PUT`
otherwise. The admin pages use it so that credentials can be verified before they're saved.

## Artists

The artists Parking Radio knows, each with their profile and maybe a photo, are rows of the `artists` table
(`server/src/schema.ts`). An artist is known by their email: two artists can't have the same one, whatever its case.
The rules a profile has to follow are in `shared/src/artists.ts`, and the server checks every profile it's sent
against them. The server explains what's wrong with a profile or a photo in French, unlike its other admin errors,
because artists will see the same messages when they apply.

Admins can leave out more than artists: the admin endpoints below take profiles without a country, city, genres, links
or phone, since admins bring in artists who applied elsewhere, e.g. through the original Google Form, which didn't always
ask for them. What's left out is stored as an empty string, or an empty list or object. `POST /api/applications`
requires all of them.

The photo is optional. It's a JPEG, PNG or WebP image of up to 10 MB, whose type is checked from its contents. It's kept
in the app's private S3 bucket, or in a local directory in development, and only the server reads it.

A profile has:

| Field | Type | |
|---|---|---|
| `kind` | `"artist"` or `"collective"` | An artist usually gets an hour of a time slot, a collective a whole slot |
| `name` | string | The artist's name, or the collective's. Up to 100 characters |
| `members` | list of strings | For a collective, the names of its artists, at least one, each up to 100 characters. Empty for an artist |
| `country` | string | ISO 3166-1 alpha-2 code, e.g. `"CA"`, or `""` when an admin left it out |
| `city` | string | As the artist wrote it. Up to 100 characters, or `""` when an admin left it out |
| `genres` | list of strings | The ids of at least one of `GENRES` (e.g. `"drum-and-bass"`), most important first, or none when an admin left them out |
| `bio` | string | Up to 5000 characters |
| `links` | object | By site (`soundcloud`, `instagram`, `web`, `bandcamp`, `mixcloud`, `ra`, `youtube`, `spotify`, `tiktok`), at least one, or none when an admin left them out: see below |
| `email` | string | What the artist is known by. Up to 200 characters |
| `phone` | string | At least 7 digits. Up to 40 characters, or `""` when an admin left it out |

Links are stored as profile names, which the server reduces what was typed or pasted to: e.g.
`https://soundcloud.com/parkingdotradio/sets/x` is stored as `parkingdotradio`. For `web`, it's the address itself.
Either is up to 200 characters.
`linkSite(id).url(value)` turns a profile name back into an address.

An artist, as the endpoints below return them, is their profile with:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `createdAt` | string | When the artist was added |
| `createdBy` | string or null | The email of the admin who added the artist, or null when they added themselves, by applying |
| `updatedBy` | string or null | The email of the admin who last changed the artist |
| `updatedAt` | string or null | When |
| `hasPhoto` | boolean | Whether the artist has a photo |

### `GET /api/admin/artists` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artists` | list of artists | By name, whatever its case |

### `GET /api/admin/artists/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artist` | artist | |

Fails with 404 when there's no such artist.

### `GET /api/admin/artists/:id/photo` (admin)

Responds with the photo itself, with the type it was checked to have, rather than JSON. Browsers are told not to
guess another type (`X-Content-Type-Options: nosniff`) or to keep it (`Cache-Control: private, no-store`). Fails with
404 when there's no such artist, when they have no photo, or when their photo is missing.

### `POST /api/admin/artists` (admin)

Adds an artist. It's `multipart/form-data`, with two parts: `artist`, the profile as JSON, in a field rather than a
file, and `photo`, the artist's photo, which can be left out. A few other fields or files, e.g. a form's submit button,
are ignored. A second photo isn't: the request fails.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artist` | artist | As they were added |

Fails with 400 (an invalid profile or photo, or a malformed request), 409 (another artist has that email) or 413 (a
photo larger than 10 MB).

### `PUT /api/admin/artists/:id` (admin)

Replaces an artist's profile. It takes the same request as `POST /api/admin/artists`. With a photo, it replaces the
artist's, which is deleted. Without one, the artist keeps theirs, unless there's also a `removePhoto` field set to
`true`, which removes it, and deletes it. Responds like `POST /api/admin/artists`, with the artist as they are then,
and fails like it, with 400 when there's both a photo and `removePhoto`, and with 404 when there's no such artist.

### `DELETE /api/admin/artists/:id` (admin)

Deletes an artist, their photo if they have one and their applications, and responds `{"ok": true}`. The photo stays in
the bucket's previous versions for as long as the database's backups are kept, like the artist's row, and is gone for
good after that. Fails with 404 when there's no such artist.

## Applications

Artists apply for a set at Parking Radio by sending an application. It says when they'd like to play and what they'd
do. Applications are stored in the `applications` table (`server/src/schema.ts`). Each one belongs to an artist, and is
deleted when the artist is deleted.

The server checks every application against the rules in `shared/src/applications.ts`. These rules only make sure the
data is valid. Suggestions and limits, like which dates or time slots to offer, are up to the forms. Error messages are
in French, like for profiles, because artists will see them.

Applications are created in two ways:

- A new artist applies with `POST /api/applications`, which creates the artist and their application together.
- An admin creates an application on the admin pages, for an artist who already exists.

An application has these fields:

| Field | Type | |
|---|---|---|
| `dates` | list of strings | The days the artist would like to play, sorted. At least one. Past days are allowed, e.g. to import old applications |
| `timeSlots` | list of objects | The times of day that work for the artist, on any of their dates, sorted. Each one has a `start` and an `end` in Québec time, e.g. `{"start": "18:00", "end": "22:00"}`. The end is later the same day. An empty list means any time |
| `prestations` | list of strings | What the artist would do: ids from `PRESTATIONS` in `shared/src/applications.ts`, e.g. `"dj"` or `"live-performance"`. Requests can list them in any order, even more than once, and other values are refused with 400. Responses list them in the order of `PRESTATIONS`. Can be empty |
| `otherPrestation` | string | Anything else the artist would do, in a few words, e.g. `"Synthé modulaire"`. Up to 60 characters. Can be empty |
| `details` | string | The artist's questions or other details. Up to 2000 characters. Can be empty |

The endpoints below also return these fields:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `artistId` | string | The artist who applied |
| `receivedAt` | string | When the artist sent the application. For one sent through `POST /api/applications`, that's when it was created. For one an admin created, it's what the admin said, or else when it was created. Admins can change it either way |
| `createdAt` | string | When the application was created |
| `createdBy` | string or null | The email of the admin who created the application, or null if the artist sent it themselves |
| `updatedBy`, `updatedAt` | string or null | Who last changed the application (an admin's email), and when. Status changes don't count |
| `status` | `"new"`, `"accepted"`, `"scheduled"`, `"done"` or `"rejected"` | Every application starts as `"new"` |
| `statusUpdatedBy`, `statusUpdatedAt` | string or null | Who last changed the status (an admin's email), and when |

### `POST /api/applications`

A new artist applies. This creates the artist, with their profile and photo, if they sent one, and their application.
The artist's `createdBy` and the application's are both null, since nobody on the team created them.

Anyone can call this endpoint, so it has two protections against bots and floods:

- **Cloudflare Turnstile.** The page shows Turnstile's widget, using the site key from `GET /api/config`. Once the
  visitor passes Turnstile's check, the widget gives the page a token, which the page sends with the application. The
  server then asks Cloudflare whether the token is valid.
- **A rate limit.** Each client can send 5 requests per hour. Requests that fail count too.

The request is `multipart/form-data`, with four parts:

| Part | |
|---|---|
| `artist` | The artist's profile (see "Artists"), with everything an admin could leave out, as JSON, in a field rather than a file |
| `application` | The application's fields, as JSON, the same way |
| `photo` | The artist's photo (see "Artists"), which can be left out |
| `turnstileToken` | The token Turnstile gave the page |

A few other fields or files, e.g. a form's submit button, are ignored. A second photo isn't: the request fails. On
success, the response is `{"ok": true}`.

**Emails.** Once the application is saved, the server sends two emails, in French, from `noreply@<MAIL_DOMAIN>`:

- To the recipients chosen on the admin pages (see `GET /api/admin/applications/recipients`): everything the artist
  sent, except their photo, which is on the artist's page on the admin pages. Replying to it answers the artist. When
  nobody was chosen, it isn't sent.
- To the artist: a confirmation that the application was received. Replying to it answers the recipients, if there
  are any. It goes to whatever address the application has, so it doesn't repeat anything the artist wrote: otherwise,
  anyone could have the server send their own text to any address.

Emails that can't be sent are only logged: the application is saved either way, and the request still succeeds. When
`MAIL_DOMAIN` isn't set, e.g. in development, no email is sent.

**Only new artists can apply this way.** If an artist with the same email already exists (ignoring upper and lower
case), the request fails with 409 and nothing is created. Otherwise, anyone could take over an artist's profile just by
typing their email. The downside is that the 409 tells whoever sent the request that this email belongs to an artist.
To make that harder to abuse, the server only checks the email after Turnstile has accepted the token.

**Errors** are in French, since artists see them:

| Status | When |
|---|---|
| 400 | The profile, application or photo isn't valid, the request is malformed, or Turnstile refused the token |
| 409 | An artist with that email already exists |
| 413 | The photo is larger than 10 MB, or the request is too large to be an application |
| 429 | The client sent too many requests |
| 502 | Cloudflare couldn't be reached, or couldn't check the token |

**When the page needs a new token.** Cloudflare only accepts each token once. To let artists fix their mistakes, the
server checks the profile, the application and the photo before it sends the token to Cloudflare. So if the request
fails because one of those isn't valid, the page can send it again with the same token. After any other error, the
token may already be used up, and the page needs to get a new one from the widget.

### `GET /api/admin/applications[?artist=<id>]` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `applications` | list of applications | The most recently received first (by `receivedAt`, then `createdAt`). With `artist`, only that artist's applications. An unknown artist has none |

### `GET /api/admin/applications/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `application` | application | |

Fails with 404 if the application doesn't exist.

### `POST /api/admin/applications` (admin)

Creates an application, e.g. to bring in one that came by email. The request has the application's fields, plus:

| Request field | Type | |
|---|---|---|
| `artistId` | string | The id of the artist who's applying |
| `receivedAt` | string, optional | When the artist sent the application: a date and time with its offset from UTC, e.g. `"2026-03-28T14:03:00Z"` or `"2026-03-28T10:03:00-04:00"`, which can't be in the future. Now if it's left out |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `application` | application | The new application |

Fails with 400 if the application or `receivedAt` isn't valid (with a message in French), or the artist doesn't exist.

### `PUT /api/admin/applications/:id` (admin)

Replaces an application's fields. The request is the same as for `POST /api/admin/applications`, without `artistId`,
and leaving `receivedAt` out keeps the one the application has. The artist and the status don't change. The response
is the same as for `POST /api/admin/applications`, with the updated application. Fails with 400 if the application or
`receivedAt` isn't valid, or 404 if it doesn't exist.

### `PUT /api/admin/applications/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"new"`, `"accepted"`, `"scheduled"`, `"done"` or `"rejected"` | |

Changes an application's status. The response is the same as for `POST /api/admin/applications`. Fails with 400 if
`status` isn't one of these values, or 404 if the application doesn't exist.

### `DELETE /api/admin/applications/:id` (admin)

Deletes an application, and responds `{"ok": true}`. Fails with 404 if the application doesn't exist.

### `GET /api/admin/applications/recipients` (admin)

Who applications sent with `POST /api/applications` are emailed to. Applications that admins create aren't emailed.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `recipients` | list of strings | Email addresses. Empty until admins choose them: until then, applications are saved and confirmed to the artist, but not emailed to anyone else |
| `updatedBy`, `updatedAt` | string or null | Who last changed the recipients (an admin's email), and when |

### `PUT /api/admin/applications/recipients` (admin)

| Request field | Type | |
|---|---|---|
| `recipients` | list of strings | Email addresses, up to 10. They're trimmed, and blanks and duplicates (ignoring upper and lower case) are dropped. Empty means nobody |

Replaces the recipients, and responds like `GET /api/admin/applications/recipients`. Fails with 400 if `recipients`
isn't a list of strings, if one of them isn't an email address, or if there are more than 10.

## Feature flags

Switches that admins turn on and off, to change what the site does without deploying it again (see "Features" in
[design.md](design.md)). The flags are listed in `FEATURES`, in `shared/src/features.ts`. Each one is off until an
admin turns it on. Pages read them in `GET /api/config`.

### `GET /api/admin/features` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `features` | list of flags | Every flag, in the order of `FEATURES`. See below |

Each flag:

| Field | Type | |
|---|---|---|
| `id` | string | E.g. `"some-flag"` |
| `enabled` | boolean | Whether it's on |
| `updatedBy`, `updatedAt` | string or null | Who last turned it on or off (an admin's email), and when |

### `PUT /api/admin/features/:id` (admin)

| Request field | Type | |
|---|---|---|
| `enabled` | boolean | Whether to turn it on or off |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `feature` | flag | The flag, like in `GET /api/admin/features` |

Fails with 400 if `enabled` isn't a boolean, or 404 if there's no such flag, including one that was retired.
