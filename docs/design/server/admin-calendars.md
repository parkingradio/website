# Admins' calendars

Admins' calendars, which each admin subscribes to in their calendar app, so that it shows what takes the studio, and its
available time:

- [`GET /sessions.ics`](#get-sessionsics): the sessions, announced or not (see [Sessions](sessions.md)).
- [`GET /occupations.ics`](#get-occupationsics): the occupations, read from the `occupations` calendar feeds (see
  [Calendar](calendar.md)).
- [`GET /availability.ics`](#get-availabilityics): the studio's available time (see
  [Availability, in Calendar](calendar.md#availability)).

They're separate calendars rather than one, so that calendar apps show, hide and color them separately: a subscription
is one calendar in every app. Like the calendar feed of the public events
([`GET /calendar.ics`](events.md#get-calendarics)), they aren't JSON, so they aren't under `/api`. Calendar apps can't
log in, so it's a token in their link that gives access to them, rather than an admin's session. They aren't tools of
the [MCP server](mcp.md), nor are the endpoints of the token, since their links are secrets.

## The token

Each admin has one token, for all the calendars, which is in their links: `<site>/sessions.ics?token=<token>`,
`<site>/occupations.ics?token=<token>` and `<site>/availability.ics?token=<token>`, where `<site>` is the site's
address, e.g. `https://parking.radio`. Tokens are random, so they can't be guessed. Unlike the other tokens the server
gives out, e.g. those of apps (see [OAuth](oauth.md#connections)), the server keeps the token itself, so that the admin
pages can show the links again whenever the admin asks for them
([`GET /api/admin/ics-subscription-token`](#get-apiadminics-subscription-token-admin)).

The links are only given to their admin. Whoever has them can read the calendars, until the token is replaced:

- **Replacing it**, e.g. when a link was shared by mistake
  ([`POST /api/admin/ics-subscription-token`](#post-apiadminics-subscription-token-admin)), makes the previous links
  stop working. Calendar apps subscribed with them keep what they already have, but get nothing new.
- **Revoking the admin** makes their links stop working (see [Admins](admins.md)). Choosing a new password doesn't:
  unlike their sessions and connections, their links keep working, since every calendar app they subscribed in would
  otherwise have to subscribe again.

The token is in the links, so it can end up in logs other than the server's, e.g. a proxy's, or a calendar app's, and
a calendar app that reads a `webcal` link over http sends it unencrypted until it's redirected to https. The server's
own logs never have it, since they leave out the values of query strings (see
[Logs, in Conventions](README.md#conventions)). There's no rate limit (see
[Rate limits, in Conventions](README.md#conventions)).

## The calendars

The calendars are in iCalendar (RFC 5545), and each takes one query parameter, `token`, the admin's token. Their
requests fail with 403, and an error that doesn't quote the token, when `token` is missing, given more than once, or
isn't an admin's token, before anything else is read. Not 401, which only admin endpoints give (see
[Admin endpoints, in Conventions](README.md#conventions)), and which some calendar apps take as a request for a user
name and a password. Other query parameters are ignored.

Unless they fail, they respond with a calendar, even without any event, with `Content-Type: text/calendar;
charset=utf-8`. Every response, whether they succeed or fail, has `Cache-Control: no-store`: unlike `/calendar.ics`,
they're never kept, by browsers, calendar apps or what's between them and the server.

A calendar has `VERSION:2.0`, a `PRODID`, and its name, in both `NAME` and `X-WR-CALNAME`: "Parking Radio · sessions",
"Parking Radio · occupations" or "Parking Radio · disponibilités", with the server's environment after "Parking Radio"
outside production, as the [MCP server](mcp.md#the-endpoint)'s name has it, e.g. "Parking Radio (test) · sessions", so
that admins tell their environments' calendars apart. It asks apps to read it again every 15 minutes
(`REFRESH-INTERVAL;VALUE=DURATION:PT15M` and `X-PUBLISHED-TTL:PT15M`), which some of them do, while others keep their
own schedule, e.g. up to a day.

Its events are `VEVENT`s, each with a `UID`, which stays the same as long as it's the same event, so that a change
updates it in calendars rather than adding another one, a `DTSTAMP`, the time of the request, a `DTSTART` and a `DTEND`,
and `TRANSP:TRANSPARENT`, so that calendar apps don't show the admin as busy then: these calendars are about the studio,
not the admin's own time. Times are in UTC, e.g. `20261115T020000Z`, and what takes whole days, i.e. whole-day
occupations and the events about feeds whose last read failed, has dates (`VALUE=DATE`), in Québec, e.g. `20261115`,
with the day after the last one as `DTEND`. Text values are escaped and folded as in
[`GET /calendar.ics`](events.md#get-calendarics).

## `GET /sessions.ics`

The sessions with a start, whatever their status, announced or not, that end after a year back (see
[A year back, in Conventions](README.md#conventions)), however far ahead. Sessions without a start aren't in it. Each one
is a `VEVENT` with:

| Property | Value |
|---|---|
| `UID` | `session-<id>@parking.radio`, from its `id`: not the `UID` of its event in `/calendar.ics`, which is another calendar's |
| `DTSTART`, `DTEND` | Its `start` and `end` |
| `SUMMARY` | Its `title`, after `[UNANNOUNCED] ` for a session that isn't announced, and before that, `[CANCELLED] ` for a cancelled one, e.g. `[CANCELLED] [UNANNOUNCED] GUEST MIXES` |
| `STATUS` | `CANCELLED` for a cancelled session, which stays in the calendar. Other sessions don't have one |
| `LOCATION` | `parking.radio` |
| `DESCRIPTION` | As in `/calendar.ics`: the names of its lineup (see [What's public, in Events](events.md#whats-public)), then its `effectiveDescription`, with "OPEN JAM" for a synth meetup without a lineup that isn't cancelled |
| `URL` | Its page on the admin pages, `<site>/admin/sessions/<id>` |

## `GET /occupations.ics`

The occupations, as the server has them from the last reads of the `occupations` calendar feeds (see
[Reading the feeds, in Calendar](calendar.md#reading-the-feeds)): a feed whose last read failed still gives what it read
before, as [`GET /api/admin/calendar`](calendar.md#get-apiadmincalendar-admin) does, and nothing when no read of it
succeeded. It has those that end after a year back (see [A year back, in Conventions](README.md#conventions)), among
what reads keep, from a year before them to two years after them (see [Events, in Calendar](calendar.md#events)).

Until every `occupations` feed has been read with the link it has, since the server started, whether that read
succeeded or failed, it fails with 503, rather than give a calendar without the occupations of the feeds that haven't
been read yet: calendar apps keep what they had, rather than remove those occupations after the server restarts, e.g.
after each deploy, and add them back once they read it again, which can take a day. A feed whose link changed, e.g.
through another server, waits likewise for its new link to be read. Without any `occupations` feed, it gives an empty
calendar. `holds` feeds don't count: their holds aren't in it, and neither are their failed reads.

Each occupation is a `VEVENT` with:

| Property | Value |
|---|---|
| `UID` | Made from what the occupation is: its feed's id, its start and end, whether it takes whole days, and its title, so that it's the same from one read to the next as long as its event doesn't change. Occupations that are the same in all of these (see [The calendar](calendar.md#the-calendar)) still have different `UID`s |
| `DTSTART`, `DTEND` | Its `start` and `end`: dates for a whole-day occupation, which stays whole-day, and times otherwise |
| `SUMMARY` | What it is, as the admin pages name it: its title, then its feed's name in parentheses, e.g. `Réparation (Calendrier de l'équipe)`, or its feed's name alone when it has no title |

`occupations` feeds whose last read failed are in it too, so that admins who only look at their calendar app find out
that what it shows of them can be missing or out of date: each one is a whole-day `VEVENT` on today, in Québec, with:

| Property | Value |
|---|---|
| `UID` | `feed-<id>@parking.radio`, from the feed's id, so that calendar apps move it from one day to the next, rather than keep one for each day |
| `DTSTART`, `DTEND` | Today, in Québec |
| `SUMMARY` | `[REFRESH ERROR] `, then the feed's name |
| `DESCRIPTION` | That its last read failed, why (the feed's `error`, which never has its link, see [Feeds, in Calendar](calendar.md#feeds)), and when it was last read successfully, in Québec time, or that it hasn't been since the server started |
| `URL` | The Calendrier page, `<site>/admin/calendrier` |

## `GET /availability.ics`

The studio's available time (see [Availability, in Calendar](calendar.md#availability)) from a year back (see
[A year back, in Conventions](README.md#conventions)) to the end of the year ahead (see
[The calendar, in Calendar](calendar.md#the-calendar)), worked out as
[`GET /api/admin/calendar`](calendar.md#get-apiadmincalendar-admin) does: a feed whose last read failed still counts
with what it read before. It has one event per stretch, whole, e.g. across midnight or a year back, except the one going
on at the end of the year ahead, which ends there. Its name and its stretches' `SUMMARY` are in French, unlike the rest
of these calendars: « disponible » is what the admin pages call available time, so that admins recognize it.

Without any `holds` feed, there's no available time, and it gives an empty calendar right away. Otherwise, like
[`GET /occupations.ics`](#get-occupationsics), it fails with 503 until every feed, of both kinds, has been read with the
link it has since the server started, whether that read succeeded or failed, since available time comes from both.

Each stretch is a `VEVENT` with:

| Property | Value |
|---|---|
| `UID` | `availability-<environment>-<start>@parking.radio`, from the server's environment, e.g. `production`, and its start in UTC, as in `DTSTART`, e.g. `availability-production-20261125T050000Z@parking.radio`. Stretches never overlap, so no two have the same start, and environments have their own, so that an app subscribed to two environments' calendars keeps each one's. A stretch whose start changes is another event, e.g. one whose beginning a session takes, while one whose end changes is the same event, e.g. the one the end of the year ahead cuts |
| `DTSTART`, `DTEND` | Its `start` and `end`, as times, even from 00:00 to 00:00 |
| `SUMMARY` | `disponible` |
| `URL` | Calendrier on the day it starts, in Québec, `<site>/admin/calendrier?day=<YYYY-MM-DD>` |

While there's a `holds` feed, the feeds whose last read failed, of both kinds, are in it too, as in
[`GET /occupations.ics`](#get-occupationsics), since its available time can then be wrong or out of date, but with
`availability-feed-<id>@parking.radio` as their `UID`, so that each calendar has its own: an `occupations` feed whose
last read failed shows in both calendars of an admin subscribed to both.

## `GET /api/admin/ics-subscription-token` (admin)

The logged-in admin's token (see [The token](#the-token)), which they get the first time they ask for it, and which
stays the same until it's replaced.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `token` | string | The token of the admin's links |

## `POST /api/admin/ics-subscription-token` (admin)

Takes no body. Replaces the logged-in admin's token with a new one, which makes their previous links stop working, and
responds with the new one, as [`GET /api/admin/ics-subscription-token`](#get-apiadminics-subscription-token-admin) does.
