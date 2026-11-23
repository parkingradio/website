# Calendar

Parking Radio has one studio, which holds one thing at a time. Two kinds of things take it:

- **Sessions**, which are entered on the site (see [Sessions](sessions.md)).
- **Occupations**: anything else that takes the studio, e.g. repairs, private workshops, or guests staying at the
  studio. They're read from calendars (see [Feeds](#feeds)), e.g. a Google Calendar the team shares, or a private
  calendar of the guests' stays, and each one is known by the name of the calendar it's read from, e.g. "Séjours". The
  server knows nothing of where a calendar's events come from, e.g. a rental site.

Occupations can't be changed on the site, or with the tools: only in their own calendars. The feeds they're read from
are added, changed and removed on the admin pages, not with the tools, since their links are secrets.

## Feeds

A feed is a calendar that the server reads, in iCalendar (RFC 5545), from its link: an `https` or a `webcal` link, e.g.
the "secret address in iCal format" of a Google Calendar. Each one has a name, e.g. "Calendrier de l'équipe", which its
occupations are known by, and there can be several with the same name.

A feed's titles can be private (`privateTitles`): the server then never keeps, gives or logs its events' titles,
descriptions or locations, so that they never reach the site or the apps connected to it (see [Events](#events)), e.g.
for a calendar of guests' stays, which can have their names. Its occupations are then only known by its name.

A feed's link is a secret, since anyone who has it can read the calendar: the admin pages show it, but it never appears
in the logs, in any error, or in what the [MCP server](mcp.md)'s tools give. So the errors of reading a feed are the
server's own, never what the link's server answered, which could quote the link. Two feeds can't have the same link,
where a `webcal` link is the same as the `https` link it stands for, and what comes after `#` isn't part of a link: the
server keeps a link as the `https` link it stands for, without what comes after `#`, and with its characters that links
can't have encoded, e.g. `é` as `%C3%A9`, and gives it as it keeps it.

A feed has these fields:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `link` | string | Its link, as the server keeps it |
| `privateTitles` | boolean | Whether its titles are private |
| `createdBy` | string | The email of the admin who added it |
| `createdAt` | string | When it was added |
| `updatedBy`, `updatedAt` | string or null | Who last changed it (an admin's email), and when, or null until it's changed |
| `readAt` | string or null | When it was last read successfully, or null until then (see [Reading the feeds](#reading-the-feeds)) |
| `error` | string or null | Why its last read failed, or null when it succeeded, or until it's read |

## Reading the feeds

The server reads every feed when it starts, then again 15 minutes after each round of reads, one feed after another, and
reads a feed when it's added, or when its link changes: adding it, or changing its link, waits for that read, so that a
link that doesn't give a calendar is refused. Nothing else waits for a read: the server keeps what it read in memory, and
gives what it read last.

A read follows at most 5 redirects, each to an `https` link, and fails when the link's server hasn't given the whole
calendar within 20 seconds, or when the calendar is over 10 MB. It also fails when the link's server answers with an
error, with a redirect without a link, or with something that isn't valid iCalendar, or isn't a calendar: e.g. an
`RRULE` that isn't valid fails the whole read, not only its event. The server then goes through the calendar for its
events (see [Events](#events)) apart from the rest of what it does, which never waits for it, and the read fails when
that takes more than 10 seconds, or too much memory, far more than a calendar of 10 MB takes: e.g. for a recurring event
whose rule never gives an occurrence, such as every February 30, which an iCalendar library can look for without end.
The server goes through one calendar at a time, whatever it's read for: a read whose calendar is downloaded while the
server goes through another one waits until that one is done, which takes up to 10 seconds, and only then has its own 10
seconds. So adding a feed, or changing its link, takes at most 30 seconds, plus up to 10 seconds for each calendar the
server goes through before its own: usually none, or one, since the reads every 15 minutes go one feed after another.

A read that fails keeps what was read before, if anything was, and the feed says why it failed (`error`), until a read
succeeds. What was read is only kept in memory: after the server restarts, a feed has neither `readAt` nor `error` until
it's read again.

What's read is always that of the feed as it is: a read that ends after the feed's link or `privateTitles` changed,
whether it succeeded or failed, is ignored, and a feed whose link changed only has what was read from its new link. A feed
whose titles become private loses the titles read before right away, while one whose titles stop being private isn't
read for them: they come with its next read.

## Events

What a read keeps of a feed is its events, each of which is an occupation, which takes the studio from its start,
included, to its end, excluded, so that an event that ends when another starts doesn't overlap it:

- A timed event takes the time from its `DTSTART` to its `DTEND`, or for its `DURATION`, whose days are counted in its
  local time, and its hours as they pass: e.g. `P1D` ends at the same time on the next day, even when the clocks change
  in between, but `PT24H` ends 24 hours later. Its times are in UTC when they say so (`Z`), and otherwise in their time
  zone (`TZID`): the IANA time zone of that name, e.g. `America/Toronto`, or else the feed's own definition of it
  (`VTIMEZONE`), e.g. for Outlook's "Eastern Standard Time". They're in Québec time when they have no time zone, or one
  that's neither. In an IANA time zone, or in Québec time, a local time that the clocks show twice, as they go back, is
  the first of the two instants, and one that they skip, as they go forward, is moved forward by as much as they skip,
  e.g. 2:30 becomes 3:30.
- A whole-day event (`VALUE=DATE`) takes its whole days in Québec time: from 00:00 on its first day to 00:00 on the day
  its `DTEND` names, or after its `DURATION`, or after one day without either.
- A recurring event (`RRULE`, `RDATE`, `EXDATE`) takes each of its occurrences, at the same local time in its time zone
  on both sides of a change of daylight saving time, e.g. 19:00 every Tuesday, in winter as in summer. An occurrence
  that was changed on its own, which is a `VEVENT` with the same `UID` and a `RECURRENCE-ID`, takes its own times
  instead. One whose recurring event isn't in the feed, e.g. a single occurrence of someone else's event that the
  calendar was invited to, is an event of its own. A feed has to define the time zones it names (`VTIMEZONE`), as RFC
  5545 requires and Google's feeds do: otherwise, an `EXDATE`, a `RECURRENCE-ID` or an `UNTIL` in UTC can miss the
  occurrence it names, e.g. an occurrence that was cancelled is kept.
- An event or an occurrence that's cancelled (`STATUS:CANCELLED`), or that takes no time, e.g. one with a `DTSTART` but
  neither a `DTEND` nor a `DURATION`, is left out. Whether an event says it's busy or free (`TRANSP`) doesn't matter:
  e.g. Google makes whole-day events free unless told otherwise, and they still take the studio.

A read keeps the events and the occurrences that take some of the time from a year before it to two years after it.
An event that can't be read, e.g. one without a `DTSTART`, is left out, without failing the read, and so are an
occurrence given by an `RDATE` that's a period, and a recurring event with more than 20,000 occurrences until then, e.g.
one every minute. But a read that would go through more than 50,000 events and occurrences in all fails, rather than
leave out some of them without anyone knowing.

An occupation is known by its feed's name, and has a title, from its event's `SUMMARY`, on one line, or `""` when it has
none: one that's longer than 200 characters is cut to at most 200, "…" included, after its last whole word that fits,
or within its first word when none does. The occupations of a feed whose titles are private have none, `null` in place
of their title, and are only known by their feed's name: the server never keeps, gives or logs their events' titles,
descriptions or locations.

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
| `link` | string | Trimmed: an `https` or `webcal` link, without a user name or a password, of at most 2,000 characters as the server keeps it (see [Feeds](#feeds)) |
| `privateTitles` | boolean | Whether its titles are private |

Reads the link (see [Reading the feeds](#reading-the-feeds)), and only if that gives a calendar, adds the feed, with
that read as its first, and responds `{"ok": true, "feed": <the feed>}`. Fails with:

- 409 when a feed already has that link, with an error that names it.
- 400 when a field doesn't follow its rules, or when the link's server refuses it (it answers with a 4xx status other
  than 408 and 429, e.g. 404), or answers with something that isn't valid iCalendar, isn't a calendar, is over 10 MB,
  has too many events and occurrences, or takes more than 10 seconds, or too much memory, to go through, or when it
  redirects more than 5 times, to a link that isn't `https`, or without a link.
- 502 when the link's server can't be reached, doesn't give the whole calendar within 20 seconds, fails, or refuses
  requests for now (a 5xx, 408 or 429 status), or when the server shuts down meanwhile.

## `PATCH /api/admin/calendar/feeds/:id` (admin)

Changes the fields of a feed it's sent, and leaves the others as they are (see
[Changes, in Conventions](README.md#conventions)). It takes any of the fields `POST /api/admin/calendar/feeds` takes.

When the link changes, i.e. it isn't the feed's own once the server keeps it as it does (see [Feeds](#feeds)), unlike
e.g. the feed's own link as a `webcal` link, it reads it first, as `POST /api/admin/calendar/feeds` does, and only changes the feed if that gives a
calendar: that read is then the feed's, in place of what was read from its former link. Otherwise, it doesn't read the
feed (see [Reading the feeds](#reading-the-feeds) for what changing `privateTitles` does).

Responds `{"ok": true, "feed": <the feed as it is then>}`. Fails with 400 when there's no field, or a field doesn't
follow its rules, 404 when there's no such feed, or it's removed while its link is read, 409 when another feed has the
new link, with an error that names it, and with 400 and 502 like `POST /api/admin/calendar/feeds` when the new link
can't be read.

## `DELETE /api/admin/calendar/feeds/:id` (admin)

Removes a feed, and forgets what was read from it. Responds `{"ok": true}`, or fails with 404 when there's no such
feed.
