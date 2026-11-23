# Calendar

Parking Radio has one studio, which holds one thing at a time. Two kinds of things take it:

- **Sessions**, which are entered on the site (see [Sessions](sessions.md)).
- **Occupations**: anything else that takes the studio, e.g. repairs, private workshops, or guests staying at the
  studio. They're read from calendars (see [Feeds](#feeds)), e.g. a Google Calendar the team shares, or a private
  calendar of the guests' stays, and each one is known by the name of the calendar it's read from, e.g. "Séjours".

Occupations can't be changed on the site, or with the tools: only in their own calendars. The feeds they're read from
are added, changed and removed on the admin pages, not with the tools, since their links are secrets.

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

- A whole-day event takes its whole days in Québec time, and times without a time zone, or with one that's neither an
  IANA time zone nor defined in the feed, are in Québec time.
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
