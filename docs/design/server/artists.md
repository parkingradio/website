# Artists

The artists Parking Radio knows of, which are the artists who applied, and their applications for a set.

## Profiles

An artist is an artist or a collective. Each one has a profile, and maybe a photo, and is a row of the `artists` table
(`server/src/schema.ts`). An artist is known by their email: two artists can't have the same one, whatever its case.

The rules a profile has to follow are the schemas of `server/src/artist-profile.ts` (`ArtistProfile`, and
`AdminArtistProfile` for admins), and the server checks every profile it's sent against them. The server explains
what's wrong with a profile or a photo in French, unlike its other admin errors, because artists see the same messages
when they apply.

Admins can leave out more than artists: the admin endpoints take profiles without a country, city, genres, links or
phone, since admins bring in artists who applied elsewhere, e.g. through the original Google Form, which didn't always
ask for them. What's left out is stored as an empty string, or an empty list or object. `POST /api/applications`
requires all of them.

A profile has:

| Field | Type | |
|---|---|---|
| `kind` | `"artist"` or `"collective"` | An artist usually gets an hour of a time slot, a collective a whole slot |
| `name` | string | The artist's name, or the collective's. Up to 100 characters |
| `members` | list of strings | For a collective, the names of the artists representing it, at least one, each up to 100 characters. Empty for an artist |
| `country` | string | ISO 3166-1 alpha-2 code, e.g. `"CA"` (one of `COUNTRIES` in `server/src/artist-profile.ts`), or `""` when an admin left it out |
| `city` | string | As the artist wrote it. Up to 100 characters, or `""` when an admin left it out |
| `genres` | list of strings | The ids of at least one of `GENRES` in `server/src/artist-profile.ts` (e.g. `"drum-and-bass"`), most important first, or none when an admin left them out |
| `bio` | string | Up to 5000 characters |
| `links` | object | By site (`soundcloud`, `instagram`, `web`, `bandcamp`, `mixcloud`, `ra`, `youtube`, `spotify`, `tiktok`), at least one, or none when an admin left them out: see below |
| `email` | string | What the artist is known by. Up to 200 characters |
| `phone` | string | At least 7 digits. Up to 40 characters, or `""` when an admin left it out |

Links are stored as profile names, which the server reduces what was typed or pasted to: e.g.
`https://soundcloud.com/parkingdotradio/sets/x` is stored as `parkingdotradio`. For `web`, it's the address itself.
Either is up to 200 characters. `linkSite(id).url(value)`, in `server/src/artist-profile.ts`, turns a profile name back
into an address.

An artist, as the endpoints below return them, is their profile with:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `createdAt` | string | When the artist was added |
| `createdBy` | string or null | The email of the admin who added the artist, or null when they added themselves, by applying |
| `updatedBy` | string or null | The email of the admin who last changed the artist |
| `updatedAt` | string or null | When |
| `hasPhoto` | boolean | Whether the artist has a photo |

## Photos

An artist's photo is optional. It's a JPEG, PNG or WebP image of up to 10 MB, whose type is checked from its contents.
It's kept in the app's private S3 bucket, or in a local directory in development, and only the server reads it. When
the artist is deleted, or the photo is replaced or removed, it's deleted too: it stays in the bucket's previous versions
for as long as the database's backups are kept, like the artist's row, and is gone for good after that.

## `GET /api/admin/artists` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artists` | list of artists | By name, whatever its case |

## `GET /api/admin/artists/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artist` | artist | |

Fails with 404 when there's no such artist.

## `GET /api/admin/artists/:id/photo` (admin)

Responds with the photo itself, with the type it was checked to have, rather than JSON. Browsers are told not to
guess another type (`X-Content-Type-Options: nosniff`) or to keep it (`Cache-Control: private, no-store`). Fails with
404 when there's no such artist, when they have no photo, or when their photo is missing.

## `POST /api/admin/artists` (admin)

Adds an artist. It's `multipart/form-data`, with two parts: `artist`, the profile as JSON, in a field rather than a
file, and `photo`, the artist's photo, which can be left out. A few other fields or files, e.g. a form's submit button,
are ignored. A second photo isn't: the request fails.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artist` | artist | As they were added |

Fails with 400 (an invalid profile or photo, or a malformed request), 409 (another artist has that email) or 413 (a
photo larger than 10 MB).

## `PUT /api/admin/artists/:id` (admin)

Replaces an artist's profile. It takes the same request as `POST /api/admin/artists`. With a photo, it replaces the
artist's, which is deleted. Without one, the artist keeps theirs, unless there's also a `removePhoto` field set to
`true`, which removes it, and deletes it. Responds like `POST /api/admin/artists`, with the artist as they are then,
and fails like it, with 400 when there's both a photo and `removePhoto`, and with 404 when there's no such artist.

## `DELETE /api/admin/artists/:id` (admin)

Deletes an artist, their photo if they have one and their applications, and responds `{"ok": true}`. Fails with 404
when there's no such artist.

## Applications

An application says when the artist would like to play and what they'd do. Applications are stored in the
`applications` table (`server/src/schema.ts`). Each one belongs to an artist, and is deleted when the artist is
deleted.

The server checks every application against the rules in `shared/src/applications.ts` (`checkApplication`). These
rules only make sure the data is valid. Suggestions and limits, like which dates or time slots to offer, are up to the
forms. Error messages are in French, like for profiles, because artists see them.

Applications are created in two ways:

- A new artist applies with `POST /api/applications`, which creates the artist and their application together (see
  [Applying](#applying)).
- An admin creates an application, for an artist who already exists, e.g. to bring in one that came by email, or
  through the original Google Form.

An application has these fields:

| Field | Type | |
|---|---|---|
| `dates` | list of strings | The days the artist would like to play, sorted. At least one. Past days are allowed, e.g. to import old applications |
| `timeSlots` | list of objects | The times of day that work for the artist, on any of their dates, sorted. Each one has a `start` and an `end` in Québec time, `"HH:MM"`, e.g. `{"start": "18:00", "end": "22:00"}`. The end is later the same day. An empty list means any time |
| `prestations` | list of strings | What the artist would do: ids from `PRESTATIONS` in `shared/src/applications.ts`, e.g. `"dj"` or `"live-performance"`. Requests can list them in any order, even more than once, and other values are refused with 400. Responses list them in the order of `PRESTATIONS`. Can be empty |
| `otherPrestation` | string | Anything else the artist would do, in a few words, e.g. `"Synthé modulaire"`. Up to 60 characters. Can be empty |
| `details` | string | The artist's questions or other details. Up to 2000 characters. Can be empty |

What an artist would do is stored as an id that doesn't change, so that applications can be told apart by what the
artists would do, whatever its name, e.g. once it's translated.

The endpoints below also return these fields:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `artistId` | string | The artist who applied |
| `receivedAt` | string | When the artist sent the application, which isn't always when it was created: one that came by email, or through the original Google Form, can be brought in long after. For one sent through `POST /api/applications`, that's when it was created. For one an admin created, it's what the admin said, or else when it was created. Admins can change it either way |
| `createdAt` | string | When the application was created |
| `createdBy` | string or null | The email of the admin who created the application, or null if the artist sent it themselves |
| `updatedBy`, `updatedAt` | string or null | Who last changed the application (an admin's email), and when. Status changes don't count |
| `status` | `"new"`, `"accepted"`, `"scheduled"`, `"done"` or `"rejected"` | See below |
| `statusUpdatedBy`, `statusUpdatedAt` | string or null | Who last changed the status (an admin's email), and when |

Every application starts as `"new"`, then is `"accepted"` or `"rejected"` as an admin decides, and an accepted one is
`"scheduled"` once a date has been set with the artist, then `"done"` once they've played. That's only the usual order:
admins can change a status to any other.

## `GET /api/admin/applications[?artist=<id>]` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `applications` | list of applications | The most recently received first (by `receivedAt`, then `createdAt`). With `artist`, only that artist's applications. An unknown artist has none |

## `GET /api/admin/applications/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `application` | application | |

Fails with 404 if the application doesn't exist.

## `POST /api/admin/applications` (admin)

Creates an application for an existing artist. The request has the application's fields, plus:

| Request field | Type | |
|---|---|---|
| `artistId` | string | The id of the artist who's applying |
| `receivedAt` | string, optional | When the artist sent the application: a date and time with its offset from UTC, e.g. `"2026-03-28T14:03:00Z"` or `"2026-03-28T10:03:00-04:00"`, which can't be in the future. Now if it's left out |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `application` | application | The new application |

Fails with 400 if the application or `receivedAt` isn't valid (with a message in French), or the artist doesn't exist.

## `PUT /api/admin/applications/:id` (admin)

Replaces an application's fields. The request is the same as for `POST /api/admin/applications`, without `artistId`,
and leaving `receivedAt` out keeps the one the application has. The artist and the status don't change. The response
is the same as for `POST /api/admin/applications`, with the updated application. Fails with 400 if the application or
`receivedAt` isn't valid, or 404 if it doesn't exist.

## `PUT /api/admin/applications/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"new"`, `"accepted"`, `"scheduled"`, `"done"` or `"rejected"` | |

Changes an application's status. The response is the same as for `POST /api/admin/applications`. Fails with 400 if
`status` isn't one of these values, or 404 if the application doesn't exist.

## `DELETE /api/admin/applications/:id` (admin)

Deletes an application, and responds `{"ok": true}`. The artist stays. Fails with 404 if the application doesn't exist.

## Applying

A new artist applies with `POST /api/applications`, which creates the artist, with their profile and photo, if they
sent one, and their application. The artist's `createdBy` and the application's are both null, since nobody on the team
created them.

Anyone can call this endpoint, so it has two protections against bots and floods:

- **Cloudflare Turnstile.** The page shows Turnstile's widget, using the site key from `GET /api/config`. Once the
  visitor passes Turnstile's check, the widget gives the page a token, which the page sends with the application. The
  server then asks Cloudflare whether the token is valid.
- **A rate limit.** Each client can send 5 requests per hour. Requests that fail count too.

**Only new artists can apply this way.** If an artist with the same email already exists (ignoring upper and lower
case), the request fails with 409 and nothing is created. Otherwise, anyone could take over an artist's profile just by
typing their email. The downside is that the 409 tells whoever sent the request that this email belongs to an artist.
To make that harder to abuse, the server only checks the email after Turnstile has accepted the token.

**When the page needs a new token.** Cloudflare only accepts each token once. To let artists fix their mistakes, the
server checks the profile, the application and the photo before it sends the token to Cloudflare. So if the request
fails because one of those isn't valid, the page can send it again with the same token. After any other error, the
token may already be used up, and the page needs to get a new one from the widget.

## `POST /api/applications`

A new artist applies (see [Applying](#applying)). The request is `multipart/form-data`, with four parts:

| Part | |
|---|---|
| `artist` | The artist's profile, with everything an admin could leave out, as JSON, in a field rather than a file |
| `application` | The application's fields, as JSON, the same way |
| `photo` | The artist's photo, which can be left out |
| `turnstileToken` | The token Turnstile gave the page |

A few other fields or files, e.g. a form's submit button, are ignored. A second photo isn't: the request fails. On
success, the response is `{"ok": true}`, and the emails are sent (see [Emails](#emails)).

Errors are in French, since artists see them:

| Status | When |
|---|---|
| 400 | The profile, application or photo isn't valid, the request is malformed, or Turnstile refused the token |
| 409 | An artist with that email already exists |
| 413 | The photo is larger than 10 MB, or the request is too large to be an application |
| 429 | The client sent too many requests |
| 502 | Cloudflare couldn't be reached, or couldn't check the token |

## Emails

Once an application sent with `POST /api/applications` is saved, the server sends two emails, in French, from the
server's address (see [Conventions](README.md#conventions)):

- To the recipients chosen by admins (see `GET /api/admin/applications/recipients`): everything the artist sent,
  except their photo, which admins can see with the artist. Replying to it answers the artist. When nobody was chosen,
  it isn't sent: applications are only saved, and confirmed to the artist.
- To the artist: a confirmation that the application was received. Replying to it answers the recipients, if there
  are any. It goes to whatever address the application has, so it doesn't repeat anything the artist wrote: otherwise,
  anyone could have the server send their own text to any address.

Emails that can't be sent are only logged: the application is saved either way, and the request still succeeds.
Applications that admins create aren't emailed.

## `GET /api/admin/applications/recipients` (admin)

Who applications sent with `POST /api/applications` are emailed to (see [Emails](#emails)).

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `recipients` | list of strings | Email addresses. Empty until admins choose them |
| `updatedBy`, `updatedAt` | string or null | Who last changed the recipients (an admin's email), and when |

## `PUT /api/admin/applications/recipients` (admin)

| Request field | Type | |
|---|---|---|
| `recipients` | list of strings | Email addresses, up to 10. They're trimmed, and blanks and duplicates (ignoring upper and lower case) are dropped. Empty means nobody |

Replaces the recipients, and responds like `GET /api/admin/applications/recipients`. Fails with 400 if `recipients`
isn't a list of strings, if one of them isn't an email address, or if there are more than 10.
