# Subscriptions

Admins' own calendar feeds, which each admin subscribes to in their calendar app, so that it shows what takes the studio:

- [`GET /sessions.ics`](#get-sessionsics): the sessions, announced or not (see [Sessions](sessions.md)).
- [`GET /occupations.ics`](#get-occupationsics): the occupations, read from the calendar feeds (see
  [Calendar](calendar.md)).

They're two feeds rather than one, so that calendar apps show, hide and color them separately: a subscription is one
calendar in every app. Like the calendar feed of the public events ([`GET /calendar.ics`](events.md#get-calendarics)),
they aren't JSON, so they aren't under `/api`. Calendar apps can't log in, so it's a token in their link that gives
access to them, rather than an admin's session. They aren't tools of the [MCP server](mcp.md), nor are the endpoints of
the token, since their links are secrets.

## The token

Each admin has one token, for both feeds, which is in their links: `<site>/sessions.ics?token=<token>` and
`<site>/occupations.ics?token=<token>`, where `<site>` is the site's address, e.g. `https://parking.radio`. Tokens are
random, so they can't be guessed. Unlike the other tokens the server gives out, e.g. those of apps (see
[OAuth](oauth.md#connections)), the server keeps the token itself, so that the admin pages can show the links again
whenever the admin asks for them ([`GET /api/admin/subscription-token`](#get-apiadminsubscription-token-admin)).

The links are only given to their admin. Whoever has them can read both feeds, until the token is replaced:

- **Replacing it**, e.g. when a link was shared by mistake
  ([`POST /api/admin/subscription-token`](#post-apiadminsubscription-token-admin)), makes the previous links stop
  working. Calendar apps subscribed with them keep what they already have, but get nothing new.
- **Revoking the admin** makes their links stop working (see [Admins](admins.md)). Choosing a new password doesn't:
  unlike their sessions and connections, their links keep working, since every calendar app they subscribed in would
  otherwise have to subscribe again.

The token is in the links, so it can end up in logs other than the server's, e.g. a proxy's, or a calendar app's. The
server's own logs never have it, since they leave out the values of query strings (see
[Logs, in Conventions](README.md#conventions)). There's no rate limit (see [Conventions](README.md#conventions)).

## The feeds

Both feeds are in iCalendar (RFC 5545), and take one query parameter, `token`, the admin's token. Their requests fail
with 403, and an error that doesn't quote the token, when `token` is missing, given more than once, or isn't an admin's
token, before anything else is read. Not 401, which only admin endpoints give (see
[Admin endpoints, in Conventions](README.md#conventions)), and which some calendar apps take as a request for a user name
and a password. Other query parameters are ignored.

They respond with `Content-Type: text/calendar; charset=utf-8` and `Cache-Control: no-store`: unlike `/calendar.ics`,
they're never kept, by browsers, calendar apps or what's between them and the server. Unless they fail, they respond with
a calendar, even without any event. A calendar has `VERSION:2.0`, a `PRODID`, and its name, in both `NAME` and
`X-WR-CALNAME`: "Parking Radio · sessions" or "Parking Radio · occupations", with the server's environment after
"Parking Radio" outside production, as the [MCP server](mcp.md#the-endpoint)'s name has it, e.g. "Parking Radio (test) ·
sessions", so that admins tell their environments' calendars apart. It asks apps to read it again every 15 minutes
(`REFRESH-INTERVAL;VALUE=DURATION:PT15M` and `X-PUBLISHED-TTL:PT15M`), which some of them do, while others keep their
own schedule, e.g. up to a day.

Its events are `VEVENT`s, each with a `UID`, which stays the same as long as it's the same event, so that a change updates
it in calendars rather than adding another one, a `DTSTAMP`, the time of the request, and a `DTSTART` and a `DTEND`. Times
are in UTC, e.g. `20261115T020000Z`, and whole days are dates (`VALUE=DATE`), in Québec, e.g. `20261115`, with the day
after the last one as `DTEND`. Text values are escaped and folded as in [`GET /calendar.ics`](events.md#get-calendarics).

## `GET /sessions.ics`

The sessions with a start, whatever their status, announced or not: every one that starts at most a year before the
request, and every one whose end hasn't passed, like the events of [`GET /calendar.ics`](events.md#get-calendarics).
Sessions without a start aren't in it. Each one is a `VEVENT` with:

| Property | Value |
|---|---|
| `UID` | `session-<id>@parking.radio`, from its `id`: not the `UID` of its event in `/calendar.ics`, which is another calendar's |
| `DTSTART`, `DTEND` | Its `start` and `end` |
| `SUMMARY` | Its `title`, after `[UNANNOUNCED] ` for a session that isn't announced, and before that, `[CANCELLED] ` for a cancelled one, e.g. `[CANCELLED] [UNANNOUNCED] GUEST MIXES` |
| `STATUS` | `CANCELLED` for a cancelled session, which stays in the feed. Other sessions don't have one |
| `LOCATION` | `parking.radio` |
| `DESCRIPTION` | As in `/calendar.ics`: the names of its lineup (see [What's public, in Events](events.md#whats-public)), then its `effectiveDescription`, with "OPEN JAM" for a synth meetup without a lineup that isn't cancelled |
| `URL` | Its page on the admin pages, `<site>/admin/sessions/<id>` |

## `GET /occupations.ics`

The occupations, as the server has them from the last reads of the calendar feeds (see
[Reading the feeds, in Calendar](calendar.md#reading-the-feeds)): a feed whose last read failed still gives what it read
before, as [`GET /api/admin/calendar`](calendar.md#get-apiadmincalendar-admin) does, and nothing when no read of it
succeeded. They cover what reads keep, from a year before them to two years after them (see
[Events, in Calendar](calendar.md#events)).

Until every feed has been read once since the server started, whether that read succeeded or failed, it fails with 503,
rather than give a calendar without the occupations of the feeds that haven't been read yet: calendar apps keep what
they had, rather than remove those occupations after the server restarts, e.g. after each deploy, and add them back once
they read the feed again, which can take a day. Without any feed, it gives an empty calendar.

Each occupation is a `VEVENT` with:

| Property | Value |
|---|---|
| `UID` | Made from what the occupation is: its feed's id, its start and end, whether it takes whole days, and its title, so that it's the same from one read to the next as long as its event doesn't change. Occupations that are the same in all of these (see [The calendar](calendar.md#the-calendar)) still have different `UID`s |
| `DTSTART`, `DTEND` | Its `start` and `end`: dates for a whole-day occupation, which stays whole-day, and times otherwise |
| `SUMMARY` | What it is, as the admin pages name it: its title, then its feed's name in parentheses, e.g. `Réparation (Calendrier de l'équipe)`, or its feed's name alone when it has no title |

Feeds whose last read failed are in it too, so that admins who only look at their calendar app find out that what it
shows of them can be missing or out of date: each one is a whole-day `VEVENT` on today, in Québec, with:

| Property | Value |
|---|---|
| `UID` | `feed-<id>@parking.radio`, from the feed's id, so that calendar apps move it from one day to the next, rather than keep one for each day |
| `DTSTART`, `DTEND` | Today, in Québec |
| `SUMMARY` | `[NOT READ] `, then the feed's name |
| `DESCRIPTION` | That its last read failed, why (the feed's `error`, which never has its link, see [Feeds, in Calendar](calendar.md#feeds)), and when it was last read successfully, in Québec time, or that it hasn't been since the server started |
| `URL` | The Calendrier page, `<site>/admin/calendrier` |

## `GET /api/admin/subscription-token` (admin)

The logged-in admin's token (see [The token](#the-token)), which they get the first time they ask for it, and which stays
the same until it's replaced.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `token` | string | The token of the admin's links |

## `POST /api/admin/subscription-token` (admin)

Takes no body. Replaces the logged-in admin's token with a new one, which makes their previous links stop working, and
responds with the new one, as [`GET /api/admin/subscription-token`](#get-apiadminsubscription-token-admin) does.
