# Calendar

Parking Radio has one studio, which holds one thing at a time. Two kinds of things take it:

- **Sessions**, which are entered on the site (see [Sessions](sessions.md)).
- **Occupations**: anything else that takes the studio, e.g. repairs, private workshops, or guests staying at the
  studio. They're read from calendars (see [Feeds](#feeds)), e.g. a Google Calendar the team shares, or a calendar of
  the guests' stays, and each one is known by the name of the calendar it's read from, e.g. "Séjours".

Some of the studio's time is also **protected** for sessions: time that the studio's other calendars keep for them. It's
read from calendars too, as **holds**, which don't take the studio (see [Protected time](#protected-time)).

Occupations and holds can't be changed on the site, or with the tools: only in their own calendars. The feeds they're
read from are added, changed and removed on the admin pages, not with the tools, since their links are secrets.

The server gives the studio's calendar: what takes it over a range of days, its [available time](#availability), and
what needs settling: its conflicts, the sessions outside protected time, and the sessions without a date (see
[The calendar](#the-calendar)). It doesn't give holds themselves.

## Feeds

A feed is a calendar that the server reads, in iCalendar (RFC 5545), from its link: an `https` or a `webcal` link, e.g.
the "secret address in iCal format" of a Google Calendar. Each one has a name, e.g. "Calendrier de l'équipe", and there
can be several with the same name. Each one also has a kind, which says what its events are: `"occupations"` or
`"holds"` (see [Events](#events)).

The titles of an `occupations` feed's events reach the admin pages, the apps connected to the site, and the calendar
apps that admins subscribe to the occupations in, through their calendar of occupations (see
[Admins' calendars](admin-calendars.md)), e.g. Google's or Apple's, whose servers then keep them: so a calendar whose
titles have personal data, e.g. guests' names, shouldn't be an `occupations` feed. The titles of a `holds` feed's
events are never given.

A feed's link is a secret, since anyone who has it can read the calendar: the admin pages show it, but it never appears
in the logs, in any error, or in what the [MCP server](mcp.md)'s tools give. Two feeds can't have the same link, where a
`webcal` link is the same as the `https` link it stands for.

A feed has these fields:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `kind` | `"occupations"` or `"holds"` | What its events are: occupations or holds (see [Events](#events)) |
| `link` | string | Its link, as an `https` link when it was given as a `webcal` one |
| `createdBy` | string | The email of the admin who added it |
| `createdAt` | string | When it was added |
| `updatedBy`, `updatedAt` | string or null | Who last changed it (an admin's email), and when, or null until it's changed |
| `readAt` | string or null | When it was last read successfully, or null until then (see [Reading the feeds](#reading-the-feeds)) |
| `error` | string or null | Why its last read failed, or null when it succeeded, or until it's read |

## Reading the feeds

The server reads every feed when it starts, then every 15 minutes, and when it's asked to
([`POST /api/admin/calendar/feeds/refresh`](#post-apiadmincalendarfeedsrefresh-admin)). It also reads a feed when it's
added, or when its link changes: adding it, or changing its link, waits for that read, so that a link that doesn't give
a calendar is refused. Apart from these and asking for every feed to be read (see its endpoint), nothing waits for a
read: the server keeps what it read in memory, and gives what it read last. Changing a feed's kind doesn't read it: what
was read from it counts as its new kind's from then on.

During a read of every feed, the feeds are read one at a time, and reads of every feed don't overlap: one asked for
while another is under way starts once that one ends, once for every request made meanwhile.

A read has limits on how long it takes and on the calendar's size, and fails beyond them. It also fails when the link's
server answers with an error, or with something that isn't valid iCalendar.

A read that fails keeps what was read before, if anything was, and the feed says why it failed (`error`), until a read
succeeds. What was read is only kept in memory: after the server restarts, a feed has neither `readAt` nor `error` until
it's read again.

What's given always matches the feed's current link: what was read from its former link is never given.

## Events

What a read keeps of a feed is its events, read as RFC 5545 says, each of which is from its start, included, to its
end, excluded, so that an event that ends when another starts doesn't overlap it. An `occupations` feed's events are
occupations, which take the studio then, and a `holds` feed's are holds, which protect that time for sessions (see
[Protected time](#protected-time)). Beyond RFC 5545:

- A whole-day event is its whole days in Québec time, and is given as whole-day, unlike a timed one, even from 00:00 to
  00:00. Times without a time zone, or with one that's neither an IANA time zone nor defined in the feed, are in Québec
  time.
- A feed has to define the time zones it names (`VTIMEZONE`), as RFC 5545 requires and Google's feeds do: otherwise, an
  occurrence can be missed, e.g. one that was cancelled is kept.
- An event or an occurrence that's cancelled (`STATUS:CANCELLED`) is left out. Whether an event says it's busy or free
  (`TRANSP`) doesn't matter: e.g. Google makes whole-day events free unless told otherwise, and they're still
  occupations, or holds.
- A read keeps the events and the occurrences that take some of the time from a year before it to two years after it.
- An event that can't be read, e.g. one without a `DTSTART`, is left out, without failing the read, while a calendar
  that isn't valid iCalendar fails it. A read with too many events fails, rather than leave some out without anyone
  knowing.

An occupation has a title, from its event's `SUMMARY`, on one line, cut to 200
characters, or `""` when it has none. A hold has no title. No event's description or location is ever kept.

## The calendar

The calendar is what takes the studio over a range of days in Québec time, from 00:00 on its first day to 00:00 on the
day after its last, e.g. a month:

- the sessions with a start that take some of that time, by start, whatever their status (cancelled ones included),
- the occupations that take some of it, by start, then end,
- the stretches of [available time](#availability) that take some of it, by start,
- every feed, with its kind, when it was last read (`readAt`) and why that failed (`error`),
- and, whatever the range, what needs settling: the [conflicts](#conflicts) and the
  [sessions outside protected time](#protected-time) of the year ahead, and the
  [sessions without a date](#sessions-without-a-date).

**The year ahead** is from 00:00 on `today`, the day in Québec when the calendar is asked for, to 00:00 on the day 365
days later.

Occupations and holds are what the feeds' last reads gave (see [Reading the feeds](#reading-the-feeds)): a feed whose
last read failed still gives what it read before, and one that hasn't been read yet, e.g. right after the server
restarts, gives nothing. What the calendar works out from such a feed, its occupations, conflicts, available time and
sessions outside protected time, can then be wrong or out of date, so apps should tell the admin. They can have every
feed read again first when they need the calendar to be up to date, e.g. right after the admin changed an event, but not
before every calendar they ask for, since that waits for every read. Reads also only keep events from a year before
them to two years after them (see [Events](#events)), so the calendar of days outside that can lack them.

An occupation has `feedId`, the id of its feed, one of the calendar's feeds, whose name is how the occupation is
known, its `start` and `end`, whether it takes whole days (`wholeDay`), and its `title` (see [Events](#events)).
Occupations have no id, and two of them can be the same in all of these, e.g. two stays with the same dates, booked
on the same platform.

## Conflicts

The studio holds one thing at a time, so **a conflict is two things that overlap**: a session and an occupation, or two
occupations, of the same feed or not. Two sessions can't overlap (see [Rules, in Sessions](sessions.md#rules)).
Cancelled sessions, and sessions without a start, don't count; done ones do. A thing that ends when another starts
doesn't overlap it, and a whole-day occupation overlaps whatever is on its days.

The conflicts are those of [the year ahead](#the-calendar): a conflict is one of them when its two things overlap during
some of it, so one that ended this morning is there until midnight, while two things that only overlapped yesterday
aren't one, even when one of them is still going on.

There's one conflict for each pair of things that overlap. Conflicts are by start, then end, and each has:

- `start` and `end`: the time its two things overlap, all of it, even outside the year ahead,
- `things`: the two things, by start, then end, each with its `kind`: `"session"`, with the session's `id`, `title`,
  `start`, `end` and `status`, or `"occupation"`, with the occupation's fields.

## Protected time

How a calendar works out its holds is up to it: the server only reads them. Holds never conflict with anything.

Time is **protected** when some hold takes it, of any `holds` feed: several feeds' holds count together, and holds that
follow each other count as one, e.g. one until 15:00 and one from 15:00. A session is within protected time when every
moment of it, from its start, included, to its end, excluded, is protected.

Sessions are meant to be within protected time (see [Rules, in Sessions](sessions.md#rules)): the calendar gives the
[available time](#availability), where they can go, and the sessions that aren't, which need settling.

**The sessions outside protected time** need settling, like conflicts. They're the sessions that take some of
[the year ahead](#the-calendar), and that:

- are planned (not done or cancelled),
- have a start,
- haven't ended when the calendar is asked for,
- and aren't within protected time from their start, or from when the calendar is asked for if that's later, to their
  end: a session that's going on is only judged on what's left of it.

While there's no `holds` feed, there are none. Each one has the session's `id`, `title`, `start` and `end`, and they're
by start.

## Availability

**Available time** is the protected time of [the year ahead](#the-calendar) that nothing takes: no session that isn't
cancelled, done ones included, and no occupation. The part of today that's over is in it too, so apps shouldn't suggest
it. It's in stretches, cut only at the ends of the year ahead, not e.g. at midnight: two stretches never overlap or
follow each other. While there's no `holds` feed, there's none.

Available time is where sessions can go: a session placed within a stretch is within protected time, and overlaps
nothing. It doesn't include the time a session takes itself: a session that's moved can go within its own time and the
available time around it. The calendar gives the stretches that take some of the days asked for, each with its `start`
and `end`, whole, e.g. one that goes on after the last day: to see where a session can go, apps ask for the calendar of
the days it would take.

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
| `today` | string | Today in Québec, `YYYY-MM-DD`, which [the year ahead](#the-calendar) starts on |
| `feeds` | list of feeds | Every feed, as [`GET /api/admin/calendar/feeds`](#get-apiadmincalendarfeeds-admin) gives them |
| `sessions` | list of sessions | The sessions with a start that take some of the days, whatever their status, as [`GET /api/admin/sessions`](sessions.md#get-apiadminsessions-admin) gives them, by start |
| `occupations` | list of occupations | The occupations that take some of the days, by start, then end |
| `availability` | list | The stretches of [available time](#availability) that take some of the days, by start, each with its `start` and `end` |
| `conflicts` | list of conflicts | The conflicts of [the year ahead](#the-calendar), whatever the days asked for |
| `unprotectedSessions` | list | The [sessions outside protected time](#protected-time), by start, whatever the days asked for, each with its `id`, `title`, `start` and `end` |
| `undatedSessions` | list of sessions | The sessions without a date, as `GET /api/admin/sessions` gives them, the most recently added first, whatever the days asked for |

Fails with 400 when `from` or `to` is missing, is given more than once, or isn't a day from 2000-01-01 to 2999-12-31,
when `to` is before `from`, or when there are more than 400 days from `from` to `to`, both included.

## `GET /api/admin/calendar/feeds` (admin)

Every feed, with its link, in the order they were added.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many feeds there are |
| `feeds` | list of feeds | |

## `POST /api/admin/calendar/feeds/refresh` (admin)

Takes no body. Reads every feed now, or once the read of every feed under way ends, if there's one (see
[Reading the feeds](#reading-the-feeds)), and once each read has ended, responds with every feed as
[`GET /api/admin/calendar/feeds`](#get-apiadmincalendarfeeds-admin) gives them then. A read that fails doesn't fail the
request: its feed says why (`error`). This can take a while.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many feeds there are |
| `feeds` | list of feeds | |

Fails with 502 when the server shuts down meanwhile.

## `POST /api/admin/calendar/feeds` (admin)

| Request field | Type | |
|---|---|---|
| `name` | string | Trimmed, then between 1 and 100 characters |
| `kind` | `"occupations"` or `"holds"` | What its events are (see [Feeds](#feeds)). There's no default, so that it's always chosen |
| `link` | string | Trimmed: an `https` or `webcal` link, without a user name or a password, of at most 2,000 characters |

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
the feed's, in place of what was read from its former link. Otherwise it doesn't read the feed (see
[Reading the feeds](#reading-the-feeds)).

Responds `{"ok": true, "feed": <the feed as it is then>}`. Fails with 400 when there's no field, or a field doesn't
follow its rules, 404 when there's no such feed, or it's removed while its link is read, 409 when another feed has the
new link, with an error that names it, and with 400 and 502 like `POST /api/admin/calendar/feeds` when the new link
can't be read.

## `DELETE /api/admin/calendar/feeds/:id` (admin)

Removes a feed, and forgets what was read from it. Responds `{"ok": true}`, or fails with 404 when there's no such
feed.
