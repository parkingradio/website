# Calendar

Parking Radio has one studio, which holds one thing at a time. Two kinds of things take it:

- **Sessions**, which are entered on the site (see [Sessions](sessions.md)).
- **Occupations**: anything else that takes the studio, e.g. repairs, private workshops, or guests staying at the
  studio. They're read from calendars (see [Feeds](#feeds)), e.g. a Google Calendar the team shares, or a private
  calendar of the guests' stays, and each one is known by the name of the calendar it's read from, e.g. "Séjours".

Occupations can't be changed on the site, or with the tools: only in their own calendars. The feeds they're read from
are added, changed and removed on the admin pages, not with the tools, since their links are secrets.

The server gives the studio's calendar: what takes it over a range of days, and what needs settling, its conflicts and
the sessions without a date (see [The calendar](#the-calendar)).

## Feeds

A feed is a calendar that the server reads, in iCalendar (RFC 5545), from its link: an `https` or a `webcal` link, e.g.
the "secret address in iCal format" of a Google Calendar. Each one has a name, e.g. "Calendrier de l'équipe", which its
occupations are known by, and there can be several with the same name.

A feed's titles can be private (`privateTitles`): the server then never keeps, gives or logs its events' titles, so
that they never reach the site or the apps connected to it, e.g. for a calendar of guests' stays, which can have their
names.

A feed's link is a secret, since anyone who has it can read the calendar: the admin pages show it, but it never appears
in the logs, in any error, or in what the [MCP server](mcp.md)'s tools give. Two feeds can't have the same link, where a
`webcal` link is the same as the `https` link it stands for.

A feed has these fields:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `link` | string | Its link, as an `https` link when it was given as a `webcal` one |
| `privateTitles` | boolean | Whether its titles are private |
| `createdBy` | string | The email of the admin who added it |
| `createdAt` | string | When it was added |
| `updatedBy`, `updatedAt` | string or null | Who last changed it (an admin's email), and when, or null until it's changed |
| `readAt` | string or null | When it was last read successfully, or null until then (see [Reading the feeds](#reading-the-feeds)) |
| `error` | string or null | Why its last read failed, or null when it succeeded, or until it's read |

## Reading the feeds

The server reads every feed when it starts, then every 15 minutes, and reads a feed when it's added, or when its link
changes: adding it, or changing its link, waits for that read, so that a link that doesn't give a calendar is refused.
Nothing else waits for a read: the server keeps what it read in memory, and gives what it read last.

A read has limits on how long it takes and on the calendar's size, and fails beyond them. It also fails when the link's
server answers with an error, or with something that isn't valid iCalendar.

A read that fails keeps what was read before, if anything was, and the feed says why it failed (`error`), until a read
succeeds. What was read is only kept in memory: after the server restarts, a feed has neither `readAt` nor `error` until
it's read again.

What's given always matches the feed's current link and `privateTitles`: hiding its titles takes effect at once, while
showing them again takes effect with its next read.

## Events

What a read keeps of a feed is its events, read as RFC 5545 says, each of which is an occupation, which takes the
studio from its start, included, to its end, excluded, so that an event that ends when another starts doesn't overlap
it. Beyond RFC 5545:

- A whole-day event takes its whole days in Québec time, and is whole-day, so that it can be shown as such, while a
  timed event isn't, even one from 00:00 to 00:00. Times without a time zone, or with one that's neither an IANA time
  zone nor defined in the feed, are in Québec time.
- A feed has to define the time zones it names (`VTIMEZONE`), as RFC 5545 requires and Google's feeds do: otherwise, an
  occurrence can be missed, e.g. one that was cancelled is kept.
- An event or an occurrence that's cancelled (`STATUS:CANCELLED`) is left out. Whether an event says it's busy or free
  (`TRANSP`) doesn't matter: e.g. Google makes whole-day events free unless told otherwise, and they still take the
  studio.
- A read keeps the events and the occurrences that take some of the time from a year before it to two years after it.
- An event that can't be read, e.g. one without a `DTSTART`, is left out, without failing the read, while a calendar
  that isn't valid iCalendar fails it. A read with too many events fails, rather than leave some out without anyone
  knowing.

An occupation is known by its feed's name, and has a title, from its event's `SUMMARY`, on one line, cut to 200
characters, or `""` when it has none. The occupations of a feed whose titles are private have none, `null` in place of
their title, and are only known by their feed's name. No event's description or location is ever kept.

## The calendar

The calendar is what takes the studio over a range of days in Québec time, from 00:00 on its first day to 00:00 on the
day after its last, e.g. a month:

- the sessions with a start that take some of that time, whatever their status, so that cancelled ones can be shown,
- the occupations and the quiet time that take some of it,
- and, whatever the range, what needs settling: the [conflicts](#conflicts), and the
  [sessions without a date](#sessions-without-a-date).

Its occupations and quiet time are what the feeds' last reads gave (see [Reading the feeds](#reading-the-feeds)), so
they can be out of date: a feed whose last read failed still gives what it read before, and one that hasn't been read
yet, e.g. right after the server restarts, gives nothing. So the calendar also gives every feed, with when it was last
read and why that failed, and apps should tell the admin when a feed's last read failed, or when it hasn't been read
yet, since occupations or quiet time can then be missing. The calendar of days more than a year before a feed's last
read, or more than two years after it, has none of that feed's occupations or quiet time (see [Events](#events)).

An occupation, or a quiet time, is given with its feed's id (`feed`), its `start` and `end`, and whether it takes whole
days (`wholeDay`), and an occupation with its `title` too, `""` for none. They have no id of their own, since they're
read again every 15 minutes: they're told apart by all of these. Two that are the same in all of them, e.g. an event
that's twice in its feed, are shown alike anyway.

## Conflicts

The studio holds one thing at a time, so **a conflict is two things that overlap**, whatever they are: a session and an
occupation, a session and quiet time, an occupation and quiet time, two occupations, or two quiet times, of the same
feed or not, e.g. an event that's in two feeds. Two sessions can't overlap (see
[Rules, in Sessions](sessions.md#rules)). Cancelled sessions, and sessions without a start, don't count; done ones do.
Each thing takes the studio from its start, included, to its end, excluded, so one that ends when another starts
doesn't overlap it. A whole-day occupation or quiet time takes its whole days (see [Events](#events)), so it overlaps
whatever is on them, e.g. every session that day.

The conflicts are those of the next 365 days, from today in Québec: from 00:00 today to 00:00 on the day 365 days
later. A conflict is one of them when some of the time its two things overlap is: e.g. two things that started
yesterday and still overlap today are, but two that only overlapped yesterday aren't, even when one of them is still
going on. So a conflict that ended this morning is there until midnight. Since a read keeps two years of events after
it, these 365 days have every occupation and quiet time, unless a feed's last successful read is more than a year old.

There's one conflict for each pair of things that overlap, which has:

- `start` and `end`: the time its two things overlap, all of it, even outside the 365 days,
- `things`: the two things, in their order (see below), each with its `kind`: `"session"`, with the session's `id`,
  `title`, `start`, `end` and `status`, `"occupation"`, with its `feed`, `start`, `end`, `wholeDay` and `title`, or
  `"quiet-time"`, with its `feed`, `start`, `end` and `wholeDay`.

Things are in order of their start, then of their end, then of their kind: sessions, then occupations, then quiet time.
Then sessions are in order of their id, and occupations and quiet time in order of their feed's place among the feeds
(the order they were added), then of their title, then timed before whole-day. Conflicts are in order of their start,
then of their end, then of their first thing, then of their second. Two things in the same place are the same in all
they're given with, so the conflicts of the same things are always in the same order.

## Sessions without a date

The sessions without a start that aren't cancelled need a date: the calendar gives them, the most recently added first,
whatever its range.

## `GET /api/admin/calendar` (admin)

The calendar (see [The calendar](#the-calendar)) of the days from `from` to `to`, both included. Unlike the `from` and
`to` of the lists of sessions and of events, which are instants, they're days, and `to` is included: e.g. a month shown
from Sunday to Saturday, `from=2026-11-01&to=2026-12-05`, or today alone, `from` and `to` both today.

| Query parameter | |
|---|---|
| `from` | The first day, `YYYY-MM-DD`, in Québec |
| `to` | The last day, `YYYY-MM-DD`, in Québec, included |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `today` | string | The day the conflicts are counted from: today in Québec, `YYYY-MM-DD` |
| `feeds` | list of feeds | Every feed, as [`GET /api/admin/calendar/feeds`](#get-apiadmincalendarfeeds-admin) gives them, with when each was last read, and why that failed |
| `sessions` | list of sessions | The sessions with a start that take some of the days, whatever their status, as [`GET /api/admin/sessions`](sessions.md#get-apiadminsessions-admin) gives them, in order of their `start`, then of `createdAt`, then of `id` |
| `occupations` | list | The occupations that take some of the days, each with its `feed`, `start`, `end`, `wholeDay` and `title`, in the order of things (see [Conflicts](#conflicts)) |
| `quietTimes` | list | The quiet times that take some of the days, each with its `feed`, `start`, `end` and `wholeDay`, in the order of things |
| `conflicts` | list | The conflicts of the next 365 days, whatever the days asked for (see [Conflicts](#conflicts)) |
| `undatedSessions` | list of sessions | The sessions without a date, whatever the days asked for, as `GET /api/admin/sessions` gives them (see [Sessions without a date](#sessions-without-a-date)) |

It isn't a list of a collection, so it has no `total` (see [Totals, in Conventions](README.md#conventions)).

Fails with 400 when:

- `from` or `to` is missing, is given more than once, or isn't a day from 2000-01-01 to 2999-12-31
  (``"`from` must be a single day, YYYY-MM-DD, without a time, from 2000-01-01 to 2999-12-31"``, or likewise for `to`),
- `to` is before `from` (``"`to` can't be before `from`"``),
- there are more than 400 days from `from` to `to`, both included, i.e. `to` is 400 days or more after `from`
  (``"The calendar has at most 400 days, `from` and `to` included"``), which is enough for a year.

## `GET /api/admin/calendar/feeds` (admin)

Every feed, with its link, in the order they were added.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many feeds there are |
| `feeds` | list of feeds | |

## `POST /api/admin/calendar/feeds` (admin)

| Request field | Type | |
|---|---|---|
| `name` | string | Trimmed, then between 1 and 100 characters |
| `link` | string | Trimmed: an `https` or `webcal` link, without a user name or a password, of at most 2,000 characters |
| `privateTitles` | boolean | Whether its titles are private |

Reads the link (see [Reading the feeds](#reading-the-feeds)), and only if that gives a calendar, adds the feed, with
that read as its first, and responds `{"ok": true, "feed": <the feed>}`. Fails with:

- 409 when a feed already has that link, with an error that names it.
- 400 when a field doesn't follow its rules, or when the link's server refuses the link, or answers with something
  that isn't a calendar, or is too big.
- 502 when the link's server can't be reached, or fails, or refuses requests for now, or when the server shuts down
  meanwhile.

## `PATCH /api/admin/calendar/feeds/:id` (admin)

Changes the fields of a feed it's sent, and leaves the others as they are (see
[Changes, in Conventions](README.md#conventions)). It takes any of the fields `POST /api/admin/calendar/feeds` takes.

When it's sent another link than the feed's, where a `webcal` link is the same as its `https` one, it reads that link
first, as `POST /api/admin/calendar/feeds` does, and only changes the feed if that gives a calendar: that read is then
the feed's, in place of what was read from its former link. Otherwise it doesn't read the feed.

Responds `{"ok": true, "feed": <the feed as it is then>}`. Fails with 400 when there's no field, or a field doesn't
follow its rules, 404 when there's no such feed, or it's removed while its link is read, 409 when another feed has the
new link, with an error that names it, and with 400 and 502 like `POST /api/admin/calendar/feeds` when the new link
can't be read.

## `DELETE /api/admin/calendar/feeds/:id` (admin)

Removes a feed, and forgets what was read from it. Responds `{"ok": true}`, or fails with 404 when there's no such
feed.
