# Events

Parking Radio's events are managed on Resident Advisor, under the Parking Radio promoter page
(`https://ra.co/promoters/183980`).

## Reading the events from RA

RA has no public API, so the server uses the GraphQL endpoint ra.co itself calls (`https://ra.co/graphql`), which is
undocumented and could change. The server asks RA for every event of the promoter, upcoming and past, checks RA's answer
against a schema and keeps the outcome, successful or not, for 2 minutes, so RA is asked at most that often, whatever
the requests, and the events are at most 2 minutes old. In case RA's private API changes, this should make it possible
to quickly notice the problem and get it fixed.

RA tells which events are upcoming and which are past: the server lists them as RA does. An event is never in both:
one that RA has in both is upcoming.

RA has no notion of event categories, so the server derives one for each event from its title, so that the client
doesn't have to guess from titles itself. For now, the only category is synth meetups (events whose title has "synth
meetup" in it, whatever its case, e.g. "SYNTH MEETUPS" on RA); every other event is categorized as "other".

An event's lineup is the "Line-up" text on the RA event, as plain text, one act per line, without blank or repeated
lines, or its tagged artists if that leaves nothing.

An event's `id` is its id on RA, which is what a session's `raEvent` takes (see [Links](sessions.md#links)).

## Times

An event's `start` and `end` are instants, in Québec time, with the offset from UTC in effect then, like every instant
the API gives (see [Times, in Conventions](README.md#conventions)), e.g. `"2026-11-14T21:00:00-05:00"`. RA gives them as
local dates and times, without an offset, which the server reads in the time zone of the event's venue, as RA gives it,
or in Québec's when RA gives none, or one that isn't known. So an event abroad starts at a different time in Québec time
than on its RA page. A local time that the clocks show twice in that time zone, as they go back, is the first of the
two instants, and one that they skip, as they go forward, is moved forward by as much as they skip, e.g. 2:30 becomes
3:30.

## Time ranges

Without a time range, [`GET /api/events`](#get-apievents) gives every upcoming event, but only the 20 most recent past
ones. With one, it gives every event that starts in that range, upcoming or past, from all of the promoter's events: to
go through past events, ask for a range, e.g. a few months at a time, since there are many of them. A range is given by
`from` and `to`, instants like those requests send (see [Times, in Conventions](README.md#conventions)), each with the
offset in effect at that time, and gives the events that start at or after `from` and before `to`. `from` alone gives
those from then on, and `to` alone those before it. E.g. for October 2026: `from` `"2026-10-01T00:00-04:00"`, `to`
`"2026-11-01T00:00-04:00"`.

## `GET /api/events`

Every query parameter can be left out (see [Time ranges](#time-ranges)):

| Query parameter | |
|---|---|
| `from` | An instant: only the events that start at that instant or after it |
| `to` | An instant: only the events that start before it |

| Response field | Type | |
|---|---|---|
| `promoterUrl` | string | Parking Radio's page on RA |
| `upcoming` | list of events | Every upcoming one, or those in the time range, the soonest first (by `start`) |
| `past` | list of events | The 20 most recent, or every one in the time range, the most recent first (by `start`) |

An event has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `category` | `"synth-meetup"` or `"other"` | Derived from the title |
| `start` | string | When it starts: an instant, in Québec time (see [Times](#times)) |
| `end` | string or null | When it ends, the same way |
| `venue` | string or null | |
| `city` | string or null | |
| `lineup` | list of strings | |
| `url` | string | The event's page on RA |
| `flyer` | string or null | Full size, on images.ra.co |

Fails with 400 if a query parameter is given more than once, if `from` or `to` is empty or isn't an instant with
Québec's offset then, from the year 2000 to 2999, in UTC, or if `from` isn't before `to`. Fails with 502 when the events
can't be read from RA, or when RA's list of upcoming or past events may have been cut short, with a time range or
without.
