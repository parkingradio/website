# Applications

An application says when the artist would like to play and what they'd do. Applications are stored in the
`applications` table (`server/src/db/schema.ts`). Each one belongs to an artist, and is deleted when the artist is
deleted.

The server checks every application against the rules in `server/src/applications/fields.ts` (the `ApplicationFields`
schema). These rules only make sure the data is valid: every field below has to be there, with its type, even when it's
empty. Suggestions and limits, like which dates or time slots to offer, are up to the forms. Error messages are in
French, like for [profiles](artists.md#profiles), because artists see them.

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
| `prestations` | list of strings | What the artist would do: ids from `PRESTATIONS` in `server/src/applications/fields.ts`, e.g. `"dj"` or `"live-performance"`. Requests can list them in any order, even more than once, and other values are refused with 400. Responses list them in the order of `PRESTATIONS`. Can be empty |
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

Fails with 400 if `artist` is given more than once.

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
| `receivedAt` | string, optional | When the artist sent the application: a date and time with its offset from UTC, e.g. `"2026-03-28T14:03:00Z"` or `"2026-03-28T10:03:00-04:00"`, which can't be in the future. Now if it's left out (it can't be null) |

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
| `artist` | The artist's profile, with everything an admin could leave out (see [Profiles](artists.md#profiles)), as JSON, in a field rather than a file |
| `application` | The application's fields, as JSON, the same way |
| `photo` | The artist's photo, which can be left out (see [Photos](artists.md#photos)) |
| `turnstileToken` | The token Turnstile gave the page |

A few other fields or files, e.g. a form's submit button, are ignored. A second photo isn't: the request fails. On
success, the response is `{"ok": true}`, and the emails are sent (see [Emails](#emails)).

Errors are in French, since artists see them:

| Status | When |
|---|---|
| 400 | The profile, application or photo isn't valid, the request is malformed, or Turnstile refused the token |
| 409 | An artist with that email already exists |
| 413 | The photo is larger than 10 MB, or the request isn't `multipart/form-data` and is too large (see [Conventions](README.md#conventions)) |
| 429 | The client sent too many requests |
| 502 | Cloudflare couldn't be reached, or couldn't check the token |

## Emails

Once an application sent with `POST /api/applications` is saved, the server sends two emails, in French, from the
server's address (see [Conventions](README.md#conventions)):

- To the recipients chosen by admins (see `GET /api/admin/applications/recipients`): everything the artist sent,
  except their photo, which admins can see with the artist. Replying to it answers the artist. When nobody was chosen,
  it isn't sent: applications are only saved, and confirmed to the artist. When the recipients can't be read, it's as
  if nobody was chosen.
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
| `recipients` | list of strings | Email addresses, up to 10, each one like an artist's (see [Profiles](artists.md#profiles)). They're trimmed, and blanks and duplicates (ignoring upper and lower case) are dropped. Empty means nobody |

Replaces the recipients, and responds like `GET /api/admin/applications/recipients`. Fails with 400 if `recipients`
isn't a list of strings, if one of them isn't an email address like an artist's, or if there are more than 10.
