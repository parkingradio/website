# Server API

This document covers every endpoint provided by the server.

The request and response types live in `shared/src/` (see [shared/README.md](../shared/README.md)), where they're
documented next to their fields: those types are the source of truth, and this page is the overview. When you add
or change an endpoint, update both.

## Conventions

- **JSON.** Requests with a body send JSON (`Content-Type: application/json`), unless said otherwise, and every
  response is JSON. Dates and times are ISO 8601 strings, and days are `"YYYY-MM-DD"`.
- **Errors.** A request that fails gets a 4xx or 5xx status and an error: an object with `ok` set to `false` and
  `error`, a message meant for people, in English unless it's shown to the public (`ApiError` in
  `shared/src/error.ts`). Successful responses have `ok` set to `true`, except for those of `GET /api/config`,
  `GET /api/events`, `GET /api/radio` and `GET /api/radio/tracks/:id/stream`. Unknown paths under `/api` get a 404
  error.
- **Sessions.** Logging in sets a `session` cookie: a JWT signed by the server, HTTP-only, `SameSite=Lax`, `Secure` in
  production, which lasts 7 days. Endpoints marked "admin" require it, and fail with 401
  (`{"ok": false, "error": "Unauthorized"}`) without a valid one. Every admin can do everything: there are no roles.
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
| `GET /api/events` | public | Parking Radio's events, from Resident Advisor | `events.ts` |
| `GET /api/radio` | public | What's on the radio, and what comes next | `radio.ts` |
| `GET /api/radio/tracks/:id/stream` | public | Where to stream a track of the rotation from | `radio.ts` |
| `GET /api/admin/radio` | admin | The playlist the radio's rotation is read from | `radio.ts` |
| `POST /api/admin/radio/preview` | admin | What the radio would read from a playlist | `radio.ts` |
| `POST /api/admin/radio/playlist` | admin | Choosing the playlist the rotation is read from | `radio.ts` |

## Health and configuration

### `GET /healthz`

Checks that the database answers. Responds `{"ok": true}`, or 500 with `{"ok": false}` when it doesn't. Docker's
health check and the integration tests use it.

### `GET /api/config`

Values that depend on the environment, which the client reads before anything else (so it's public).

| Response field | Type | |
|---|---|---|
| `assetsDomain` | string | The domain serving the static assets, e.g. `"assets.parking.radio"` |

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

Sets the password of the admin `token` invites, and responds `{"ok": true}`. The invite can't be used again. Fails
with 400: missing fields, a password that's too short, or an invalid or expired invite.

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

Fails with 400 (`upcoming` isn't a whole number), 502 (the playlist can't be read from SoundCloud) or 503 (no
playlist has been chosen yet).

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
| `current` | object or null | The chosen playlist (below), or null until one has been chosen |

The chosen playlist has:

| Field | Type | |
|---|---|---|
| `url`, `title` | string | The playlist's link and title, as they were when it was chosen |
| `chosenBy` | string | The email of the admin who chose it |
| `chosenAt` | string | When |
| `playlist` | playlist or null | What the radio reads from it, or null when it couldn't be read yet |
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
there) or 502 (SoundCloud can't be reached).

### `POST /api/admin/radio/playlist` (admin)

| Request field | Type | |
|---|---|---|
| `link` | string | Like for the preview |

Reads the rotation from the playlist at `link` from now on, and responds `{"ok": true}`: its first track goes on air
right away. Fails like the preview, and with 400 when none of the playlist's tracks can be played in full.
