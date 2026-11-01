# Collectives

The collectives Parking Radio knows of, whose members are [artists](artists.md). A collective usually gets a whole time
slot.

## Profiles

Each collective has a profile, a photo maybe, and its members, and is a row of the `collectives` table
(`server/src/db/schema.ts`), with its members in `collective_members`.

The rules a profile has to follow are the schema `AdminCollectiveProfile` of `server/src/collectives/profile.ts`, and
the server checks every profile it's sent against it. Most rules are an artist's (see [Profiles](artists.md#profiles)),
and so are their messages, in French, except those about members' ids, which are in English, since only admins send ids.

Admins can leave out the same fields as for an artist, i.e. the country, city, description, links and phone, which are
then stored as an empty string, or an empty object, but not the contact's email, which is how the team reaches the
collective.

A profile has:

| Field | Type | |
|---|---|---|
| `name` | string | Up to 100 characters |
| `members` | list | The collective's artists, in order: see [Members](#members) |
| `country` | string | Like an artist's |
| `city` | string | Like an artist's |
| `description` | string | Like an artist's bio |
| `links` | object | Like an artist's |
| `email` | string | The contact's, like an artist's, but never left out. Two collectives can't have the same one, whatever its case |
| `phone` | string | The contact's, like an artist's |

A collective has no genres of its own: its genres are its members', whom
[`GET /api/admin/artists?collective=<id>`](artists.md#get-apiadminartistscollectiveid-admin) returns.

Emails are unique among collectives, and among artists, but not across both: a collective's contact is often one of
its members, who may also apply alone, with the same email. So a person can't be the contact of two collectives.

A collective, as the endpoints below return it, is its profile, where `members` is a list of objects with the `id` and
`name` of each member, in order, with:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `createdAt` | string | When the collective was added |
| `createdBy` | string or null | The email of the admin who added the collective, or null when it added itself, by applying (see [Applying](applications.md#applying)) |
| `updatedBy` | string or null | The email of the admin who last changed the collective. Changing its members' profiles, or deleting them, doesn't count |
| `updatedAt` | string or null | When |
| `hasPhoto` | boolean | Whether the collective has a photo |

## Members

A collective's members are artists, in order, at least one when it's added or changed. An artist can be in several
collectives, but only once in each. Artists return the collectives they're in (see [Profiles](artists.md#profiles)).

Requests send the members as a list of objects, in order, each one either:

- `{"id": <id>}`: an artist who exists. An id that's there twice is dropped, keeping the first.
- `{"name": <name>}`: a new artist, with that name, which follows an artist's rules, and everything else left out. The
  server creates them along with the collective, as the admin who sends the request (see `createdBy` in
  [Profiles](artists.md#profiles)). Each one is a new artist, even when another artist has that name.

Other fields are ignored, so that the members a collective returns can be sent back as they are: when there's both an
`id` and a `name`, the `id` is what counts. An `id` that isn't a string, or isn't that of an artist, fails with 400
(`"No such artist"`).

Deleting an artist takes them out of their collectives, which can leave a collective without members: it stays as it
is, but changing it then takes at least one member again.

## Photos

A collective's photo is optional, and follows the same rules as an artist's (see [Photos](artists.md#photos)): it's
deleted the same way when the collective is deleted, or the photo is replaced or removed.

## `GET /api/admin/collectives` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `collectives` | list of collectives | By name, whatever its case |

## `GET /api/admin/collectives/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `collective` | collective | |

Fails with 404 when there's no such collective.

## `GET /api/admin/collectives/:id/photo` (admin)

Responds with the photo itself, like [`GET /api/admin/artists/:id/photo`](artists.md#get-apiadminartistsidphoto-admin).
Fails with 404 when there's no such collective, when it has no photo, or when its photo is missing.

## `POST /api/admin/collectives` (admin)

Adds a collective, and creates the members it sends by name. It takes a request like
[`POST /api/admin/artists`](artists.md#post-apiadminartists-admin), with the profile in a `collective` part rather than
`artist`.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `collective` | collective | As it was added |

Fails with 400 (an invalid profile or photo, a member who isn't an artist, or a malformed request), 409 (another collective
has that email) or 413 (a photo larger than 10 MB). When it fails, nothing is created.

## `PUT /api/admin/collectives/:id` (admin)

Replaces a collective's profile and members, and creates the members it sends by name. It takes the same request as
`POST /api/admin/collectives`, and replaces or removes the photo like
[`PUT /api/admin/artists/:id`](artists.md#put-apiadminartistsid-admin). Responds like `POST /api/admin/collectives`,
with the collective as it is then, and fails like it, with 400 when there's both a photo and `removePhoto`, and with 404
when there's no such collective.

## `DELETE /api/admin/collectives/:id` (admin)

Deletes a collective, its photo if it has one and its [applications](applications.md), but not its members, and
responds `{"ok": true}`. Fails with 404
when there's no such collective.
