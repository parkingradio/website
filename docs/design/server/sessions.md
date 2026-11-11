# Sessions

What's played at the studio: **sessions**, the occasions at the studio, and the **sets** played during them, with who
played, what they did, and where the recordings are. A session is e.g. an evening of three artists, or a collective's
4-hour takeover. A set is one performance during a session, usually about an hour, streamed as its own YouTube live and
uploaded as its own SoundCloud track: a 4-hour takeover is one session of 4 sets. The recordings stay on SoundCloud and
YouTube, which the server only links to. Sessions and sets are only reachable by admins for now. They have nothing to do
with admins' sessions, which are about logging in (see [Sessions, in Admins](admins.md#sessions)).

Each session is a row of the `sessions` table (`server/src/db/schema.ts`), and each set a row of `sets`, with its
performers in `set_performers`. The rules each of their fields follows are the schemas `SessionFields` and `SetFields`
of `server/src/sessions/fields.ts`. The server checks every session and set against them as it would be once it's added
or changed, with the fields a change doesn't send as they are, then against the [rules](#rules) that involve other
sessions and sets. Its errors are in English, since only admins see them.

## Sessions

A session has:

| Field | Type | |
|---|---|---|
| `start` | string or null | When the session starts, or null for a session whose date isn't known yet: see [Times](#times) |
| `durationMinutes` | number | How long the session lasts: see [Times](#times) |
| `type` | string | What kind of session it is, which gives it its name: see [Types and names](#types-and-names) |
| `takeover` | object or null | The collective whose takeover the session is, which only takeovers have, and they always do: see [Types and names](#types-and-names) |
| `name` | string | The session's own name, which replaces the one its type gives it, as free text: see [Types and names](#types-and-names). Each run of spaces, tabs or line breaks becomes a single space, and it's trimmed, then up to 100 characters, or `""` when there's none |
| `raEvent` | object or null | The session's event on Resident Advisor: see [Links](#links) |
| `description` | string | The session's own description, which replaces the one its type gives it, as plain text: see [Descriptions](#descriptions). Its line breaks become `\n`, and it's trimmed, then up to 5000 characters, or `""` when there's none |

A session, as the endpoints below return it, also has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `title` | string | What the session is called: its `name`, or else the name its type gives it, e.g. `"HAUTE RIVE TAKEOVER"`, like the event of a track's title (see [The rotation](radio.md#the-rotation)). Never empty: see [Types and names](#types-and-names) |
| `end` | string or null | When the session ends: its `start` plus its `durationMinutes`, or null when it has no `start` |
| `effectiveDescription` | string | The session's description: its `description`, or else the one its type gives it, or `""` when neither has one: see [Descriptions](#descriptions) |
| `hasFlyer` | boolean | Whether the session has a flyer: see [Flyers](#flyers) |
| `sets` | list of sets | Its sets, by `offsetMinutes`, then `createdAt`, the sets without an offset last, cancelled ones included |
| `createdAt` | string | When the session was added |
| `createdBy` | string | The email of the admin who added it |
| `updatedBy`, `updatedAt` | string or null | Who last changed the session (an admin's email), and when, its flyer included. Status changes don't count, and neither do changes to its sets, or renaming the takeover's collective |
| `status` | `"planned"`, `"done"` or `"cancelled"` | See [Status](#status) |
| `statusUpdatedBy`, `statusUpdatedAt` | string or null | Who last changed the status (an admin's email), and when |

## Sets

Every set belongs to a session: the one it's added to, which doesn't change. Sets aren't listed on their own: they're
in their sessions, and the `total` of a list of sessions counts sessions, not sets. A set has:

| Field | Type | |
|---|---|---|
| `performers` | list | The artists who played, in order: see [Performers](#performers) |
| `offsetMinutes` | number or null | When the set starts, in minutes after its session's start, or null when that isn't known yet: see [Times](#times) |
| `durationMinutes` | number or null | How long the set lasts, or null when that isn't known yet: see [Times](#times) |
| `performanceTypes` | list of strings | What the performers do: ids from `PERFORMANCE_TYPES` in `server/src/applications/fields.ts`, like an application's (see [Applications](applications.md)), e.g. `"dj"` or `"live-performance"`. Requests can list them in any order, even more than once, and other values fail with 400. Responses list them in the order of `PERFORMANCE_TYPES`. Can be empty |
| `otherPerformanceType` | string | Anything else the performers do, in a few words, e.g. `"Synthé modulaire"`. Each run of spaces, tabs or line breaks becomes a single space, and it's trimmed, then up to 60 characters, or `""` when there's none |
| `genres` | list of strings | The set's genres: ids of `GENRES` in `server/src/artists/profile.ts`, like an artist's (see [Profiles](artists.md#profiles)), most important first, or none. They describe the set, which can differ from its performers' genres, e.g. an ambient set by a techno artist. A genre that's there twice is dropped, keeping the first, and other values fail with 400 |
| `soundcloudTrack` | object or null | The set's track on SoundCloud: see [Links](#links) |
| `youtubeVideo` | object or null | The set's video on YouTube: see [Links](#links) |

A set, as the endpoints below return it, also has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `start`, `end` | string or null | When the set starts and ends: its session's `start` plus its `offsetMinutes`, and that plus its `durationMinutes`. Null when its session has no `start`, or the set no `offsetMinutes` |
| `fitsInSession` | boolean | Whether the set fits in its session, whatever its status: see [Sets' places](#sets-places) |
| `overlappingSets` | list of strings | The ids of the other sets of its session that aren't cancelled and that it overlaps, in the order of the session's `sets`: see [Sets' places](#sets-places) |
| `createdAt` | string | When the set was added |
| `createdBy` | string | The email of the admin who added it |
| `updatedBy`, `updatedAt` | string or null | Who last changed the set (an admin's email), and when. Status changes don't count, and neither do changes to its session, e.g. moving it, or a performer being deleted |
| `status` | `"planned"`, `"done"` or `"cancelled"` | See [Status](#status) |
| `statusUpdatedBy`, `statusUpdatedAt` | string or null | Who last changed the status (an admin's email), and when |

## Times

A session has a start, which can be null, and a duration, which can't. A session without a start is one whose date
isn't known yet, e.g. a collective's artists grouped into a takeover while it's being planned. Requests send `start` in
Québec time, with or without seconds, with the offset from UTC in effect then, e.g. `"2026-11-14T21:00-05:00"`, or
`"2026-07-01T21:00-04:00"` in summer, or as null, or a blank string, for none. Any other offset is refused, e.g.
`"2026-11-14T21:00-04:00"`, and so is a time the clocks skip, e.g. 2:30 on March 14, 2027. A time they show twice, e.g.
1:30 on November 1, 2026, takes the offset of the one it is: -04:00 for the first, -05:00 for the second. Responses give
it, and the `start` and `end` the server works out, in Québec time, to the second, with the offset in effect then, e.g.
`"2026-11-14T21:00:00-05:00"` (see [Times, in Conventions](README.md#conventions)). A start is from the year 2000 to the
year 2999, in UTC, and can be in the past or in the future.

A set's place in its session is relative to the session's start: its `offsetMinutes`, and its `durationMinutes`, so that
moving a session moves its sets with it. Either can be null, e.g. while the order of the sets isn't known yet, but a set
with an offset also has a duration: giving an offset to a set without a duration takes giving it one in the same
request. A set is meant to take place during its session, but doesn't have to (see
[Sets' places](#sets-places)).

Durations and offsets are whole numbers of minutes, of time that actually passes, whatever the clocks say: a session
from 21:00 to 2:00 on the night the clocks go back an hour lasts 360 minutes, not 300. A duration is from 1 minute to 24
hours (1440 minutes), and an offset is from 0 to 1439 minutes.

To find the sessions of a period, e.g. next week, list them with `from` and `to`, instants like `start`, each with the
offset in effect at that time: that gives the sessions that start at or after `from` and before `to`, and leaves out
those without a start. `from` alone gives those from then on. E.g. for the week of Monday, October 26, 2026, when the
clocks go back: `from` `"2026-10-26T00:00-04:00"`, `to` `"2026-11-02T00:00-05:00"`.

## Rules

- **Sessions don't overlap**, unless one of them is cancelled or has no start: there's one studio. A session takes from
  its start, included, to its end, excluded, so a session can start when the one before it ends.
- **A SoundCloud track, or a YouTube video, belongs to at most one set**, cancelled ones included.
- **A cancelled session only has cancelled sets** (see [Status](#status)).
- **A takeover has a collective** (see [Types and names](#types-and-names)), so a collective with takeovers can't be
  deleted.

Requests that would break a rule fail with 409, even when they're sent at the same time: when two requests would break a
rule together, one of them fails. That's the case for:

- adding or changing a session so that it overlaps another one, or un-cancelling it when it would then overlap one,
- adding a set to a cancelled session, or un-cancelling a set of a cancelled session,
- giving a set a track or a video that's another set's,
- deleting a collective that has takeovers.

These 409s also have `session` and `set`, what's in the way, as the endpoints return them, so that it can be named and
linked to without another request. `set` is the set in the way, if it's a set, or else null, and `session` is the session
in the way, or that set's session. A set that's added to or un-cancelled in a cancelled session has its own session in
the way, and a collective that has takeovers has one of them. When several things are in the way, it's one of them. Both
are null for the 409s that aren't about a session or a set.

## Sets' places

Each set is streamed as its own YouTube live, so there's meant to be one at a time: a session's sets are meant to take
place during it, one after the other. The server doesn't require it, so that a session's times and its sets' can be
changed one at a time, in any order, e.g. a session shortened before its last set is moved. But since it's usually a
mistake, or a change that isn't finished, each set says where it stands:

- **A set fits in its session** (`fitsInSession`) when its offset plus its duration, or its duration alone when it has
  no offset, is no more than the session's duration. A set without a duration always fits. This is about the set's
  times only, whatever its status.
- **A set overlaps another set of its session** when both have an offset, and so a duration, and their times overlap.
  A set takes from its offset, included, to its offset plus its duration, excluded, so a set can start when the one
  before it ends. `overlappingSets` lists the other sets that a set overlaps, but only those that aren't cancelled,
  since a cancelled set doesn't take place. So it isn't symmetric: a cancelled set lists the sets it would overlap if it
  weren't cancelled, but they don't list it.

Only the sets that aren't cancelled are expected to fit in their session and to overlap no other set: those that don't
are what's worth pointing out. Apps that change a session's or its sets' times should tell the admin about the sets
that aren't cancelled and that they leave not fitting in their session, or overlapping another set.

## Status

A new session or set is `"planned"`, then `"done"` once it's been played, or `"cancelled"`, e.g. a set whose artist
didn't show up. Only admins change statuses: nothing changes them on its own. Any status can be changed to any other,
except as below.

A session's status and its sets' are independent, e.g. a session that's done can have a cancelled set, with one
exception: a cancelled session only has cancelled sets. Cancelling a session cancels every one of its sets that isn't
already cancelled, done ones included, as the same admin, at the same time. Un-cancelling a session leaves its sets
cancelled: each one is un-cancelled on its own, once the session isn't cancelled anymore. The sets of a cancelled session
can still be changed, but not un-cancelled while it is.

## Performers

A set's performers are the artists who played it, in order, at least one when it's added or changed. Each artist is only
once in a set. Several artists can play a set together. A set is always played by artists: when a collective plays, some
of its artists do, during its takeover (see [Types and names](#types-and-names)).

Requests send the performers as a list of objects, in order, each one `{"id": <id>}`, an artist's id. Other fields are
ignored, so that the performers a set returns can be sent back as they are. A performer that's there twice, whatever the
case of its id, is dropped, keeping the first. A performer that isn't an object with an `id` that's a string, or whose
`id` isn't that of an artist who exists, fails with 400 (`"No such artist"`).

Responses list them as objects with the `id` and `name` of each one, in order.

Deleting an artist takes them out of their sets, which stay as they are, even without performers. Replacing such a
set's fields, or changing its performers, then takes at least one performer again, but its other fields and its status
can still be changed on their own.

## Types and names

A session has one type, which says what kind of session it is, and gives it its name:

| `type` | The name it gives |
|---|---|
| `"guest-mixes"` | `GUEST MIXES` |
| `"live-performance"` | `LIVE PERFORMANCE` |
| `"takeover"` | `<COLLECTIVE> TAKEOVER`: the name of the collective whose takeover it is, in upper case (Unicode's default case mapping), then a space and `TAKEOVER`, e.g. `SAUT DE CLÔTURE TAKEOVER` for Saut de Clôture |
| `"synth-meetup"` | `SYNTH MEETUPS` |
| `"other"` | None, e.g. for a workshop: it needs a `name` |

A takeover is a collective's session. The performers of its sets are usually the collective's artists, but they don't
have to be, e.g. for a guest. Only takeovers have a collective (`takeover`), and every takeover has one, so a collective
can't be deleted while it has takeovers (see
[`DELETE /api/admin/collectives/:id`](collectives.md#delete-apiadmincollectivesid-admin)).

A session's `name` is its own name, which replaces the one its type gives it, e.g. for a special evening,
`"SPECIAL HALLOWEEN — MINIMALTIDE TAKEOVER"`. Any type can have one, and `"other"` needs one. It's kept as it's sent,
its case included, e.g. `"ATELIER DE DJing POUR FEMMES & OPEN DECKS"`, but for its spaces (see [Sessions](#sessions)).

What a session is called is its `title`: its `name`, or else the one its type gives it, so it's never empty. It's worked
out when the session is read, from its collective's name as it is then, so renaming a collective renames its takeovers,
unless they have a name of their own. Apps that change a session send back its `name`, not its `title`: otherwise the
name its type gives it would become its own, and stop following its collective's name and its type.

Requests send `type` as one of the types above, and fail with 400 otherwise (`"The type must be one of guest-mixes,
live-performance, takeover, synth-meetup, other"`). They send `takeover` as the collective's id, or null, or a blank
string, when there's none. A `takeover` that isn't a string or null fails with 400 (`"The takeover must be a
collective's id, or null"`), and so does a takeover without a collective (`"A takeover has a collective"`), a session of
another type with one (`"Only a takeover has a collective"`), a session of type `"other"` without a `name` (`"A session
of type other has a name"`), and a string that isn't the id of a collective that exists (`"No such collective"`). These
are checked on the session as it would then be: turning a takeover into another type takes sending `takeover` as null
in the same request, and turning a session into a takeover, or into an `"other"`, takes sending its collective, or its
`name`, unless it already has one.
Responses give `takeover` as an object with the collective's `id` and `name`, or null.

## Descriptions

A session's `description` is its own text, e.g. for a special evening, which replaces the one its type gives it. It's
plain text, without markup, on several lines: each `\r\n` or `\r` becomes `\n`, and it's trimmed, but its spaces and
line breaks are kept as they are. Types give these, which are what Parking Radio puts on its events on Resident Advisor:

| `type` | The description it gives |
|---|---|
| `"guest-mixes"`, `"live-performance"`, `"takeover"` | `LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC` |
| `"synth-meetup"` | A text in French that presents the Synth Meetups and the studio's ceiling of LEDs |
| `"other"` | None |

These are `DEFAULT_DESCRIPTIONS`, in `server/src/sessions/descriptions.ts`. A session's `effectiveDescription` is its
`description`, or else the one its type gives it, so it's `""` for a session of type `"other"` without one. Apps that
change a session send back its `description`, not its `effectiveDescription`: otherwise the one its type gives it would
become its own, and stop following its type.

## Flyers

A session can have a flyer, an image, which follows the same rules as an artist's photo (see
[Photos](artists.md#photos)): it's a JPEG, PNG or WebP image of up to 10 MB, whose type is checked from its contents,
kept in the app's private files, and deleted when the session is deleted, or the flyer replaced or removed. It's sent
along with the session's fields (see [`POST /api/admin/sessions`](#post-apiadminsessions-admin)), and the MCP server's
tools can't send one: a session added with a tool has none, and one changed with a tool keeps its own, unless
`removeFlyer` is `true`.

## Links

Requests send each of these as a string, or null, or a blank string, when there's none. Links can be `http://` or
`https://` ones, with or without `www.` or `m.`, and a trailing `/` and parameters, e.g. `?si=...`, are allowed:

- A session's `raEvent`: the event's id on RA, which is only digits, up to 20, as
  [`GET /api/events`](events.md#get-apievents) gives it, e.g. `"6683745"`, or a link to its page,
  `https://ra.co/events/<id>`. It isn't checked against RA, so any event can be given, e.g. another promoter's. Several sessions can have the same one.
- A set's `soundcloudTrack`: a link to the track on soundcloud.com, e.g.
  `https://soundcloud.com/parkingdotradio/3tons`, or a private track's private link, which ends with its secret, e.g.
  `https://soundcloud.com/parkingdotradio/3tons/s-AbC123`. Other links, e.g. the `on.soundcloud.com` ones that
  SoundCloud's app shares, fail with 400. The link is reduced to `https://soundcloud.com/<account>/<track>`, with
  `/s-<secret>` for a private link. When the set is saved, the server resolves it to the track through the SoundCloud
  app (see [The SoundCloud app](radio.md#the-soundcloud-app)), and refuses links where SoundCloud shows no track. The
  track can be any track SoundCloud shows. A link that reduces to the set's track's `url` isn't resolved again, and a
  change that doesn't send `soundcloudTrack` keeps the set's track without resolving it, so that a set can be changed
  while SoundCloud can't be reached.
- A set's `youtubeVideo`: a link to the video on YouTube, as `youtube.com/watch?v=<id>`, `youtu.be/<id>`,
  `youtube.com/live/<id>`, `youtube.com/shorts/<id>` or `youtube.com/embed/<id>`, or the video's id itself, which is 11
  letters, digits, `-` or `_`. The link is reduced to the video's id. It isn't checked against YouTube.

Responses give each one as an object, or null when there's none, with an `id` and a `url`:

| Field | `id` | `url` |
|---|---|---|
| `raEvent` | The event's id on RA | `https://ra.co/events/<id>` |
| `soundcloudTrack` | SoundCloud's id for the track, which doesn't change when the track is renamed | The link it was resolved from, reduced as above: a private track's private link mustn't be shown to the public |
| `youtubeVideo` | The video's id | `https://www.youtube.com/watch?v=<id>` |

## Events on RA

Parking Radio announces its sessions on Resident Advisor, under its promoter page (see [Events](events.md)). A session's
event there is its `raEvent` (see [Links](#links)), which an admin creates on RA from the content the server gives for
the session, whatever its status (see [`GET /api/admin/sessions/:id/ra-event`](#get-apiadminsessionsidra-event-admin)),
then sets as its `raEvent`. The server never creates events on RA itself. The content is:

| Field | Type | |
|---|---|---|
| `title` | string | The session's `title` |
| `start`, `end` | string or null | The session's `start` and `end`, as it gives them, or null when it has no `start`. RA takes them in Québec time without their offset |
| `lineup` | string | One performer per line: the performers of the session's sets that aren't cancelled, in the order of its `sets`, each set's in their order, without repeated lines, e.g. `"Aurore\nBrume"` for a set of Aurore and Brume. RA needs one, so a session without such performers has `"OPEN JAM"` for a `"synth-meetup"`, as Parking Radio's synth meetups do on RA, or else its `title` |
| `venueId` | string | Parking Radio's venue on RA, `"288529"` (`https://ra.co/clubs/288529`) |
| `promoterIds` | list of strings | Parking Radio's promoter page on RA, `["183980"]` (`https://ra.co/promoters/183980`) |
| `content` | string | The session's `effectiveDescription` |

## `GET /api/admin/sessions` (admin)

Every query parameter can be left out, and the list only has the sessions that match all of those given:

| Query parameter | |
|---|---|
| `artist` | An artist's id: only the sessions with at least one set, whatever its status, that has that artist among its performers, with all of their sets. An unknown artist has none. Not with `takeover` |
| `takeover` | A collective's id: only that collective's takeovers. An unknown collective has none |
| `from` | An instant (see [Times, in Conventions](README.md#conventions)): only the sessions that start at that instant or after it, which leaves out those without a start |
| `to` | An instant: only the sessions that start before it, which leaves out those without a start |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many sessions `sessions` has (see [Conventions](README.md#conventions)) |
| `sessions` | list of sessions | Whatever their status. The sessions without a start come first, the most recently added first, then the others, the most recent first (by `start`, then `createdAt`) |

Fails with 400 if a query parameter is given more than once, if both `artist` and `takeover` are given, if `from` or
`to` is empty or isn't an instant with Québec's offset then (see [Times](#times)), from the year 2000 to 2999, in UTC,
or if `from` isn't before `to`.

## `GET /api/admin/sessions/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | |

Fails with 404 when there's no such session.

## `GET /api/admin/sessions/:id/ra-event` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `event` | object | The content of the session's event on RA, as above (see [Events on RA](#events-on-ra)) |

Fails with 404 when there's no such session.

## `GET /api/admin/sessions/:id/flyer` (admin)

Responds with the flyer itself, like [`GET /api/admin/artists/:id/photo`](artists.md#get-apiadminartistsidphoto-admin).
Fails with 404 when there's no such session, when it has no flyer, or when its flyer is missing.

## `POST /api/admin/sessions` (admin)

Adds a session, as `"planned"`, without sets. It's `multipart/form-data`, like
[`POST /api/admin/artists`](artists.md#post-apiadminartists-admin), with two parts: `session`, the session's fields as
JSON, in a field rather than a file, which are its `start`, `durationMinutes`, `type`, `takeover`, `name`, `raEvent` and
`description`, as above, none of them left out, and `flyer`, its flyer, which can be left out. A few other fields or
files are ignored, but a second flyer isn't: the request fails.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | As it was added |

Fails with:

| Status | When |
|---|---|
| 400 | The request is malformed, a field isn't valid, the session's `takeover` doesn't go with its `type`, a session of type `"other"` has no `name`, the takeover's collective doesn't exist, `raEvent` isn't one of the links above, or the flyer isn't a JPEG, PNG or WebP image |
| 409 | The session would overlap another one, which is in `session` (see [Rules](#rules)) |
| 413 | The flyer is larger than 10 MB |

When it fails, nothing is saved.

## `PUT /api/admin/sessions/:id` (admin)

Replaces a session's fields, but not its status or its sets, which move with its start, and stay as they are when it's
shortened, even when they don't fit in it anymore (see [Sets' places](#sets-places)). It takes the same request as
`POST /api/admin/sessions`. With a flyer, it replaces the session's, which is deleted. Without one, the session keeps
its own, unless there's also a `removeFlyer` field set to `true`, which removes it, and deletes it. Responds like
`POST /api/admin/sessions`, with the session as it is then, and fails like it, with 400 when there's both a flyer and
`removeFlyer`, and with 404 when there's no such session.

## `PATCH /api/admin/sessions/:id` (admin)

Changes the fields of a session it's sent, like `PUT /api/admin/sessions/:id`, and leaves the others as they are (see
[Changes, in Conventions](README.md#conventions)). It takes JSON, with any of its `start`, `durationMinutes`, `type`,
`takeover`, `name`, `raEvent` and `description`, and `removeFlyer`, a boolean: `true` removes the session's flyer, and
deletes it, and `false` keeps it, like leaving it out. A flyer is only replaced with `PUT`. Its `type`, `takeover` and
`name` are checked together, and it's checked against the other sessions, as the session would then be. Responds like
`PUT`, and fails like it, but with 400 when there's no field, and never with 413.

## `PUT /api/admin/sessions/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"planned"`, `"done"` or `"cancelled"` | |

Changes a session's status, and its sets' when it's cancelled (see [Status](#status)), and responds like
`POST /api/admin/sessions`, with its sets as they are then. Fails with 400 if `status` isn't one of these values, 404 when
there's no such session, or 409 when the session would then overlap another one, with that session in `session`.

## `DELETE /api/admin/sessions/:id` (admin)

Deletes a session, its flyer if it has one, and its sets, and responds `{"ok": true}`. Their performers stay. Fails with
404 when there's no such session.

## `POST /api/admin/sessions/:id/sets` (admin)

Adds a set to a session, as `"planned"`. The request has the set's `performers`, `offsetMinutes`, `durationMinutes`,
`performanceTypes`, `otherPerformanceType`, `genres`, `soundcloudTrack` and `youtubeVideo`, as above, none of them left
out.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | The set's session, with the set as it was added |

Fails with:

| Status | When |
|---|---|
| 400 | A field isn't valid, a performer doesn't exist, a link isn't one of those above, or SoundCloud shows no track at `soundcloudTrack` |
| 404 | There's no such session, which is checked before the track is resolved |
| 409 | The session is cancelled, which is checked before the track is resolved too, or the set's track or its video is another set's, with what's in the way in `session` and `set` (see [Rules](#rules)). Or `soundcloudTrack` has to be resolved and the credentials of the SoundCloud app haven't been entered yet, with both null |
| 502 | `soundcloudTrack` has to be resolved, and SoundCloud can't be reached, or answers unexpectedly |

When it fails, nothing is saved.

## `PUT /api/admin/sets/:id` (admin)

Replaces a set's fields, even when its session is cancelled, but not its session or its status. It takes the same
request as `POST /api/admin/sessions/:id/sets`, responds like it, with the session as it is then, and fails like it, but
with 404 when there's no such set, which is checked before the track is resolved, and without the 409 for a cancelled
session.

## `PATCH /api/admin/sets/:id` (admin)

Changes the fields of a set it's sent, like `PUT /api/admin/sets/:id`, and leaves the others as they are (see
[Changes, in Conventions](README.md#conventions)). It takes any of the fields that `PUT` takes. `performers`, when it's
sent, replaces the set's performers, and `soundcloudTrack` is only resolved when it's sent. An offset and a duration are
checked together, as the set would then be. Responds like `PUT`, and fails like it, but with 400 when there's no
field.

## `PUT /api/admin/sets/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"planned"`, `"done"` or `"cancelled"` | |

Changes a set's status, and responds like `POST /api/admin/sessions/:id/sets`. Fails with 400 if `status` isn't one of
these values, 404 when there's no such set, or 409 when the set wouldn't be cancelled anymore while its session is,
with that session in `session`.

## `DELETE /api/admin/sets/:id` (admin)

Deletes a set, and responds `{"ok": true}`. Its performers stay. Fails with 404 when there's no such set.
