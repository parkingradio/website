# Artists

The artists Parking Radio knows of: mostly artists who applied, and a few that the team only knows by name. Their
applications for a set are in [Applications](applications.md), and the collectives they're in in
[Collectives](collectives.md).

## Profiles

Each artist has a profile, and maybe a photo, and is a row of the `artists` table (`server/src/db/schema.ts`).

The rules a profile has to follow are the schemas of `server/src/artists/profile.ts` (`ArtistProfile`, and
`AdminArtistProfile` for admins), and the server checks every profile it's sent against them. The server explains
what's wrong with a profile or a photo in French, unlike its other admin errors, because artists see the same messages
when they apply.

Admins can leave out more than artists: the admin endpoints take profiles without a country, city, genres, bio, links,
email or phone, since admins bring in artists who applied elsewhere, e.g. through the original Google Form, which didn't
always ask for them, or whom they only know by name. What's left out is stored as an empty string, or an empty list or
object, except the email, which is null, so that any number of artists can be without one. An artist applying alone
with `POST /api/applications` has to send all of them (see [Applying](applications.md#applying)).

A profile has:

| Field | Type | |
|---|---|---|
| `name` | string | Up to 100 characters |
| `country` | string | ISO 3166-1 alpha-2 code, e.g. `"CA"` (one of `COUNTRIES` in `server/src/artists/profile.ts`), or `""` when an admin left it out |
| `city` | string | As the artist wrote it. Up to 100 characters, or `""` when an admin left it out |
| `genres` | list of strings | The ids of at least one of `GENRES` in `server/src/artists/profile.ts` (e.g. `"drum-and-bass"`), most important first, or none when an admin left them out |
| `bio` | string | Up to 5000 characters, or `""` when an admin left it out |
| `links` | object | By site (`soundcloud`, `instagram`, `web`, `bandcamp`, `mixcloud`, `ra`, `youtube`, `spotify`, `tiktok`), at least one, or none when an admin left them out: see below |
| `email` | string or null | Up to 200 characters, or null when an admin left it out. Two artists can't have the same one, whatever its case |
| `phone` | string | At least 7 digits. Up to 40 characters, or `""` when an admin left it out |

Links are stored as profile names, which the server reduces what was typed or pasted to: e.g.
`https://soundcloud.com/parkingdotradio/sets/x` is stored as `parkingdotradio`. For `web`, it's the address itself.
Either is up to 200 characters. `linkSite(id).url(value)`, in `server/src/artists/profile.ts`, turns a profile name back
into an address.

An artist, as the endpoints below return them, is their profile with:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `createdAt` | string | When the artist was added |
| `createdBy` | string or null | The email of the admin who added the artist, or null when they came through `POST /api/applications`, by applying alone or as one of the artists of a collective that applied |
| `updatedBy` | string or null | The email of the admin who last changed the artist. Joining or leaving a collective doesn't count |
| `updatedAt` | string or null | When |
| `hasPhoto` | boolean | Whether the artist has a photo |
| `collectives` | list of objects | The collectives the artist is in, with the `id` and `name` of each one, by name, whatever its case |

## Photos

An artist's photo is optional. It's a JPEG, PNG or WebP image of up to 10 MB, whose type is checked from its contents.
It's kept in the app's private S3 bucket, or in a local directory in development, and only the server reads it. When
the artist is deleted, or the photo is replaced or removed, it's deleted too: it stays in the bucket's previous versions
for as long as the database's backups are kept, like the artist's row, and is gone for good after that.

## `GET /api/admin/artists[?collective=<id>]` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artists` | list of artists | By name, whatever its case, or, with `collective`, only that collective's members, in the collective's order. An unknown collective has none |

Fails with 400 if `collective` is given more than once.

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

Deletes an artist, their photo if they have one and their own applications, but not those of their collectives, takes
them out of their collectives, and responds `{"ok": true}`. Fails with 404 when there's no such artist.
