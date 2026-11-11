# Server

The server provides the API under `/api`, which this directory specifies, and the [MCP server](mcp.md) at `/mcp`, which
apps connect to through [OAuth](oauth.md), and serves the client app.

## Conventions

- **JSON.** Requests with a body send JSON (`Content-Type: application/json`), unless said otherwise, and every response
  is JSON, except for photos and flyers. A body of a type the endpoint doesn't take fails with a 4xx, and the server
  refuses bodies other than `multipart/form-data` that are larger than any endpoint needs, with a 413. One exception: in
  production, nginx itself refuses requests whose body is over 52 MB, with a 413 that isn't JSON: that's room for a
  collective's application with 5 photos.
- **Times.** Parking Radio is in Québec City, so times are in Québec time, the `America/Toronto` time zone, with
  daylight saving time. Instants, e.g. when something was created, or a session's start, are dates and times in Québec
  time, with the offset from UTC in effect in Québec at that instant: since 2007, -05:00, or -04:00 from the second
  Sunday of March at 2:00 to the first Sunday of November at 2:00. Requests send them as
  `YYYY-MM-DDTHH:MM[:SS[.fraction]]±HH:MM`, e.g. `"2026-11-14T21:00-05:00"`, or `"2026-07-01T12:00-04:00"` in summer.
  Any other offset fails with 400, `Z` included: so a time that the clocks skip in spring can't be sent, while one they
  show twice in the fall is sent with either offset, each its own instant. Responses give them as
  `YYYY-MM-DDTHH:MM:SS±HH:MM`, to the second, with the fraction of a second dropped, e.g. `"2026-11-14T21:00:00-05:00"`.
  Days are `"YYYY-MM-DD"`, and times of day `"HH:MM"`, from `"00:00"` to `"23:59"`, both in Québec time, without an
  offset, e.g. an application's `dates` and `timeSlots`. Events' `start` and `end` are instants too: Resident Advisor
  gives them as local times, which the server reads in the time zone of the event's venue (see
  [Events](events.md#times)).
- **Text.** Text that endpoints keep or look up can't contain the NUL character (U+0000), which the database can't
  store: requests with it fail with 400 rather than having it removed.
- **Names.** The API's paths, query parameters and fields, and the values they take from fixed lists (e.g. statuses,
  `"live-performance"`), are in English, whatever language the pages that use them are in; so are the MCP tools'
  arguments, which are the fields. E.g. an application's `performanceTypes`, which the Appliquer page calls "Type de
  prestation". Messages aren't names: see Errors, below.
- **Errors.** A request that fails, including one refused before an endpoint handles it (e.g. a body that isn't valid
  JSON), gets a 4xx or 5xx status and an error: an object with `ok` set to `false` and `error`, a message meant for
  people, in English unless it's shown to the public. The only exception is [`GET /healthz`](#get-healthz), which fails
  with `{"ok": false}` alone. Some errors have other fields too, which their endpoints say, e.g. the 409s of the
  endpoints of sessions and sets have what's in the way (see [Rules](sessions.md#rules)). An unexpected failure, e.g.
  the database's, gets a 500, unless the endpoint says otherwise. Either way, its message only says that something went
  wrong: what went wrong is logged, but without the personal data it could include, e.g. the values of a failed
  database query. Successful responses have `ok` set to `true`, except for those of `GET /api/config`,
  `GET /api/events`, `GET /api/radio`, `GET /api/radio/tracks/:id/stream` and `GET /api/video`. Unknown paths under
  `/api` get a 404 error, whatever the request's body. What apps call for OAuth and MCP has its own errors (see below).
- **OAuth and MCP.** What apps call follows its standards rather than the conventions above: the endpoints that get and
  revoke tokens take forms (`application/x-www-form-urlencoded`), and they and the metadata documents under
  `/.well-known` answer without `ok`, with OAuth's errors (`error` and `error_description`), while `/mcp` answers in
  JSON-RPC (see [OAuth](oauth.md) and [MCP server](mcp.md)).
- **Logs.** Every request is logged with its method, its path, its status and how long it took, but not the values of
  its query string, which can be secrets. Those to `/mcp`, whose path is always the same, are logged with their
  JSON-RPC method, the name of the tool they call, and the connection and user they come from. Unless a request failed
  unexpectedly (see Errors above), why it failed is logged too: its error's message, and for a tool that fails, whose
  request still gets a 200, the tool's status too. So the server's messages never include personal data, or values the
  request sent, though they can name things, e.g. a field. Bodies, tokens, and tools' arguments other than the ids in
  their paths are never logged.
- **Admin endpoints.** Endpoints marked "admin", which are exactly those under `/api/admin/`, require an admin's session
  (see [Sessions](admins.md#sessions)), and fail with 401 (`{"ok": false, "error": "Unauthorized"}`) without a valid
  one. That's the only reason they ever fail with 401, so callers can take it to mean that there's no session. Admin
  requests other than `GET` that a browser says come from another origin, in `Sec-Fetch-Site` or else `Origin`, fail
  with 403. The tokens of apps (see [OAuth](oauth.md)) don't work there: they only work at `/mcp`.
- **Totals.** The admin endpoints that list a collection, e.g. `GET /api/admin/artists`, give `total` with their list:
  how many items it has. Lists inside something else, e.g. a session's sets, don't have one.
- **Rate limits.** A few endpoints limit how many requests each client makes. Clients are told apart by their
  address: `CF-Connecting-IP` when it's there, or else the connection's. That header can be trusted since, in
  production, requests only reach the server through Cloudflare, which sets it, and nginx. IPv6 addresses count by
  their /64 prefix, since a client is usually given a whole range of them. Over the limit, clients get a 429 error.
  The endpoints that apps call for OAuth and MCP have none: their tokens can't be guessed, and apps like Claude send
  their requests from their own servers, which share a few addresses.
- **Emails.** The server sends emails from `noreply@<MAIL_DOMAIN>`. When `MAIL_DOMAIN` isn't set, e.g. in development,
  it doesn't send any.
- **Lists.** A field that takes one of a list of values, e.g. an artist's genres, only ever holds values of that list,
  in responses as in requests. So removing a value from a list, or renaming one, has to change the stored data that
  still uses it, in the same change: until then, every response that would include the old value fails.
- **Unknown fields.** The admin endpoints of artists, collectives, applications, sessions and sets refuse the fields they
  don't take in the JSON they're sent: its body, or the part of a `multipart/form-data` request that has an item's
  fields, e.g. an artist's profile. Such a request fails with 400, and the error names the field: otherwise, a
  misspelled field would go unnoticed. That's only the top-level fields of that JSON: the objects in it follow their own
  rules, e.g. the other fields of a collective's members are ignored. The parts of a `multipart/form-data` request that
  the endpoint doesn't read are ignored too, e.g. a form's submit button.
- **Changes.** An artist, a collective, an application, a session or a set is changed with `PUT`, which replaces its
  fields, all of them sent, or with `PATCH`, which only changes the fields it's sent, and leaves the others as they are.
  `PATCH` takes JSON, never `multipart/form-data`, with any of the fields its `PUT` takes, at least one, each following
  the same rules: a field that's sent replaces the item's as a whole, even a list or an object, e.g. an artist's
  `links`, rather than being merged into it, and null, or a blank string, where `PUT` takes it, removes it the same way.
  The rules that involve several fields, or other items, e.g. a takeover's collective, or sessions not overlapping, are
  checked on the item as it would then be, with the fields that weren't sent as they are. A `PATCH` without any field
  fails with 400. Both set `updatedBy` and `updatedAt`, even when nothing actually changes.

Requests and responses are described field by field. A field whose type says "or null" is always there, but can be
`null`.

## Serving the client

The server serves the client's build: its files as they are, and the app, with a 200 status, for any other `GET` or
`HEAD` request outside `/api`, `/assets`, where the build's files are, `/mcp` and `/.well-known`, where the metadata
documents of [OAuth](oauth.md) are. The app then shows the page for that path. This includes paths that aren't one of
the app's pages (a "soft 404", see [Page introuvable](../client/not-found.md)), since the server doesn't know which
pages the app has. Other requests for paths that don't exist, whatever their body, and paths that don't exist under
`/assets` and `/.well-known`, e.g. `/.well-known/openid-configuration`, get a 404 error (see
[Conventions](#conventions)).

Other sites can't show the app in a frame (`X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors
'none'`), so that they can't trick admins into clicking its buttons, e.g. to allow an app (see
[Autoriser une application](../client/admin/autoriser.md)).

The names of the files under `/assets` change with their content, so they can be cached for good. The app itself is
checked again every time it's loaded, so that a deploy shows right away, and so are its other files, e.g.
`/ra-bookmarklet.js`, the script of the bookmarklet that creates sessions' events on RA (see
[Publier sur RA](../client/admin/publier-sur-ra.md)), whose path doesn't change. RA's pages load it, as a classic
script, which needs no CORS: it's public, and holds no secrets.

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
| `environment` | string | The server's environment: the deployment it's part of, e.g. `production` or `test`, or `development` when it isn't told one (see [deployment.md](../../deployment.md#deploying-the-web-app)) |
| `features` | object | Whether each feature flag is on (`true`) or off (`false`), by id, e.g. `{"some-flag": true}`. A flag that isn't there is off (see [Features](features.md)) |

The response is never cached (`Cache-Control: no-store`), so that switching a feature flag takes effect for every page
loaded after that. When the flags can't be read from the database, `features` is empty, so they're all off, rather than
the request failing.

## Endpoints

Endpoints are public, admin (see [Conventions](#conventions)), or for apps, which need a connection's token (see
[Authorization](mcp.md#authorization)).

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
| [`GET /.well-known/oauth-protected-resource/mcp`](oauth.md#get-well-knownoauth-protected-resourcemcp) | public | Where apps get tokens for the MCP server |
| [`GET /.well-known/oauth-authorization-server`](oauth.md#get-well-knownoauth-authorization-server) | public | The OAuth endpoints, and what they support |
| [`GET /api/admin/oauth/authorization`](oauth.md#get-apiadminoauthauthorization-admin) | admin | What allowing an app would grant |
| [`POST /api/admin/oauth/authorization`](oauth.md#post-apiadminoauthauthorization-admin) | admin | Allowing an app, or refusing |
| [`POST /api/oauth/token`](oauth.md#post-apioauthtoken) | public | An app getting tokens for its connection |
| [`POST /api/oauth/revoke`](oauth.md#post-apioauthrevoke) | public | An app ending its connection |
| [`GET /api/admin/connections`](oauth.md#get-apiadminconnections-admin) | admin | The logged-in admin's connected apps |
| [`DELETE /api/admin/connections/:id`](oauth.md#delete-apiadminconnectionsid-admin) | admin | Disconnecting one of them |
| [`POST /mcp`](mcp.md#the-endpoint) | app | The MCP server, for connected apps |
| [`GET /api/radio`](radio.md#get-apiradioupcomingn) | public | What's on the radio, and what comes next |
| [`GET /api/radio/tracks/:id/stream`](radio.md#get-apiradiotracksidstream) | public | Where to stream a track of the rotation from |
| [`GET /api/admin/radio`](radio.md#get-apiadminradio-admin) | admin | The playlist the radio's rotation is read from |
| [`POST /api/admin/radio/preview`](radio.md#post-apiadminradiopreview-admin) | admin | What the radio would read from a playlist |
| [`POST /api/admin/radio/playlist`](radio.md#post-apiadminradioplaylist-admin) | admin | Choosing the playlist the rotation is read from |
| [`GET /api/admin/radio/credentials`](radio.md#get-apiadminradiocredentials-admin) | admin | The SoundCloud app the server reads SoundCloud through |
| [`PUT /api/admin/radio/credentials`](radio.md#put-apiadminradiocredentials-admin) | admin | Entering the credentials of that SoundCloud app |
| [`POST /api/admin/radio/credentials/check`](radio.md#post-apiadminradiocredentialscheck-admin) | admin | Whether SoundCloud accepts credentials, without saving them |
| [`GET /api/video`](video.md#get-apivideo) | public | The video the site shows now |
| [`GET /api/admin/video/credentials`](video.md#get-apiadminvideocredentials-admin) | admin | The YouTube channel the server reads the video from, and why the last read failed, if it did |
| [`PUT /api/admin/video/credentials`](video.md#put-apiadminvideocredentials-admin) | admin | Entering the YouTube channel and the key it's read with |
| [`POST /api/admin/video/credentials/check`](video.md#post-apiadminvideocredentialscheck-admin) | admin | Whether YouTube accepts a key and finds a channel, without saving them |
| [`GET /api/admin/artists`](artists.md#get-apiadminartistscollectiveid-admin) | admin | Every artist, or a collective's |
| [`GET /api/admin/artists/:id`](artists.md#get-apiadminartistsid-admin) | admin | An artist |
| [`GET /api/admin/artists/:id/photo`](artists.md#get-apiadminartistsidphoto-admin) | admin | An artist's photo |
| [`POST /api/admin/artists`](artists.md#post-apiadminartists-admin) | admin | Adding an artist, with or without a photo |
| [`PUT /api/admin/artists/:id`](artists.md#put-apiadminartistsid-admin) | admin | Replacing an artist's profile, and replacing or removing their photo |
| [`PATCH /api/admin/artists/:id`](artists.md#patch-apiadminartistsid-admin) | admin | Changing an artist's profile, only the fields it's sent, or removing their photo |
| [`DELETE /api/admin/artists/:id`](artists.md#delete-apiadminartistsid-admin) | admin | Deleting an artist, their photo and their applications, and taking them out of their collectives and their sets |
| [`GET /api/admin/collectives`](collectives.md#get-apiadmincollectives-admin) | admin | Every collective |
| [`GET /api/admin/collectives/:id`](collectives.md#get-apiadmincollectivesid-admin) | admin | A collective |
| [`GET /api/admin/collectives/:id/photo`](collectives.md#get-apiadmincollectivesidphoto-admin) | admin | A collective's photo |
| [`POST /api/admin/collectives`](collectives.md#post-apiadmincollectives-admin) | admin | Adding a collective, with or without a photo, and the members it names |
| [`PUT /api/admin/collectives/:id`](collectives.md#put-apiadmincollectivesid-admin) | admin | Replacing a collective's profile and members, and replacing or removing its photo |
| [`PATCH /api/admin/collectives/:id`](collectives.md#patch-apiadmincollectivesid-admin) | admin | Changing a collective's profile or members, only the fields it's sent, or removing its photo |
| [`DELETE /api/admin/collectives/:id`](collectives.md#delete-apiadmincollectivesid-admin) | admin | Deleting a collective without takeovers, its photo and its applications, but not its members |
| [`GET /api/admin/applications`](applications.md#get-apiadminapplicationsartistidcollectiveid-admin) | admin | Every application, or an artist's or a collective's |
| [`GET /api/admin/applications/:id`](applications.md#get-apiadminapplicationsid-admin) | admin | An application |
| [`POST /api/admin/applications`](applications.md#post-apiadminapplications-admin) | admin | Creating an application for an artist or a collective |
| [`PUT /api/admin/applications/:id`](applications.md#put-apiadminapplicationsid-admin) | admin | Replacing an application's fields |
| [`PATCH /api/admin/applications/:id`](applications.md#patch-apiadminapplicationsid-admin) | admin | Changing an application, only the fields it's sent |
| [`PUT /api/admin/applications/:id/status`](applications.md#put-apiadminapplicationsidstatus-admin) | admin | Accepting or rejecting an application |
| [`DELETE /api/admin/applications/:id`](applications.md#delete-apiadminapplicationsid-admin) | admin | Deleting an application |
| [`POST /api/applications`](applications.md#post-apiapplications) | public | A new artist or collective applying, with their profile and maybe a photo |
| [`GET /api/admin/applications/recipients`](applications.md#get-apiadminapplicationsrecipients-admin) | admin | Who applications from artists are emailed to |
| [`PUT /api/admin/applications/recipients`](applications.md#put-apiadminapplicationsrecipients-admin) | admin | Choosing who applications from artists are emailed to |
| [`GET /api/admin/sessions`](sessions.md#get-apiadminsessions-admin) | admin | Every session, or those with a set an artist played, or a collective's takeovers, only those that start in a time range when one is given, with their sets |
| [`GET /api/admin/sessions/:id`](sessions.md#get-apiadminsessionsid-admin) | admin | A session, with its sets |
| [`GET /api/admin/sessions/:id/ra-event`](sessions.md#get-apiadminsessionsidra-event-admin) | admin | The content of a session's event on Resident Advisor |
| [`GET /api/admin/sessions/:id/flyer`](sessions.md#get-apiadminsessionsidflyer-admin) | admin | A session's flyer |
| [`POST /api/admin/sessions`](sessions.md#post-apiadminsessions-admin) | admin | Adding a session, with or without a flyer |
| [`PUT /api/admin/sessions/:id`](sessions.md#put-apiadminsessionsid-admin) | admin | Replacing a session's fields, and replacing or removing its flyer |
| [`PATCH /api/admin/sessions/:id`](sessions.md#patch-apiadminsessionsid-admin) | admin | Changing a session, only the fields it's sent, or removing its flyer |
| [`PUT /api/admin/sessions/:id/status`](sessions.md#put-apiadminsessionsidstatus-admin) | admin | Marking a session as planned, done or cancelled |
| [`DELETE /api/admin/sessions/:id`](sessions.md#delete-apiadminsessionsid-admin) | admin | Deleting a session, its flyer and its sets |
| [`POST /api/admin/sessions/:id/sets`](sessions.md#post-apiadminsessionsidsets-admin) | admin | Adding a set to a session |
| [`PUT /api/admin/sets/:id`](sessions.md#put-apiadminsetsid-admin) | admin | Replacing a set's fields |
| [`PATCH /api/admin/sets/:id`](sessions.md#patch-apiadminsetsid-admin) | admin | Changing a set, only the fields it's sent |
| [`PUT /api/admin/sets/:id/status`](sessions.md#put-apiadminsetsidstatus-admin) | admin | Marking a set as planned, done or cancelled |
| [`DELETE /api/admin/sets/:id`](sessions.md#delete-apiadminsetsid-admin) | admin | Deleting a set |
| [`GET /api/events`](events.md#get-apievents) | public | Parking Radio's events, from Resident Advisor: the upcoming ones and the 20 most recent past ones, or every one that starts in a time range when one is given |
| [`GET /api/admin/features`](features.md#get-apiadminfeatures-admin) | admin | Every feature flag, and whether it's on |
| [`PUT /api/admin/features/:id`](features.md#put-apiadminfeaturesid-admin) | admin | Turning a feature flag on or off |
