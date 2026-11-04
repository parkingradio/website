# Sessions

What's played at the studio: **sessions**, the occasions at the studio, and the **sets** played during them, with who
played, what they did, and where the recordings are. A session is e.g. an evening of three artists, or a collective's
4-hour takeover. A set is one performance during a session, usually about an hour, streamed as its own YouTube live and
uploaded as its own SoundCloud track: a 4-hour takeover is one session of 4 sets. The recordings stay on SoundCloud and
YouTube, which the server only links to. Sessions and sets are only reachable by admins for now. They have nothing to do
with admins' sessions, which are about logging in (see [Sessions, in Admins](admins.md#sessions)).

Each session is a row of the `sessions` table (`server/src/db/schema.ts`), and each set a row of `sets`, with its
performers in `set_performers`. The rules each of their fields follows are the schemas `SessionFields` and `SetFields`
of `server/src/sessions/fields.ts`. The server checks every session and set it's sent against them, then against the
[rules](#rules) that involve other sessions and sets. Its errors are in English, since only admins see them.

## Sessions

A session has:

| Field | Type | |
|---|---|---|
| `start` | string or null | When the session starts, or null for a session whose date isn't known yet: see [Times](#times) |
| `durationMinutes` | number | How long the session lasts: see [Times](#times) |
| `takeover` | object or null | The collective whose takeover the session is: see [Takeovers](#takeovers) |
| `name` | string | The session's name, as free text, like the event of a track's title (see [The rotation](radio.md#the-rotation)), e.g. `"HAUTE RIVE TAKEOVER"`. Each run of spaces, tabs or line breaks becomes a single space, and it's trimmed, then up to 100 characters, or `""` when there's none |
| `raEvent` | object or null | The session's event on Resident Advisor: see [Links](#links) |

A session, as the endpoints below return it, also has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `end` | string or null | When the session ends: its `start` plus its `durationMinutes`, or null when it has no `start` |
| `sets` | list of sets | Its sets, by `offsetMinutes`, then `createdAt`, the sets without an offset last, cancelled ones included |
| `createdAt` | string | When the session was added |
| `createdBy` | string | The email of the admin who added it |
| `updatedBy`, `updatedAt` | string or null | Who last changed the session (an admin's email), and when. Status changes don't count, and neither do changes to its sets, or the takeover's collective being deleted |
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
| `createdAt` | string | When the set was added |
| `createdBy` | string | The email of the admin who added it |
| `updatedBy`, `updatedAt` | string or null | Who last changed the set (an admin's email), and when. Status changes don't count, and neither do changes to its session, e.g. moving it, or a performer being deleted |
| `status` | `"planned"`, `"done"` or `"cancelled"` | See [Status](#status) |
| `statusUpdatedBy`, `statusUpdatedAt` | string or null | Who last changed the status (an admin's email), and when |

## Times

A session has a start, which can be null, and a duration, which can't. A session without a start is one whose date
isn't known yet, e.g. a collective's artists grouped into a takeover while it's being planned. Requests send `start` as
an instant, with its offset from UTC, e.g. `"2026-11-14T21:00-05:00"`, or as null, or a blank string, for none.
Responses give it, and the `start` and `end` the server works out, in Québec time, to the second, with the offset in
effect then, e.g. `"2026-11-14T21:00:00-05:00"` (see [Times, in Conventions](README.md#conventions)). A start is from
the year 2000 to the year 2999, in UTC, and can be in the past or in the future. The `start` and `end` of the events
that [`GET /api/events`](events.md#get-apievents) gives, which sessions link to (see [Links](#links)), are local times
instead, without an offset, as RA gives them.

A set's place in its session is relative to the session's start: its `offsetMinutes`, and its `durationMinutes`, so that
moving a session moves its sets with it. Either can be null, e.g. while the order of the sets isn't known yet, but a set
with an offset also has a duration.

Durations and offsets are whole numbers of minutes, of time that actually passes, whatever the clocks say: a session
from 21:00 to 2:00 on the night the clocks go back an hour lasts 360 minutes, not 300. A duration is from 1 minute to 24
hours (1440 minutes), and an offset is from 0 to 1439 minutes.

## Rules

- **Sessions don't overlap**, unless one of them is cancelled or has no start: there's one studio. A session takes from
  its start, included, to its end, excluded, so a session can start when the one before it ends.
- **A set fits in its session**: its offset plus its duration, or its duration alone when it has no offset, is no more
  than the session's duration. A set without a duration always fits. Cancelled sets count too.
- **A session's sets don't overlap each other**, unless one of them is cancelled or has no offset. A set takes from its
  offset, included, to its offset plus its duration, excluded, so a set can start when the one before it ends. Since
  sets fit in their sessions, and sessions don't overlap, there's one live at a time.
- **A SoundCloud track, or a YouTube video, belongs to at most one set**, cancelled ones included.

Requests that would break a rule fail with 409, even when they're sent at the same time: when two requests would break a
rule together, one of them fails. That's the case for:

- adding or changing a session so that it overlaps another one, or un-cancelling it when it would then overlap one,
- changing a session's duration so that one of its sets doesn't fit in it anymore (changing its start never does that),
- adding or changing a set so that it doesn't fit in its session, or overlaps another of the session's sets, or
  un-cancelling a set when it would then overlap one,
- adding a set to a cancelled session, or un-cancelling a set of a cancelled session (see [Status](#status)),
- giving a set a track or a video that's another set's.

A set that doesn't fit is a 409 too, rather than a 400, since it depends on its session as it is when the set is saved.

These 409s also have `session` and `set`, what's in the way, as the endpoints return them, so that it can be named and
linked to without another request. `set` is the set in the way, if it's a set, or else null, and `session` is the session
in the way, or that set's session. A set that doesn't fit, or is added to or un-cancelled in a cancelled session, has its
own session in the way. When several things are in the way, it's one of them. Both are null for the 409s that aren't
about a session or a set.

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
of its artists do, during its takeover (see [Takeovers](#takeovers)).

Requests send the performers as a list of objects, in order, each one `{"id": <id>}`, an artist's id. Other fields are
ignored, so that the performers a set returns can be sent back as they are. A performer that's there twice, whatever the
case of its id, is dropped, keeping the first. A performer that isn't an object with an `id` that's a string, or whose
`id` isn't that of an artist who exists, fails with 400 (`"No such artist"`).

Responses list them as objects with the `id` and `name` of each one, in order.

Deleting an artist takes them out of their sets, which stay as they are, even without performers. Changing such a set
then takes at least one performer again, but its status can still be changed.

## Takeovers

A session can be a collective's takeover. The performers of its sets are usually the collective's artists, but they
don't have to be, e.g. for a guest. The `name` is separate, since not every session is a takeover.

Requests send `takeover` as the collective's id, or null, or a blank string, when there's none. A `takeover` that isn't
a string or null fails with 400 (`"The takeover must be a collective's id, or null"`), and a string that isn't the id of
a collective that exists with 400 (`"No such collective"`). Responses give it as an object with the collective's `id` and
`name`, or null.

Deleting a collective leaves the sessions of its takeovers without a takeover: they stay as they are otherwise.

## Links

Requests send each of these as a string, or null, or a blank string, when there's none. Links can be `http://` or
`https://` ones, with or without `www.` or `m.`, and a trailing `/` and parameters, e.g. `?si=...`, are allowed:

- A session's `raEvent`: the event's id on RA, which is only digits, up to 20, as
  [`GET /api/events`](events.md#get-apievents) gives it, e.g. `"6683745"`, or a link to its page,
  `https://ra.co/events/<id>`. It isn't checked against RA, so events older than those `GET /api/events` returns can be
  pasted. Several sessions can have the same one.
- A set's `soundcloudTrack`: a link to the track on soundcloud.com, e.g.
  `https://soundcloud.com/parkingdotradio/3tons`, or a private track's private link, which ends with its secret, e.g.
  `https://soundcloud.com/parkingdotradio/3tons/s-AbC123`. Other links, e.g. the `on.soundcloud.com` ones that
  SoundCloud's app shares, fail with 400. The link is reduced to `https://soundcloud.com/<account>/<track>`, with
  `/s-<secret>` for a private link. When the set is saved, the server resolves it to the track through the SoundCloud
  app (see [The SoundCloud app](radio.md#the-soundcloud-app)), and refuses links where SoundCloud shows no track. The
  track can be any track SoundCloud shows. A link that reduces to the set's track's `url` isn't resolved again, so that
  a set can be changed while SoundCloud can't be reached.
- A set's `youtubeVideo`: a link to the video on YouTube, as `youtube.com/watch?v=<id>`, `youtu.be/<id>`,
  `youtube.com/live/<id>`, `youtube.com/shorts/<id>` or `youtube.com/embed/<id>`, or the video's id itself, which is 11
  letters, digits, `-` or `_`. The link is reduced to the video's id. It isn't checked against YouTube.

Responses give each one as an object, or null when there's none, with an `id` and a `url`:

| Field | `id` | `url` |
|---|---|---|
| `raEvent` | The event's id on RA | `https://ra.co/events/<id>` |
| `soundcloudTrack` | SoundCloud's id for the track, which doesn't change when the track is renamed | The link it was resolved from, reduced as above: a private track's private link mustn't be shown to the public |
| `youtubeVideo` | The video's id | `https://www.youtube.com/watch?v=<id>` |

## `GET /api/admin/sessions[?artist=<id>|?takeover=<id>]` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many sessions `sessions` has (see [Conventions](README.md#conventions)) |
| `sessions` | list of sessions | Whatever their status. The sessions without a start come first, the most recently added first, then the others, the most recent first (by `start`, then `createdAt`). With `artist`, only the sessions with at least one set, whatever its status, that has that artist among its performers, with all of their sets. With `takeover`, only that collective's takeovers. An unknown artist or collective has none |

Fails with 400 if `artist` or `takeover` is given more than once, or if both are given.

## `GET /api/admin/sessions/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | |

Fails with 404 when there's no such session.

## `POST /api/admin/sessions` (admin)

Adds a session, as `"planned"`, without sets. The request has the session's `start`, `durationMinutes`, `takeover`,
`name` and `raEvent`, as above, none of them left out.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | As it was added |

Fails with:

| Status | When |
|---|---|
| 400 | A field isn't valid, the takeover's collective doesn't exist, or `raEvent` isn't one of the links above |
| 409 | The session would overlap another one, which is in `session` (see [Rules](#rules)) |

When it fails, nothing is saved.

## `PUT /api/admin/sessions/:id` (admin)

Replaces a session's fields, but not its status or its sets, which move with its start. It takes the same request as
`POST /api/admin/sessions`, responds like it, with the session as it is then, and fails like it. It also fails with 409
when one of the session's sets wouldn't fit in it anymore, with that set in `set`, and with 404 when there's no such
session.

## `PUT /api/admin/sessions/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"planned"`, `"done"` or `"cancelled"` | |

Changes a session's status, and its sets' when it's cancelled (see [Status](#status)), and responds like
`POST /api/admin/sessions`, with its sets as they are then. Fails with 400 if `status` isn't one of these values, 404 when
there's no such session, or 409 when the session would then overlap another one, with that session in `session`.

## `DELETE /api/admin/sessions/:id` (admin)

Deletes a session and its sets, and responds `{"ok": true}`. Their performers stay. Fails with 404 when there's no such
session.

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
| 409 | The session is cancelled, which is checked before the track is resolved too, or the set wouldn't fit in it, or would overlap another of its sets, or its track or its video is another set's, with what's in the way in `session` and `set` (see [Rules](#rules)). Or `soundcloudTrack` has to be resolved and the credentials of the SoundCloud app haven't been entered yet, with both null |
| 502 | `soundcloudTrack` has to be resolved, and SoundCloud can't be reached, or answers unexpectedly |

When it fails, nothing is saved.

## `PUT /api/admin/sets/:id` (admin)

Replaces a set's fields, even when its session is cancelled, but not its session or its status. It takes the same
request as `POST /api/admin/sessions/:id/sets`, responds like it, with the session as it is then, and fails like it, but
with 404 when there's no such set, which is checked before the track is resolved, and without the 409 for a cancelled
session.

## `PUT /api/admin/sets/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"planned"`, `"done"` or `"cancelled"` | |

Changes a set's status, and responds like `POST /api/admin/sessions/:id/sets`. Fails with 400 if `status` isn't one of
these values, 404 when there's no such set, or 409 when the set wouldn't be cancelled anymore while its session is, or
would then overlap another of its session's sets, with what's in the way in `session` and `set`.

## `DELETE /api/admin/sets/:id` (admin)

Deletes a set, and responds `{"ok": true}`. Its performers stay. Fails with 404 when there's no such set.
