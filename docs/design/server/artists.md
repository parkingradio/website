# Artists

The artists Parking Radio knows of: mostly artists who applied, and a few that the team only knows by name. Their
applications for a set are in [Applications](applications.md), the collectives they're in in
[Collectives](collectives.md), and the sets they played in [Sessions](sessions.md#sets).

## Profiles

Each artist has a profile, and maybe a photo, and is a row of the `artists` table (`server/src/db/schema.ts`).

The rules a profile has to follow are the schemas of `server/src/artists/profile.ts` (`ArtistProfile`, and
`AdminArtistProfile` for admins), and the server checks every profile it's sent against them. The server explains
what's wrong with a profile or a photo in French, unlike its other admin errors, because artists see the same messages
when they apply.

Admins can leave out more than artists: the admin endpoints take profiles without a country, city, genres, bio, links,
email or phone, since admins bring in artists who applied elsewhere, e.g. through the original Google Form, which didn't
always ask for them, or whom they only know by name. When an artist is added, what's left out, or sent as null, is
stored as an empty string, or an empty list or object, except the email, which is null, so that any number of artists
can be without one. When some of their fields are changed, what's left out stays as it is, and what's sent as null, or
empty, is removed, and stored the same way. An artist applying alone with `POST /api/applications` has to send all of
them (see [Applying](applications.md#applying)).

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

A field's length is checked first: one that's too long gets only that error, e.g. not an email address's format (links
aside, whose length is that of what's stored, so it's checked once they're read).

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

An artist's photo is optional. It's a JPEG, PNG or WebP image of up to 10 MB, whose type is checked from its contents,
and which the server can read in full, of at most 100 million pixels: one it can't, e.g. because it's cut short, or too
damaged to be decoded, is refused. It's sent with the artist's profile when they're added (see
[`POST /api/admin/artists`](#post-apiadminartists-admin)), or on its own, with
[`PUT /api/admin/artists/:id/photo`](#put-apiadminartistsidphoto-admin), which replaces theirs, and it's removed with
[`DELETE /api/admin/artists/:id/photo`](#delete-apiadminartistsidphoto-admin): changing their profile never changes it.
The MCP server's tools can't send a photo, but they can remove one. It's kept in the app's private S3 bucket, or in a
local directory in development, and only the server reads it. It's deleted once no artist has it anymore: removing or
replacing an artist's photo, or deleting the artist, never removes it from another artist who has the same. It then
stays in the bucket's previous versions for as long as the database's backups are kept, like the artist's row, and is
gone for good after that.

The server also keeps each photo at two sizes, 320 and 1280 pixels wide, made when it's sent: WebP images, upright as
its EXIF orientation says, never larger than the photo, nor taller than WebP allows. They keep none of its metadata,
e.g. where it was taken, but keep its colours, as far as Display P3 has them: those of a photo with a colour profile are
in Display P3, with a Display P3 profile of the server's own, and those of a photo without one are as they are, without
a profile. They're deleted with it.
When it starts, the server makes, in the background, the sizes that the photos it keeps don't have: until then, and for
good for a photo it can't read, the endpoints fail with 404 for a size that isn't there. The server reads one photo or
flyer at a time, whatever it's for, e.g. making its sizes, in the background too, or
[the flyer it gives RA](ra-publication.md#the-flyer): a request with one to read meanwhile waits for its turn, and isn't
refused.

The public only ever gets the sizes of a public artist's photo, never the photo itself, so that it and its metadata stay
private. Anyone can keep those sizes for good, browsers and Cloudflare's cache included: so a size that was already
fetched can still be shown to whoever has its URL once the artist is private again, or once their photo is replaced or
removed, though public profiles stop giving it right away. If that matters for a photo, its sizes can be purged from
Cloudflare's cache, but not from the browsers that have them.

## Public profiles

An artist is public when they're a performer of a set of an [event](events.md), cancelled sets included, or a member of
a public collective (see [Public profiles, in Collectives](collectives.md#public-profiles)). So announcing a session
makes its sets' performers public, and un-announcing it makes them private again, unless something else makes them
public. Everyone else is private, e.g. the artists who only applied: there's no public list of artists, and the public
endpoints fail with 404 for a private artist, as for one that doesn't exist.

An artist's public profile has their `id`, `name`, `country`, `city`, `genres`, `bio` and `links`, as the admin
endpoints give them, and `photo`, where the public gets the sizes of their photo (see [Photos](#photos)), by width,
`{"320": "<url>", "1280": "<url>"}`, or null when they have none. Never their email or phone, who added or changed them,
or their collectives, which could name collectives that aren't public.

Clients take the URLs of sizes from the responses that give them, and never build them. Each one names the photo, by its
content, and the size, e.g. `/api/artists/photos/<sha256>/w320.v2.webp` (see
[`GET /api/artists/photos/:image/:size`](#get-apiartistsphotosimagesize)): so it's the same for every artist who has the
same photo, and it changes whenever what it serves would, when the photo changes, or how its sizes are made.

## `GET /api/admin/artists[?collective=<id>]` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many artists `artists` has (see [Conventions](README.md#conventions)) |
| `artists` | list of artists | By name, whatever its case, or, with `collective`, only that collective's members, in the collective's order. An unknown collective has none |

Fails with 400 if `collective` is given more than once.

## `GET /api/admin/artists/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artist` | artist | |

Fails with 404 when there's no such artist.

## `GET /api/admin/artists/:id/photo` (admin)

| Query parameter | |
|---|---|
| `width` | `320` or `1280`: that size of the photo (see [Photos](#photos)). Without it, the photo as it was sent |

Other query parameters are ignored.

Responds with the photo itself, with the type it was checked to have, or with its size, as `image/webp`, rather than
JSON. Browsers are told not to guess another type (`X-Content-Type-Options: nosniff`), and that they can keep it, only
in the browser that asked for it, never in a shared cache, but have to check with the server before showing it again
(`Cache-Control: private, no-cache`). The photo and each of its sizes have an `ETag` of their own, which changes
whenever the photo does, or, for a size, how sizes are made, and a request with it in `If-None-Match` gets a 304 without
the photo, even when the photo is missing. Otherwise, fails with 400 when `width` is anything else, or is given more
than once, and 404 when there's no such artist, when they have no photo, or when what's asked for is missing: the photo,
or, with `width`, that size of it, e.g. one it doesn't have yet (see [Photos](#photos)), though the photo can still be
had as it was sent, and replaced.

## `PUT /api/admin/artists/:id/photo` (admin)

Gives an artist a photo, or replaces their photo, and changes nothing else. It's `multipart/form-data`, with one part,
`photo`, the photo (see [Photos](#photos)). A few other fields or files are ignored, but a second photo isn't: the
request fails. The photo it replaces is deleted unless another artist has it (see [Photos](#photos)). It sets the
artist's `updatedBy` and `updatedAt` (see [Changes, in Conventions](README.md#conventions)), since their photo is part
of them.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artist` | artist | As they are then |

Fails with 400 when the request is malformed, has no photo, or the photo isn't a JPEG, PNG or WebP image that can be
read, 404 when there's no such artist, and 413 when the photo is larger than 10 MB.

## `DELETE /api/admin/artists/:id/photo` (admin)

Removes an artist's photo, which is deleted unless another artist has it, and changes nothing else. It sets the artist's
`updatedBy` and `updatedAt` (see [Changes, in Conventions](README.md#conventions)). Responds like
[`PUT /api/admin/artists/:id/photo`](#put-apiadminartistsidphoto-admin), with the artist as they are then. Fails with
404 when there's no such artist.

## `POST /api/admin/artists` (admin)

Adds an artist. It's `multipart/form-data`, with two parts: `artist`, the profile as JSON, in a field rather than a
file, and `photo`, the artist's photo, which can be left out. A few other fields or files, e.g. a form's submit button,
are ignored. A second photo isn't: the request fails.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artist` | artist | As they were added |

Fails with 400 (an invalid profile or photo, including one that can't be read, see [Photos](#photos), or a malformed
request), 409 (another artist has that email) or 413 (a photo larger than 10 MB).

## `PATCH /api/admin/artists/:id` (admin)

Changes the fields of an artist's profile it's sent, and leaves the others as they are, their photo included (see
[Changes, in Conventions](README.md#conventions), and [Photos](#photos)). It takes JSON, with any of the fields of a
profile, as `POST /api/admin/artists` takes them. Responds like `POST /api/admin/artists`, with the artist as they are
then. Fails with 400 when a field isn't valid, or when there's no field, 404 when there's no such artist, and 409 when
another artist has that email.

## `DELETE /api/admin/artists/:id` (admin)

Deletes an artist, their photo if no other artist has it, and their own applications, but not those of their
collectives, takes them out of their collectives and their [sets](sessions.md#performers), and their applications out of
the sets that come from them (see [Applications, in Sessions](sessions.md#applications)), and responds `{"ok": true}`.
Fails with 404 when there's no such artist.

## `GET /api/artists/:id`

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `artist` | object | The artist's public profile (see [Public profiles](#public-profiles)) |

Fails with 404 when there's no such artist, or when they're private.

## `GET /api/artists/photos/:image/:size`

Responds with a size of a photo that a public artist has, at the URL that their public profile gives (see
[Public profiles](#public-profiles)), as `image/webp`, never with the photo itself. Browsers are told not to guess another
type (`X-Content-Type-Options: nosniff`), and anyone can keep it for good, shared caches included, without checking with
the server again (`Cache-Control: public, max-age=31536000, immutable`), since what's at that URL never changes: it has no
`ETag`. It's served while any public artist has that photo, even when private artists have it too, but only as an
artist's photo: not because a collective or an event has the same image, whose sizes are at their own URLs.

Fails with 404 when no public artist has that photo, e.g. once the artist is private, or once their photo is replaced,
when `:size` isn't the name of one of its sizes, e.g. one of another width, or when that size is missing (see
[Photos](#photos)). Its errors are never kept (`Cache-Control: no-store`), so that the size is served as soon as it's
there, or public again.
