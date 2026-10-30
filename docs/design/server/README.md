# Server

The server provides the API under `/api`, which this directory specifies, and serves the client app.

## Conventions

- **JSON.** Requests with a body send JSON (`Content-Type: application/json`), unless said otherwise, and every
  response is JSON, except for photos. Dates and times are ISO 8601 strings, and days are `"YYYY-MM-DD"`. A body of a
  type the endpoint doesn't take fails with a 4xx, and the server refuses bodies other than `multipart/form-data` that
  are larger than any endpoint needs, with a 413. One exception: in production, nginx itself refuses requests whose
  body is over 12 MB, with a 413 that isn't JSON.
- **Text.** Text that endpoints keep or look up can't contain the NUL character (U+0000), which the database can't
  store: requests with it fail with 400 rather than having it removed.
- **Errors.** A request that fails, including one refused before an endpoint handles it (e.g. a body that isn't valid
  JSON), gets a 4xx or 5xx status and an error: an object with `ok` set to `false` and `error`, a message meant for
  people, in English unless it's shown to the public. The only exception is [`GET /healthz`](#get-healthz), which fails
  with `{"ok": false}` alone. An unexpected failure, e.g. the database's, gets a 500, unless the endpoint says
  otherwise. Either way, its message only says that something went wrong: what went wrong is logged, but without the
  personal data it could include, e.g. the values of a failed database query. Successful responses have `ok` set to
  `true`, except for those of `GET /api/config`, `GET /api/events`, `GET /api/radio` and
  `GET /api/radio/tracks/:id/stream`. Unknown paths under `/api` get a 404 error, whatever the request's body.
- **Admin endpoints.** Endpoints marked "admin", which are exactly those under `/api/admin/`, require an admin's session
  (see [Sessions](admins.md#sessions)), and fail with 401 (`{"ok": false, "error": "Unauthorized"}`) without a valid
  one. That's the only reason they ever fail with 401, so callers can take it to mean that there's no session. Admin
  requests other than `GET` that a browser says come from another origin, in `Sec-Fetch-Site` or else `Origin`, fail
  with 403.
- **Rate limits.** A few endpoints limit how many requests each client makes. Clients are told apart by their
  address: `CF-Connecting-IP` when it's there, or else the connection's. That header can be trusted since, in
  production, requests only reach the server through Cloudflare, which sets it, and nginx. IPv6 addresses count by
  their /64 prefix, since a client is usually given a whole range of them. Over the limit, clients get a 429 error.
- **Emails.** The server sends emails from `noreply@<MAIL_DOMAIN>`. When `MAIL_DOMAIN` isn't set, e.g. in development,
  it doesn't send any.
- **Lists.** A field that takes one of a list of values, e.g. an artist's genres, only ever holds values of that list,
  in responses as in requests. So removing a value from a list, or renaming one, has to change the stored data that
  still uses it, in the same change: until then, every response that would include the old value fails.

Requests and responses are described field by field. A field whose type says "or null" is always there, but can be
`null`.

## Serving the client

The server serves the client's build: its files as they are, and the app, with a 200 status, for any other `GET` or
`HEAD` request outside `/api` and `/assets`, where the build's files are. The app then shows the page for that path.
This includes paths that aren't one of the app's pages (a "soft 404", see [Page introuvable](../client/not-found.md)),
since the server doesn't know which pages the app has. Other requests for paths that don't exist, whatever their body,
and files that don't exist under `/assets`, get a 404 error.

The names of the files under `/assets` change with their content, so they can be cached for good. The app itself is
checked again every time it's loaded, so that a deploy shows right away.

## `GET /healthz`

Checks that the database answers. Responds `{"ok": true}`, or 500 with `{"ok": false}` when it doesn't. The deploy
workflow and the integration tests use it. Be careful about polling it continuously (e.g. Docker's `HEALTHCHECK`, or an
uptime monitor), since every request queries the database.

## `GET /api/config`

Values that depend on the environment, which the client needs. It's public, since the client needs them before there's
a session.

| Response field | Type | |
|---|---|---|
| `assetsDomain` | string | The domain serving the static assets, e.g. `"assets.parking.radio"` |
| `turnstileSiteKey` | string | The site key of the Cloudflare Turnstile widget, which gives pages the token `POST /api/applications` asks for (see [Applying](applications.md#applying)) |
| `features` | object | Whether each feature flag is on (`true`) or off (`false`), by id, e.g. `{"some-flag": true}`. A flag that isn't there is off (see [Features](features.md)) |

The response is never cached (`Cache-Control: no-store`), so that switching a feature flag takes effect for every page
loaded after that. When the flags can't be read from the database, `features` is empty, so they're all off, rather than
the request failing.

## Endpoints

| Endpoint | Access | What it's for |
|---|---|---|
| [`GET /healthz`](#get-healthz) | public | Whether the server and its database work |
| [`GET /api/config`](#get-apiconfig) | public | Environment-specific values the client needs |
| [`POST /api/auth/login`](admins.md#post-apiauthlogin) | public | Logging in as an admin |
| [`POST /api/auth/logout`](admins.md#post-apiauthlogout) | public | Logging out |
| [`POST /api/auth/accept-invite`](admins.md#post-apiauthaccept-invite) | public | Setting an invited admin's password |
| [`GET /api/admin/me`](admins.md#get-apiadminme-admin) | admin | The logged-in admin |
| [`POST /api/admin/invite`](admins.md#post-apiadmininvite-admin) | admin | Inviting a new admin by email |
| [`GET /api/admin/admins`](admins.md#get-apiadminadmins-admin) | admin | Every admin, and whether they accepted their invite |
| [`DELETE /api/admin/admins/:id`](admins.md#delete-apiadminadminsid-admin) | admin | Revoking an admin |
| [`GET /api/radio`](radio.md#get-apiradioupcomingn) | public | What's on the radio, and what comes next |
| [`GET /api/radio/tracks/:id/stream`](radio.md#get-apiradiotracksidstream) | public | Where to stream a track of the rotation from |
| [`GET /api/admin/radio`](radio.md#get-apiadminradio-admin) | admin | The playlist the radio's rotation is read from |
| [`POST /api/admin/radio/preview`](radio.md#post-apiadminradiopreview-admin) | admin | What the radio would read from a playlist |
| [`POST /api/admin/radio/playlist`](radio.md#post-apiadminradioplaylist-admin) | admin | Choosing the playlist the rotation is read from |
| [`GET /api/admin/radio/credentials`](radio.md#get-apiadminradiocredentials-admin) | admin | The SoundCloud app the radio reads playlists through |
| [`PUT /api/admin/radio/credentials`](radio.md#put-apiadminradiocredentials-admin) | admin | Entering the credentials of that SoundCloud app |
| [`POST /api/admin/radio/credentials/check`](radio.md#post-apiadminradiocredentialscheck-admin) | admin | Whether SoundCloud accepts credentials, without saving them |
| [`GET /api/admin/artists`](artists.md#get-apiadminartists-admin) | admin | Every artist |
| [`GET /api/admin/artists/:id`](artists.md#get-apiadminartistsid-admin) | admin | An artist |
| [`GET /api/admin/artists/:id/photo`](artists.md#get-apiadminartistsidphoto-admin) | admin | An artist's photo |
| [`POST /api/admin/artists`](artists.md#post-apiadminartists-admin) | admin | Adding an artist, with or without a photo |
| [`PUT /api/admin/artists/:id`](artists.md#put-apiadminartistsid-admin) | admin | Changing an artist's profile, or replacing or removing their photo |
| [`DELETE /api/admin/artists/:id`](artists.md#delete-apiadminartistsid-admin) | admin | Deleting an artist, their photo and their applications |
| [`GET /api/admin/applications`](applications.md#get-apiadminapplicationsartistid-admin) | admin | Every application, or an artist's |
| [`GET /api/admin/applications/:id`](applications.md#get-apiadminapplicationsid-admin) | admin | An application |
| [`POST /api/admin/applications`](applications.md#post-apiadminapplications-admin) | admin | Creating an application for an artist |
| [`PUT /api/admin/applications/:id`](applications.md#put-apiadminapplicationsid-admin) | admin | Changing an application |
| [`PUT /api/admin/applications/:id/status`](applications.md#put-apiadminapplicationsidstatus-admin) | admin | Accepting or rejecting an application |
| [`DELETE /api/admin/applications/:id`](applications.md#delete-apiadminapplicationsid-admin) | admin | Deleting an application |
| [`POST /api/applications`](applications.md#post-apiapplications) | public | A new artist applying, with their profile and maybe a photo |
| [`GET /api/admin/applications/recipients`](applications.md#get-apiadminapplicationsrecipients-admin) | admin | Who applications from artists are emailed to |
| [`PUT /api/admin/applications/recipients`](applications.md#put-apiadminapplicationsrecipients-admin) | admin | Choosing who applications from artists are emailed to |
| [`GET /api/events`](events.md#get-apievents) | public | Parking Radio's events, from Resident Advisor |
| [`GET /api/admin/features`](features.md#get-apiadminfeatures-admin) | admin | Every feature flag, and whether it's on |
| [`PUT /api/admin/features/:id`](features.md#put-apiadminfeaturesid-admin) | admin | Turning a feature flag on or off |
