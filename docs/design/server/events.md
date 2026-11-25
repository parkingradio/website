# Events

Parking Radio's public schedule. Publicly, an **event** is an announced [session](sessions.md), with its sets: what's
played at the studio, once admins have made it public (see [Announced](sessions.md#announced)). It has the session's id.
The events are also a calendar feed, which calendar apps subscribe to (see [`GET /calendar.ics`](#get-calendarics)).
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
| `flyer` | object or null | Where the public gets the sizes of its flyer, by width, like an artist's photo (see [Public profiles, in Artists](artists.md#public-profiles)), e.g. `/api/events/flyers/<sha256>/w320.webp`, or null when it has none. Events that have the same flyer give the same URLs |
| `raEvent` | string or null | The page of its event on RA, `https://ra.co/events/<id>`, or null when it has none |
| `takeover` | object or null | The collective whose takeover it is, with its `id` and `name`, or null when it isn't a takeover |
| `sets` | list of sets | Its sets, in their order, cancelled ones included (see [Sets' order](sessions.md#sets-order)) |
| `lineup` | list of objects | Its lineup: the performers of its sets that aren't cancelled, in the sets' order then each set's performers' order, each artist once, even when another artist has the same name, with their `id` and `name`, like a set's `performers`. It's empty when there are none, e.g. for a synth meetup without sets: what to show then is up to each consumer |

A set of an event has:

| Field | Type | |
|---|---|---|
| `id` | string | The set's id |
| `performers` | list of objects | Its performers, in order, each with their `id` and `name` |
| `durationMinutes` | number or null | |
| `performanceTypes`, `otherPerformanceType`, `genres` | | As the admin endpoints give them (see [Sets](sessions.md#sets)) |
| `cancelled` | boolean | Whether the set is cancelled |
| `soundcloudTrack` | object or null | Its track on SoundCloud, with its `id` and `url`, as the admin endpoints give them (see [Links](sessions.md#links)), except that `url` is null when the set's link is a private link, which ends with its secret: that link would let anyone play the private track, like those of the radio's rotation, which aren't handed out either (see [Radio](radio.md#the-rotation)) |
| `youtubeVideo` | object or null | Its video on YouTube, with its `id` and `url`, as the admin endpoints give it, whatever the video's visibility on YouTube, unlisted included, unlike a SoundCloud track's private link |

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

## `GET /api/events/flyers/:image/:size`

Responds with a size of a flyer that an event has (see [Flyers](sessions.md#flyers)), at the URL that the event gives,
like [`GET /api/artists/photos/:image/:size`](artists.md#get-apiartistsphotosimagesize), with the same caching: whoever
already has it can still show it once its session is un-announced, or its flyer replaced or removed. It's served while
any event has that flyer, even once another one that has it is un-announced. Fails like it, with 404 when no event has
that flyer, e.g. a session that isn't announced, when `:size` isn't the name of one of its sizes, or when that size is
missing.

## `GET /calendar.ics`

The events as a calendar feed, in iCalendar (RFC 5545), which calendar apps subscribe to and read again on their own
schedule, so that their calendar follows as events are announced, changed or cancelled. It's public, and it isn't JSON,
so it isn't under `/api`, nor a tool of the [MCP server](mcp.md). It takes no parameters. Admins also have a private
feed of every session, announced or not, which gives them as this one gives events
([`GET /sessions.ics`](subscriptions.md#get-sessionsics)).

It responds with `Content-Type: text/calendar; charset=utf-8` and `Cache-Control: public, max-age=300`: browsers and
calendar apps can keep it for 5 minutes. Unless it fails unexpectedly (see [Errors, in Conventions](README.md#conventions)),
it responds with a calendar, even without any event.

The calendar has `VERSION:2.0`, a `PRODID`, and is named "Parking Radio", in both `NAME` and `X-WR-CALNAME`, which more
apps read. It asks apps to read it again every hour (`REFRESH-INTERVAL;VALUE=DURATION:PT1H` and `X-PUBLISHED-TTL:PT1H`),
which some of them do, while others keep their own schedule.

It has every event that starts at most a year before the request, and every upcoming one (see
[Upcoming and past](#upcoming-and-past)). Older events fall out of the feed, and so out of subscribers' calendars. Each
event is a `VEVENT` with:

| Property | Value |
|---|---|
| `UID` | `<id>@parking.radio`, from its `id`, so that a change updates the event in calendars rather than adding another one |
| `DTSTAMP` | The time of the request |
| `DTSTART`, `DTEND` | Its `start` and `end`, in UTC, e.g. `20261115T020000Z` |
| `SUMMARY` | Its `title`, or, for a cancelled event, `[CANCELLED] ` then its title, as on [Programmation](../client/programmation.md) |
| `STATUS` | `CANCELLED` for a cancelled event, which stays in the feed. Other events don't have one |
| `LOCATION` | `parking.radio` |
| `DESCRIPTION` | The names of its `lineup`, one per line, then a blank line and its `description`. With an empty lineup, it starts with "OPEN JAM" instead for a synth meetup that isn't cancelled, as on Programmation, and otherwise only has its description. Either can be empty, which leaves out the blank line, and an event without either has no `DESCRIPTION` |
| `URL` | Its `raEvent`, or else the site's Programmation page, e.g. `https://parking.radio/programmation` |

Text values have their backslashes, semicolons, commas and line breaks escaped, and control characters other than tabs
removed, and lines longer than 75 octets are folded, without splitting a character, as RFC 5545 requires.
