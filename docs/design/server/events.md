# Events

Parking Radio's public schedule. Publicly, an **event** is an announced [session](sessions.md), with its sets: what's
played at the studio, once admins have made it public (see [Announced](sessions.md#announced)). It has the session's id.
The admin side keeps calling them sessions. They have nothing to do with RA events, Parking Radio's events on Resident
Advisor, which the server reads from there (see [RA events](ra-events.md)).

## What's public

Every announced session is an event, whatever its status: a cancelled one stays public, marked as cancelled, and so do
its sets, cancelled ones included. Announced sessions always have a start. An event makes public, too, the artists who
are performers of its sets, and the collective whose takeover it is, with its members (see
[Public profiles, in Artists](artists.md#public-profiles) and
[Public profiles, in Collectives](collectives.md#public-profiles)).

An event has:

| Field | Type | |
|---|---|---|
| `id` | string | The session's id |
| `title` | string | The session's `title` |
| `type` | string | The session's `type`, e.g. `"synth-meetup"` (see [Types and names](sessions.md#types-and-names)) |
| `start`, `end` | string | The session's `start` and `end`, which an event always has |
| `cancelled` | boolean | Whether the session is cancelled |
| `description` | string | The session's `effectiveDescription` (see [Descriptions](sessions.md#descriptions)) |
| `flyer` | string or null | Where its flyer is, `/api/events/<id>/flyer`, or null when it has none |
| `raEvent` | string or null | The page of its event on RA, `https://ra.co/events/<id>`, or null when it has none |
| `takeover` | object or null | The collective whose takeover it is, with its `id` and `name`, or null when it isn't a takeover |
| `sets` | list of sets | Its sets, in their order, cancelled ones included (see [Sets' order](sessions.md#sets-order)) |

A set of an event has:

| Field | Type | |
|---|---|---|
| `id` | string | The set's id |
| `performers` | list of objects | Its performers, in order, each with their `id` and `name` |
| `durationMinutes` | number or null | |
| `performanceTypes`, `otherPerformanceType`, `genres` | | As the admin endpoints give them (see [Sets](sessions.md#sets)) |
| `cancelled` | boolean | Whether the set is cancelled |
| `soundcloudTrack` | object or null | Its track on SoundCloud, with its `id` and `url`, as the admin endpoints give them (see [Links](sessions.md#links)), except that `url` is null when the set's link is a private link, which ends with its secret: that link would let anyone play the private track, like those of the radio's rotation, which aren't handed out either (see [Radio](radio.md#the-rotation)) |
| `youtubeVideo` | object or null | Its video on YouTube, with its `id` and `url`, as the admin endpoints give it |

Nothing else is public: not who added or changed a session or a set, their statuses, other than whether they're
cancelled, nor their applications.

## Upcoming and past

An event is upcoming until its `end` has passed, so one that's going on is upcoming, and past from its `end` on. That's
worked out from the time of the request, not from the session's status, which doesn't change as time passes (see
[Status](sessions.md#status)).

Without a time range, [`GET /api/events`](#get-apievents) gives every upcoming event, but only the 20 most recent past
ones. With one, it gives every event that starts in that range, split into upcoming and past the same way. A range is
given by `from` and `to`, instants like those requests send (see [Times, in Conventions](README.md#conventions)), and
gives the events that start at or after `from` and before `to`: `from` alone gives those from then on, and `to` alone
those before it. To go through past events, ask for a range, e.g. a few months at a time.

## `GET /api/events`

Every query parameter can be left out (see [Upcoming and past](#upcoming-and-past)):

| Query parameter | |
|---|---|
| `from` | An instant: only the events that start at that instant or after it |
| `to` | An instant: only the events that start before it |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `upcoming` | list of events | Every upcoming one, or those in the time range, the soonest first (by `start`) |
| `past` | list of events | The 20 most recent, or every one in the time range, the most recent first (by `start`) |

Fails with 400 if a query parameter is given more than once, if `from` or `to` is empty or isn't an instant with
Québec's offset then, from the year 2000 to 2999, in UTC, or if `from` isn't before `to`.

## `GET /api/events/:id/flyer`

Responds with an event's flyer, like [`GET /api/admin/artists/:id/photo`](artists.md#get-apiadminartistsidphoto-admin),
or a 304. Browsers check with the server before showing it again, so it stops being shown once its session is
un-announced. Otherwise, fails with 404 when there's no such event, e.g. a session that isn't announced, when it has no
flyer, or when its flyer is missing.
