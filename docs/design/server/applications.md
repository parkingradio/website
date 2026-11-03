# Applications

An application says when the artist would like to play and what they'd do. Applications are stored in the
`applications` table (`server/src/db/schema.ts`). Each one belongs to either an artist or a
[collective](collectives.md), never both, and is deleted when its artist or collective is deleted. An application has
the same fields either way: for a collective's, "the artist" below means the collective, and the fields describe its
show as a whole, e.g. its prestations aren't each member's.

The server checks every application against the rules in `server/src/applications/fields.ts` (the `ApplicationFields`
schema). These rules only make sure the data is valid: every field below has to be there, with its type, even when it's
empty. Suggestions and limits, like which dates or time slots to offer, are up to the forms. Error messages are in
French, like for [profiles](artists.md#profiles), because artists see them.

Applications are created in two ways:

- A new artist or collective applies with `POST /api/applications`, which creates them and their application together
  (see [Applying](#applying)).
- An admin creates an application, for an artist or a collective who already exists, e.g. to bring in one that came
  by email, or through the original Google Form.

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
| `artistId` | string or null | The artist who applied, or null for a collective's application |
| `collectiveId` | string or null | The collective that applied, or null for an artist's application |
| `receivedAt` | string | When the artist sent the application, which isn't always when it was created: one that came by email, or through the original Google Form, can be brought in long after. For one sent through `POST /api/applications`, that's when it was created. For one an admin created, it's what the admin said, or else when it was created. Admins can change it either way |
| `createdAt` | string | When the application was created |
| `createdBy` | string or null | The email of the admin who created the application, or null if the artist sent it themselves |
| `updatedBy`, `updatedAt` | string or null | Who last changed the application (an admin's email), and when. Status changes don't count |
| `status` | `"new"`, `"accepted"`, `"scheduled"`, `"done"` or `"rejected"` | See below |
| `statusUpdatedBy`, `statusUpdatedAt` | string or null | Who last changed the status (an admin's email), and when |

Every application starts as `"new"`, then is `"accepted"` or `"rejected"` as an admin decides, and an accepted one is
`"scheduled"` once a date has been set with the artist, then `"done"` once they've played. That's only the usual order:
admins can change a status to any other.

## `GET /api/admin/applications[?artist=<id>|?collective=<id>]` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many applications `applications` has (see [Conventions](README.md#conventions)) |
| `applications` | list of applications | The most recently received first (by `receivedAt`, then `createdAt`). With `artist`, only that artist's applications, and with `collective`, only that collective's. An unknown artist or collective has none |

Fails with 400 if `artist` or `collective` is given more than once, or if both are given.

## `GET /api/admin/applications/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `application` | application | |

Fails with 404 if the application doesn't exist.

## `POST /api/admin/applications` (admin)

Creates an application for an existing artist or collective. The request has the application's fields, plus:

| Request field | Type | |
|---|---|---|
| `artistId` | string, optional | The id of the artist who's applying |
| `collectiveId` | string, optional | The id of the collective that's applying |
| `receivedAt` | string, optional | When the artist sent the application: a date and time with its offset from UTC, e.g. `"2026-03-28T14:03:00Z"` or `"2026-03-28T10:03:00-04:00"`, which can't be in the future. Now if it's left out (it can't be null) |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `application` | application | The new application |

Exactly one of `artistId` and `collectiveId` has to be there (neither can be null). Fails with 400 if the application
or `receivedAt` isn't valid (with a message in French), or else if there's neither or both, or if the one that's there
isn't the id of an artist or a collective that exists (in English, since only admins send ids).

## `PUT /api/admin/applications/:id` (admin)

Replaces an application's fields. The request is the same as for `POST /api/admin/applications`, without `artistId`
or `collectiveId`, and leaving `receivedAt` out keeps the one the application has. The artist or collective and the
status don't change. The response is the same as for `POST /api/admin/applications`, with the updated application.
Fails with 400 if the application or `receivedAt` isn't valid, or 404 if it doesn't exist.

## `PUT /api/admin/applications/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"new"`, `"accepted"`, `"scheduled"`, `"done"` or `"rejected"` | |

Changes an application's status. The response is the same as for `POST /api/admin/applications`. Fails with 400 if
`status` isn't one of these values, or 404 if the application doesn't exist.

## `DELETE /api/admin/applications/:id` (admin)

Deletes an application, and responds `{"ok": true}`. The artist or the collective stays. Fails with 404 if the
application doesn't exist.

## Applying

A new artist or collective applies with `POST /api/applications`. For an artist applying alone, it creates the artist,
with their profile and photo, if they sent one, and their application. For a collective, it creates the collective,
with its profile and photo, if it sent one, an artist for each of its artists, with their profiles and photos, and its
application, which belongs to the collective (see [`POST /api/applications`](#post-apiapplications)). Everything it
creates has a null `createdBy`, since nobody on the team created it.

Anyone can call this endpoint, so it has two protections against bots and floods:

- **Cloudflare Turnstile.** The page shows Turnstile's widget, using the site key from `GET /api/config`. Once the
  visitor passes Turnstile's check, the widget gives the page a token, which the page sends with the application. The
  server then asks Cloudflare whether the token is valid.
- **A rate limit.** Each client can send 5 requests per hour. Requests that fail count too.

**Only new artists and collectives can apply this way.** If an artist applying alone has the email of an artist who
already exists, or a collective has the contact email of a collective that already exists (ignoring upper and lower
case), the request fails with 409 and nothing is created. Otherwise, anyone could take over a profile just by typing its
email. A collective can still have an artist's email, and an artist a collective's, since emails are only unique among
artists, and among collectives (see [Profiles](collectives.md#profiles)). The downside is that the 409 tells whoever
sent the request that this email belongs to an artist, or to a collective. To make that harder to abuse, the server
only checks the email after Turnstile has accepted the token.

**When the page needs a new token.** Cloudflare only accepts each token once. To let artists fix their mistakes, the
server checks the profile, each artist's profile for a collective, the application and all the photos before it sends
the token to Cloudflare. So if the request fails because one of those isn't valid, the page can send it again with the
same token. After any other error, the token may already be used up, and the page needs to get a new one from the
widget.

## `POST /api/applications`

A new artist or collective applies (see [Applying](#applying)). The request is `multipart/form-data`, with these parts:

| Part | |
|---|---|
| `artist` | Who applies, as JSON, in a field rather than a file: see below |
| `application` | The application's fields, as JSON, the same way |
| `photo` | The photo of the artist, or of the collective, which can be left out (see [Photos](artists.md#photos)) |
| `memberPhoto` | For a collective, its artists' photos: one part for each of its artists, in their order, where an empty part is no photo. Those after the last photo can be left out |
| `turnstileToken` | The token Turnstile gave the page |

A few other fields or files, e.g. a form's submit button, are ignored. A second `photo` isn't, and neither is a
`memberPhoto` part for an artist the collective doesn't have, or any from an artist applying alone: the request fails.
On success, the response is `{"ok": true}`, and the emails are sent (see [Emails](#emails)).

The server reads at most 10 files and 10 fields, each file up to 10 MB and each field up to 256 KB: a request with more
files or fields, or a longer field, fails as malformed. Since the profiles are all in the `artist` field, that bounds
how many artists a collective can send at once. In production, the whole request also has to fit in nginx's limit,
photos included (see [Conventions](README.md#conventions)).

Who applies follows the `Applicant` schema of `server/src/applications/applicant.ts`. `kind` says whether it's an artist
applying alone (`"artist"`), or a collective (`"collective"`):

- An artist sends their profile, with every field of an artist's profile (see [Profiles](artists.md#profiles)), none of
  them left out.
- A collective sends its profile, with every field of a collective's profile but its members (see
  [Profiles](collectives.md#profiles)), none of them left out, the email and phone being its contact's. Its `members`
  are its artists, in order, at least one, each with an artist's `name`, `country`, `city`, `genres`, `bio` and `links`,
  none of them left out, but no email or phone: the team only reaches the collective's contact.

Other fields are ignored. What the server creates from it is:

- For an artist: the artist, with their profile and their photo.
- For a collective: the collective, with its profile and its photo. Its members are its artists, in order, each one a
  new artist, even when another artist has that name, with their profile, without an email or a phone, and the photo
  sent for them, which is theirs. A collective has no genres of its own, since its genres are its artists'.

Errors are in French, since artists see them. An error about one of a collective's artists starts with which one it is,
counting from 1 in their order, e.g. "Artiste 2 : Indiquez la ville.":

| Status | When |
|---|---|
| 400 | A profile, the application or a photo isn't valid, the request is malformed (including a `memberPhoto` part too many), or Turnstile refused the token |
| 409 | An artist applying alone has the email of an artist who already exists, or a collective the contact email of a collective that already exists |
| 413 | A photo is larger than 10 MB, which is answered while the request is read, before anything else, or the request isn't `multipart/form-data` and is too large (see [Conventions](README.md#conventions)) |
| 429 | The client sent too many requests |
| 502 | Cloudflare couldn't be reached, or couldn't check the token |

## Emails

Once an application sent with `POST /api/applications` is saved, the server sends two emails, in French, from the
server's address (see [Conventions](README.md#conventions)):

- To the recipients chosen by admins (see `GET /api/admin/applications/recipients`): the profile and the application,
  as they were saved, i.e. everything that was sent, except the photos, which admins can see on the admin pages. For a
  collective, that's the collective's profile, with its contact's email and phone, and its application, then each of
  its artists' profiles.
  Replying to it answers the artist, or the collective's contact. When nobody was chosen, it isn't sent: applications
  are only saved, and confirmed. When the recipients can't be read, it's as if nobody was chosen.
- To the artist, or the collective's contact: a confirmation that the application was received, which says how it goes
  from there: because of the number of applications, going through them can take up to a month, only the artists and
  collectives retained are contacted, by email, and those who've heard nothing within three months can apply again.
  Replying to it answers the recipients, if there are any. It goes to whatever address the application has, so it
  doesn't repeat anything the artist wrote: otherwise, anyone could have the server send their own text to any address.

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
