# Sessions

What's played at the studio: **sessions**, the occasions at the studio, and the **sets** played during them, with who
played, what they did, and where the recordings are. A session is e.g. an evening of three artists, or a collective's
4-hour takeover. A set is one performance during a session, usually about an hour, streamed as its own YouTube live and
uploaded as its own SoundCloud track: a 4-hour takeover is one session of 4 sets. The recordings stay on SoundCloud and
YouTube, which the server only links to. Only admins see sessions and sets, until a session is announced, which makes it
public, as an event (see [Announced](#announced)). They have nothing to do with admins' sessions, which are about
logging in (see [Sessions, in Admins](admins.md#sessions)).

Each session is a row of the `sessions` table (`server/src/db/schema.ts`), and each set a row of `sets`, with its
performers in `set_performers`. The rules each of their fields follows are `SESSION_FIELDS` and `SET_FIELDS` in
`server/src/sessions/fields.ts`. The server checks the fields it's sent against them, then the rules that involve
several fields on the session or the set as it will be once it's added or changed, with the fields a change doesn't send
as they are, then the [rules](#rules) that involve other sessions and sets. Its errors are in English, since only admins
see them.

## Sessions

A session has:

| Field | Type | |
|---|---|---|
| `start` | string or null | When the session starts, or null for a session whose date isn't known yet: see [Times](#times) |
| `durationMinutes` | number | How long the session lasts: see [Times](#times) |
| `type` | string | What kind of session it is, which gives it its name: see [Types and names](#types-and-names) |
| `takeover` | object or null | The collective whose takeover the session is, which only takeovers have, and they always do: see [Types and names](#types-and-names) |
| `application` | object or null | The application the session comes from, a takeover's collective's: see [Applications](#applications) |
| `name` | string | The session's own name, which replaces the one its type gives it, as free text: see [Types and names](#types-and-names). Each run of spaces, tabs or line breaks becomes a single space, and it's trimmed, then up to 100 characters, or `""` when there's none |
| `raEvent` | object or null | The session's event on Resident Advisor: see [Links](#links) |
| `description` | string | The session's own description, which replaces the one its type gives it, as plain text: see [Descriptions](#descriptions). Its line breaks become `\n`, and it's trimmed, then up to 5000 characters, or `""` when there's none |

A session, as the endpoints below return it, also has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `title` | string | What the session is called: its `name`, or else the name its type gives it, e.g. `"HAUTE RIVE TAKEOVER"`, like the event of a track's title (see [The playlist](radio.md#the-playlist)). Never empty: see [Types and names](#types-and-names) |
| `end` | string or null | When the session ends: its `start` plus its `durationMinutes`, or null when it has no `start` |
| `effectiveDescription` | string | The session's description: its `description`, or else the one its type gives it, or `""` when neither has one: see [Descriptions](#descriptions) |
| `hasFlyer` | boolean | Whether the session has a flyer: see [Flyers](#flyers) |
| `sets` | list of sets | Its sets, in their order, cancelled ones included: see [Sets' order](#sets-order) |
| `createdAt` | string | When the session was added |
| `createdBy` | string | The email of the admin who added it |
| `updatedBy`, `updatedAt` | string or null | Who last changed the session (an admin's email), and when, its flyer included. Changes to its status or to whether it's announced don't count, nor do changes to its sets (e.g. a set moved into it or out of it), renaming the takeover's collective, or its application being deleted |
| `status` | `"planned"`, `"done"` or `"cancelled"` | See [Status](#status) |
| `statusUpdatedBy`, `statusUpdatedAt` | string or null | Who last changed the status (an admin's email), and when (see [Status](#status)) |
| `announced` | boolean | Whether the session is announced: see [Announced](#announced) |
| `announcedUpdatedBy`, `announcedUpdatedAt` | string or null | Who last announced or un-announced it (an admin's email), and when |

## Sets

Every set belongs to a session: the one it's added to, or added with, or the one it was last moved to (see
[Sets' order](#sets-order)). Sets aren't listed on their own: they're in their sessions, and the `total` of a list of
sessions counts sessions, not sets. A session can be added with its sets, all of them or nothing, in a single request,
whose errors about one of the sets say which it is, by its place in the list of sets sent, from 0, `setIndex` (see
[`POST /api/admin/sessions`](#post-apiadminsessions-admin)). A set has:

| Field | Type | |
|---|---|---|
| `performers` | list | The artists who played, in order: see [Performers](#performers) |
| `durationMinutes` | number or null | How long the set lasts, or null when that isn't known yet: see [Times](#times) and [Sets' order](#sets-order) |
| `performanceTypes` | list of strings | What the performers do: ids from `PERFORMANCE_TYPES` in `server/src/applications/fields.ts`, like an application's (see [Applications](applications.md)), e.g. `"dj"` or `"live-performance"`. Requests can list them in any order, even more than once, and other values fail with 400. Responses list them in the order of `PERFORMANCE_TYPES`. Can be empty |
| `otherPerformanceType` | string | Anything else the performers do, in a few words, e.g. `"Synthé modulaire"`. Each run of spaces, tabs or line breaks becomes a single space, and it's trimmed, then up to 60 characters, or `""` when there's none |
| `genres` | list of strings | The set's genres: ids of `GENRES` in `server/src/artists/profile.ts`, like an artist's (see [Profiles](artists.md#profiles)), most important first, or none. They describe the set, which can differ from its performers' genres, e.g. an ambient set by a techno artist. A genre that's there twice is dropped, keeping the first, and other values fail with 400 |
| `soundcloudTrack` | object or null | The set's track on SoundCloud: see [Links](#links) |
| `youtubeVideo` | object or null | The set's video on YouTube: see [Links](#links) |
| `application` | object or null | The application the set comes from, one of its performers': see [Applications](#applications) |

A set, as the endpoints below return it, also has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `createdAt` | string | When the set was added |
| `createdBy` | string | The email of the admin who added it |
| `updatedBy`, `updatedAt` | string or null | Who last changed the set (an admin's email), and when. Moving it to another session counts. Status changes don't, nor do changes to its session (e.g. its start changing, or moving the set or another one among the session's sets), a performer being deleted, or its application being deleted |
| `status` | `"planned"`, `"done"` or `"cancelled"` | See [Status](#status) |
| `statusUpdatedBy`, `statusUpdatedAt` | string or null | Who last changed the status (an admin's email), and when (see [Status](#status)) |

A set can be in the radio's rotation (see [The rotation of sets, in Radio](radio.md#the-rotation-of-sets)). Deleting it,
or its session, takes it out. Cancelling it, removing its track or its video, or un-announcing its session gets it
skipped while that lasts, and giving it another track, or another link to it, gets it skipped until it's read through
that link.

## Times

A session has a start, which can be null, and a duration, which can't. A session without a start is one whose date
isn't known yet, e.g. a collective's artists grouped into a takeover while it's being planned. Requests send `start` in
Québec time, with or without seconds, with the offset from UTC in effect then, e.g. `"2026-11-14T21:00-05:00"`, or
`"2026-07-01T21:00-04:00"` in summer, or as null, or a blank string, for none. Any other offset is refused, e.g.
`"2026-11-14T21:00-04:00"`, and so is a time the clocks skip, e.g. 2:30 on March 14, 2027. A time they show twice, e.g.
1:30 on November 1, 2026, takes the offset of the one it is: -04:00 for the first, -05:00 for the second. Responses give
it, and the `end` the server works out, in Québec time, to the second, with the offset in effect then, e.g.
`"2026-11-14T21:00:00-05:00"` (see [Times, in Conventions](README.md#conventions)). A start can be in the past or in the
future.

A set has a duration, which can be null while it isn't known yet, but no start: its place in its session is its place
among the session's sets (see [Sets' order](#sets-order)).

Durations are whole numbers of minutes, of time that actually passes, whatever the clocks say: a session from 21:00 to
2:00 on the night the clocks go back an hour lasts 360 minutes, not 300. A session can last several days, e.g. a weekend,
which is one session. It takes place within the years 2000 to 2999, in UTC: it starts in them, and ends at the latest at
the start of 3000, which is checked on the session as it would then be, e.g. when a session without a start is given
one. Requests that would make it end later fail with 400 (`"A session ends by the start of the year 3000, in UTC"`). A
duration, a session's or a set's, is at least 1 minute, and at most the time from the start of 2000 to the start of
3000.

To find the sessions of a period, e.g. next week, list them with `from` and `to`, instants like `start`, each with the
offset in effect at that time: that gives the sessions that start at or after `from` and before `to`, and leaves out
those without a start. `from` alone gives those from then on. E.g. for the week of Monday, October 26, 2026, when the
clocks go back: `from` `"2026-10-26T00:00-04:00"`, `to` `"2026-11-02T00:00-05:00"`. A session that starts before `from`
isn't among them, even when it's still going on then.

## Rules

- **Sessions don't overlap**, unless one of them is cancelled or has no start: there's one studio. A session takes from
  its start, included, to its end, excluded, so a session can start when the one before it ends.
- **A SoundCloud track, or a YouTube video, belongs to at most one set**, cancelled ones included.
- **A cancelled session only has cancelled sets** (see [Status](#status)).
- **A done session has no planned set** (see [Status](#status)).
- **A takeover has a collective** (see [Types and names](#types-and-names)), so a collective with takeovers can't be
  deleted.

Requests that would break a rule fail with 409, even when they're sent at the same time: when two requests would break a
rule together, one of them fails, except for the rule that a done session has no planned set, which the server keeps by
changing statuses instead (see [Status](#status)). Requests fail with 409 for:

- adding or changing a session so that it overlaps another one, or un-cancelling it when it would then overlap one,
- adding a set to a cancelled session, moving a set that isn't cancelled into one, or un-cancelling one of its sets,
- giving a set a track or a video that's another set's, including another set added in the same request,
- un-cancelling a set or a session, i.e. marking it planned or done, whose application is rejected (see
  [Applications](#applications)),
- deleting a collective that has takeovers.

These 409s also have `session` and `set`, what's in the way, as the endpoints return them, so that it can be named and
linked to without another request. `set` is the set in the way, if it's a set, or else null, and `session` is the session
in the way, or that set's session. In particular:

- A set that's added to, moved into, or un-cancelled in a cancelled session has that session in the way.
- Deleting a collective that has takeovers has one of them in the way.
- When several things are in the way, it's one of them.
- Both are null for the 409s that aren't about a session or a set, e.g. those about a rejected application, and when the
  set in the way is another one of the same request, which `otherSetIndex` gives instead, by its place in the list of
  sets sent, from 0 (see [`POST /api/admin/sessions`](#post-apiadminsessions-admin)).

Occupations take the studio too (see [Calendar](calendar.md)), but the server doesn't refuse a session that overlaps
one, since they're read from calendars it doesn't control: that's a conflict. Nor does it refuse a session outside the
time that's protected for sessions (see [Protected time, in Calendar](calendar.md#protected-time)). Apps that add a
session with a start, give a session a start, change its start or its duration, or un-cancel it, should look at the
calendar over its time first, and its available time (see [Availability, in Calendar](calendar.md#availability)), and
tell the admin when it would overlap something, or be outside protected time, while there's a `holds` feed.

## Sets' order

Each set is streamed as its own YouTube live, so a session's sets take place one at a time, one after the other, in the
order admins give them, which is the order of the session's `sets`. There's no break between them: each set starts when
the one before it ends. The server doesn't say when each set starts or ends, since sets don't keep to their times
exactly: only their order and their durations are known. Every set has its place in the order, whatever its status: a
cancelled set keeps its place, and its duration still counts.

A new set goes after the session's other sets, and the sets added with their session are in the order they're sent.
Giving a set another place, e.g. one that was added last, takes moving it afterwards, with
[`PUT /api/admin/sets/:id/position`](#put-apiadminsetsidposition-admin), to its place among the session's sets, from 0
for the first, cancelled ones included: the other sets keep their order. Deleting a set leaves the others in their
order.

A set can also be moved to another session, with [`PUT /api/admin/sets/:id/session`](#put-apiadminsetsidsession-admin).
It then goes after that session's sets, and the sets of the session it leaves keep their order, as when it's deleted.

A session's sets are meant to last no longer than the session: their durations are meant to add up to no more than its
duration, those of cancelled sets included, since they keep their place, while a duration that isn't known counts for
nothing. The server doesn't require it, since a session's duration and its sets' are changed one at a time. Apps that add
sets, or change a session's duration or its sets' durations, should tell the admin when its sets add up to more than
the session. E.g. a cancelled set and the set that replaces it both count: removing the cancelled set's duration, or
deleting it, stops it counting.

## Status

A new session or set is `"planned"`, then `"done"` once it's been played, or `"cancelled"`, e.g. a set whose artist
didn't show up. Any status can be changed to any other, except as below, and except that a cancelled set or session
whose application is rejected stays cancelled (see [Applications](#applications)). Statuses only change when an admin:

- changes a session's or a set's status,
- adds a set,
- moves a set to another session,
- deletes a set,

never as time passes, e.g. once a session's end has passed. Each of these can change other statuses, as below, as the
same admin, at the same time, and the endpoints that do so respond with the session as it then is, with its sets, or,
for moving a set, with both sessions. Moving a set never changes its own status, only those of the sessions it leaves
and joins.

- **Cancelling a session cancels its sets**: every one that isn't already cancelled, done ones included. A cancelled
  session only has cancelled sets (see [Rules](#rules)), so while it's cancelled:
  - its sets can still be changed, and moved to another session, where they stay cancelled,
  - none of its sets can be un-cancelled,
  - no set can be added to it, and only cancelled sets can be moved into it.

  Un-cancelling a session leaves its sets cancelled: each one is un-cancelled on its own, once the session isn't
  cancelled anymore.
- **A done session has no planned set** (see [Rules](#rules)): marking a session done marks its planned sets done, while
  its cancelled sets stay cancelled. A done session is planned again once it gets a planned set:
  - one of its sets' status is set to planned,
  - a set is added to it, as a new set is planned,
  - a planned set is moved into it.

  Marking a session planned leaves its sets as they are.
- **A planned session becomes done once its sets are played**: whenever one of these happens, a session that's then
  planned, with at least one set that's done and none that's planned, becomes done:
  - one of its sets' status is set, even to the one it already has,
  - one of its sets is deleted, or moved to another session,
  - a set is moved into it.

  E.g. two sets done and one cancelled make it done, whichever comes last, but not three cancelled, and so does a done
  set moved into a planned session without sets. A session that's marked planned while none of its sets is planned
  isn't made done until one of these happens.

These hold even for requests sent at the same time, e.g. two sets marked done together.

Otherwise, a session's status and its sets' are independent, e.g. a session that's done can have a cancelled set, and
one that's planned can have sets that are done.

## Announced

A session is prepared behind the scenes, then announced, which makes it public, as an event, with its sets, and makes
public the profiles and photos of its sets' performers, and of the collective whose takeover it is, with its members
(see [Events](events.md)). Un-announcing it makes them private again, unless something else makes them public, though
the sizes of photos and flyers that were already fetched can still be shown (see [Photos](artists.md#photos)). A new
session isn't announced. Whether it's announced doesn't depend on its status, e.g. a cancelled session can stay
announced. Only a session with a start can be announced, and an announced session's start can't be removed until it's
un-announced, which it always can be: requests that would leave an announced session without a start fail with 400
(`"An announced session has a start"`), even when they're sent at the same time.

## Performers

A set's performers are the artists who played it, in order, at least one when it's added or changed. Each artist is only
once in a set. Several artists can play a set together. A set is always played by artists: when a collective plays, some
of its artists do, during its takeover (see [Types and names](#types-and-names)).

Requests send the performers as a list of objects, in order, each one `{"id": <id>}`, an artist's id. Other fields are
ignored, so that the performers a set returns can be sent back as they are. A performer that's there twice, whatever the
case of its id, is dropped, keeping the first. A performer that isn't an object with an `id` that's a string, or whose
`id` isn't that of an artist who exists, fails with 400 (`"No such artist"`).

Responses list them as objects with the `id` and `name` of each one, in order.

Deleting an artist takes them out of their sets, which stay as they are, even without performers. Changing such a
set's performers then takes at least one again, but its other fields and its status can still be changed on their own.

## Types and names

A session has one type, which says what kind of session it is, and gives it its name:

| `type` | The name it gives |
|---|---|
| `"guest-mixes"` | `GUEST MIXES` |
| `"live-performance"` | `LIVE PERFORMANCE` |
| `"takeover"` | `<COLLECTIVE> TAKEOVER`: the name of the collective whose takeover it is, in upper case (Unicode's default case mapping), then a space and `TAKEOVER`, e.g. `SAUT DE CLÔTURE TAKEOVER` for Saut de Clôture |
| `"synth-meetup"` | `SYNTH MEETUPS` |
| `"other"` | None, e.g. for a workshop: it needs a `name` |

A takeover is a collective's session. The performers of its sets are usually the collective's artists, but they don't
have to be, e.g. for a guest. Only takeovers have a collective (`takeover`), and every takeover has one, so a collective
can't be deleted while it has takeovers (see
[`DELETE /api/admin/collectives/:id`](collectives.md#delete-apiadmincollectivesid-admin)).

A session's `name` is its own name, which replaces the one its type gives it, e.g. for a special evening,
`"SPECIAL HALLOWEEN — MINIMALTIDE TAKEOVER"`. Any type can have one, and `"other"` needs one. It's kept as it's sent,
its case included, e.g. `"ATELIER DE DJing POUR FEMMES & OPEN DECKS"`, but for its spaces (see [Sessions](#sessions)).

What a session is called is its `title`: its `name`, or else the one its type gives it, so it's never empty. It's worked
out when the session is read, from its collective's name as it is then, so renaming a collective renames its takeovers,
unless they have a name of their own. Apps that change a session send back its `name`, not its `title`: otherwise the
name its type gives it would become its own, and stop following its collective's name and its type.

Requests send `type` as one of the types above, and fail with 400 otherwise (`"The type must be one of guest-mixes,
live-performance, takeover, synth-meetup, other"`). They send `takeover` as the collective's id, or null, or a blank
string, when there's none. A `takeover` that isn't a string or null fails with 400 (`"The takeover must be a
collective's id, or null"`), and so does a takeover without a collective (`"A takeover has a collective"`), a session of
another type with one (`"Only a takeover has a collective"`), a session of type `"other"` without a `name` (`"A session
of type other has a name"`), and a string that isn't the id of a collective that exists (`"No such collective"`). These
are checked on the session as it would then be: turning a takeover into another type takes sending `takeover` as null
in the same request, and turning a session into a takeover, or into an `"other"`, takes sending its collective, or its
`name`, unless it already has one.
Responses give `takeover` as an object with the collective's `id` and `name`, or null.

## Applications

A set or a session can have the application it comes from (see [Applications](applications.md)), e.g. to go from one to
the other: its `application`, which neither has to have. A set's is an artist's application, whose artist is one of the
set's performers, and a session's is a collective's application, whose collective is the one whose takeover the session
is. An application can be several sets' or sessions', e.g. a cancelled set's and the set that replaces it, and it lists
them (see [Applications](applications.md)). Their statuses make the application's (see
[Status, in Applications](applications.md#status)), while an application never changes theirs.

Requests send `application` as the application's id, or null, or a blank string, when there's none. One that isn't a
string or null fails with 400 (`"The application must be an application's id, or null"`), and so does a string that
isn't the id of an application that exists (`"No such application"`), and an application that doesn't go with the set
(`"A set's application is one of its performers'"`) or the session (`"Only a takeover has an application"`, or `"A
session's application is that of the collective whose takeover it is"`). These are checked on the set or the session as
it would then be, after its other fields, the rules between them, and whether its takeover's collective or its
performers exist. So, in the same request, taking the application's artist out of a set's performers takes sending
`application` as null, or as an application of one of its other performers, changing a session that has an application
to another type takes sending `application` as null, and changing its takeover's collective takes sending it as null,
or as an application of the new collective. A change that only sends `application` is checked against the performers,
or the type and the collective, that the set or the session already has.

**A rejected application has no set or session that's planned or done** (see
[Status, in Applications](applications.md#status)). So adding or changing a set or a session so that it has a rejected
application while it's planned or done fails with 400 (`"A rejected application has no set or session that's planned or
done"`), like an application that doesn't go with it, which is checked first. A new set or session is planned, and a
change keeps the status it has, so a cancelled set or session can keep its rejected application, or be given one, and be
changed with it. It can't be un-cancelled, though: marking it planned or done fails with 409, with that same message,
and `session` and `set` null (see [Rules](#rules)), until its application is accepted or made new again. Rejecting an
application fails with 409 while it has a set or a session that's planned or done.

These rules hold even for requests sent at the same time.

Deleting an application takes it from its sets and sessions, which stay, without one, and so does deleting an artist,
which deletes their applications. A collective with an application that's a session's can't be deleted anyway, since
the session is its takeover (see [Types and names](#types-and-names)). Deleting a set or a session leaves its
application as it is.

Responses give `application` as an object with the application's `id` and `receivedAt` (see
[Applications](applications.md)), or null.

## Descriptions

A session's `description` is its own text, e.g. for a special evening, which replaces the one its type gives it. It's
plain text, without markup, on several lines: each `\r\n` or `\r` becomes `\n`, and it's trimmed, but its spaces and
line breaks are kept as they are. Types give these, which are what Parking Radio puts on its events on Resident Advisor:

| `type` | The description it gives |
|---|---|
| `"guest-mixes"`, `"live-performance"`, `"takeover"` | `LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC` |
| `"synth-meetup"` | A text in French that presents the Synth Meetups and the studio's ceiling of LEDs |
| `"other"` | None |

These are `DEFAULT_DESCRIPTIONS`, in `server/src/sessions/descriptions.ts`. A session's `effectiveDescription` is its
`description`, or else the one its type gives it, so it's `""` for a session of type `"other"` without one. Apps that
change a session send back its `description`, not its `effectiveDescription`: otherwise the one its type gives it would
become its own, and stop following its type.

## Flyers

A session can have a flyer, an image, which follows the same rules as an artist's photo (see
[Photos](artists.md#photos)): it's a JPEG, PNG or WebP image of up to 10 MB, whose type is checked from its contents,
that can be read, and kept in the app's private files, with the same sizes. It's deleted, with its sizes, once no
session has it anymore: removing or replacing a session's flyer, or deleting the session, never removes it from another
session that has the same, e.g. the same flyer for every session of a month. It's sent along with the session's fields
when it's added (see [`POST /api/admin/sessions`](#post-apiadminsessions-admin)), or on its own, with
[`PUT /api/admin/sessions/:id/flyer`](#put-apiadminsessionsidflyer-admin), which gives the session a flyer or replaces
its own, and it's removed with [`DELETE /api/admin/sessions/:id/flyer`](#delete-apiadminsessionsidflyer-admin): changing
the session's fields never changes it. The MCP server's tools can't send one, so a session added with a tool has none,
but they can remove one. The sizes of an announced session's flyer are public, as its event's (see [Events](events.md)),
and can be kept for good, like those of photos (see [Photos](artists.md#photos)), even once it's un-announced, or its
flyer replaced or removed.

## Links

Requests send each of these as a string, or null, or a blank string, when there's none. Links can be `http://` or
`https://` ones, with or without `www.` or `m.`, and a trailing `/` and parameters, e.g. `?si=...`, are allowed:

- A session's `raEvent`: the event's id on RA, which is only digits, up to 20, as
  [`GET /api/ra-events`](ra-events.md#get-apira-events) gives it, e.g. `"6683745"`, or a link to its page,
  `https://ra.co/events/<id>`, or the same on a subdomain of `ra.co`, e.g. `https://fr.ra.co/events/<id>`. It isn't
  checked against RA, so any event can be given, e.g. another promoter's. Several sessions can have the same one.
- A set's `soundcloudTrack`: a link to the track on soundcloud.com, e.g.
  `https://soundcloud.com/parkingdotradio/3tons`, or a private track's private link, which ends with its secret, e.g.
  `https://soundcloud.com/parkingdotradio/3tons/s-AbC123`. Other links, e.g. the `on.soundcloud.com` ones that
  SoundCloud's app shares, fail with 400. The link is reduced to `https://soundcloud.com/<account>/<track>`, with
  `/s-<secret>` for a private link. When the set is saved, the server resolves it to the track through the SoundCloud
  app (see [The SoundCloud app](radio.md#the-soundcloud-app)), and refuses links where SoundCloud shows no track. The
  track can be any track SoundCloud shows. A link that reduces to the set's track's `url` isn't resolved again, and a
  change that doesn't send `soundcloudTrack` keeps the set's track without resolving it, so that a set can be changed
  while SoundCloud can't be reached.
- A set's `youtubeVideo`: a link to the video on YouTube, as `youtube.com/watch?v=<id>`, `youtu.be/<id>`,
  `youtube.com/live/<id>`, `youtube.com/shorts/<id>` or `youtube.com/embed/<id>`, or the video's id itself, which is 11
  letters, digits, `-` or `_`. The link is reduced to the video's id. It isn't checked against YouTube.

Responses give each one as an object, or null when there's none, with an `id` and a `url`:

| Field | `id` | `url` |
|---|---|---|
| `raEvent` | The event's id on RA | `https://ra.co/events/<id>` |
| `soundcloudTrack` | SoundCloud's id for the track, which doesn't change when the track is renamed | The link it was resolved from, reduced as above: a private link mustn't be shown to the public, which events don't (see [Events](events.md#whats-public)) |
| `youtubeVideo` | The video's id | `https://www.youtube.com/watch?v=<id>` |

## Events on RA

Parking Radio lists its sessions as events on Resident Advisor, under its promoter page (see
[RA events](ra-events.md)). A session's event there is its `raEvent` (see [Links](#links)), which an admin creates on RA,
either with the bookmarklet, from what the server gives for the session, which then sets it as its `raEvent` (see
[Publishing on RA](ra-publication.md)), or by hand, then sets it as its `raEvent`. The server never creates, changes or
removes events on RA itself: a session's `raEvent` is only a link, so un-announcing, cancelling or deleting the session
leaves its event as it is, to be changed or removed on RA.

## `GET /api/admin/sessions` (admin)

Every query parameter can be left out, and the list only has the sessions that match all of those given:

| Query parameter | |
|---|---|
| `artist` | An artist's id: only the sessions with at least one set, whatever its status, that has that artist among its performers, with all of their sets. An unknown artist has none. Not with `takeover` |
| `takeover` | A collective's id: only that collective's takeovers. An unknown collective has none |
| `from` | An instant (see [Times, in Conventions](README.md#conventions)): only the sessions that start at that instant or after it, which leaves out those without a start |
| `to` | An instant: only the sessions that start before it, which leaves out those without a start |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many sessions `sessions` has (see [Conventions](README.md#conventions)) |
| `sessions` | list of sessions | Whatever their status. The sessions without a start come first, the most recently added first, then the others, the most recent first (by `start`, then `createdAt`) |

Fails with 400 if a query parameter is given more than once, if both `artist` and `takeover` are given, if `from` or
`to` is empty or isn't an instant with Québec's offset then (see [Times](#times)), from the year 2000 to 2999, in UTC,
or if `from` isn't before `to`.

## `GET /api/admin/sessions/:id` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | |

Fails with 404 when there's no such session.

## `GET /api/admin/sessions/:id/flyer` (admin)

Responds like [`GET /api/admin/artists/:id/photo`](artists.md#get-apiadminartistsidphoto-admin), which takes the same
`width`, with the session's flyer, one of its sizes, or a 304, and fails like it, with 404 when there's no such session,
when it has no flyer, or when its flyer is missing.

## `PUT /api/admin/sessions/:id/flyer` (admin)

Gives a session a flyer, or replaces its flyer, and changes nothing else. It's `multipart/form-data`, with one part,
`flyer`, the flyer (see [Flyers](#flyers)). A few other fields or files are ignored, but a second flyer isn't: the
request fails. The flyer it replaces is deleted unless another session has it (see [Flyers](#flyers)). It sets the
session's `updatedBy` and `updatedAt`, since its flyer is part of it.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | As it is then, with its sets |

Fails with 400 when the request is malformed, has no flyer, or the flyer isn't a JPEG, PNG or WebP image that can be
read (see [Flyers](#flyers)), 404 when there's no such session, and 413 when the flyer is larger than 10 MB.

## `DELETE /api/admin/sessions/:id/flyer` (admin)

Removes a session's flyer, which is deleted unless another session has it, and changes nothing else. It sets the
session's `updatedBy` and `updatedAt` (see [Changes, in Conventions](README.md#conventions)). Responds like
[`PUT /api/admin/sessions/:id/flyer`](#put-apiadminsessionsidflyer-admin), with the session as it is then. Fails with
404 when there's no such session.

## `POST /api/admin/sessions` (admin)

Adds a session, as `"planned"`, with the sets it's sent, if any. It's `multipart/form-data`, like
[`POST /api/admin/artists`](artists.md#post-apiadminartists-admin), with two parts: `session`, the session's fields as
JSON, in a field rather than a file, which are its `start`, `durationMinutes`, `type`, `takeover`, `application`, `name`,
`raEvent` and `description`, as above, none of them left out, along with `sets`, which can be left out, and `flyer`, its
flyer, which can be left out. A few other fields or files are ignored, but a second flyer isn't: the request fails.

`sets` is a list of sets, each as [`POST /api/admin/sessions/:id/sets`](#post-apiadminsessionsidsets-admin) takes it,
refusing the fields it doesn't take, which are added in order, as that endpoint would add each one right after the
session and the sets before it. Their
tracks are resolved once every field is valid, before anything is checked against what's saved, e.g. that the session
doesn't overlap another: an error about resolving a track comes first.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | As it was added, with its sets |

Fails with:

| Status | When |
|---|---|
| 400 | The request is malformed, a field isn't valid, the session would end after the start of the year 3000 (see [Times](#times)), the session's `takeover` doesn't go with its `type`, a session of type `"other"` has no `name`, the takeover's collective doesn't exist, the application doesn't exist, doesn't go with the session, or is rejected (see [Applications](#applications)), `raEvent` isn't one of the links above, the flyer isn't a JPEG, PNG or WebP image that can be read (see [Flyers](#flyers)), or one of the sets would fail with 400 |
| 409 | The session would overlap another one, which is in `session` (see [Rules](#rules)), or one of the sets would fail with 409, with what's in the way, or, when that's another set of the list, its place in `sets`, `otherSetIndex` |
| 413 | The flyer is larger than 10 MB |
| 502 | One of the sets' tracks has to be resolved, and SoundCloud can't be reached, or answers unexpectedly |

Only an error about one of the sets has `setIndex`: that set's place in `sets`, from 0. When it fails, nothing is saved.

## `PATCH /api/admin/sessions/:id` (admin)

Changes the fields of a session it's sent, and leaves the others as they are, its flyer included (see
[Changes, in Conventions](README.md#conventions), and [Flyers](#flyers)). It doesn't change its status, whether it's
announced, or its sets, which stay as they are, even when they add up to more than the session (see
[Sets' order](#sets-order)). It takes JSON, with any of the fields that `POST /api/admin/sessions` takes but `sets`. Its
`start` and `durationMinutes` are checked together, and so are its `type`, `takeover`, `application` and `name`, and
it's checked against the other sessions, as the session would then be. Responds like `POST /api/admin/sessions`, with
the session as it is then, and fails like it, but without the errors about its sets or its flyer, with 400 when there's
no field, or when it would remove an announced session's start (see [Announced](#announced)), and with 404 when there's
no such session.

## `PUT /api/admin/sessions/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"planned"`, `"done"` or `"cancelled"` | |

Changes a session's status, and its sets' when it's cancelled or marked done (see [Status](#status)), and responds like
`POST /api/admin/sessions`, with its sets as they are then. Fails with 400 if `status` isn't one of these values, 404 when
there's no such session, or 409 when the session would then overlap another one, with that session in `session`, or
when it wouldn't be cancelled anymore while its application is rejected, with `session` and `set` null (see
[Applications](#applications)).

## `PUT /api/admin/sessions/:id/announced` (admin)

| Request field | Type | |
|---|---|---|
| `announced` | boolean | |

Announces a session, or un-announces it (see [Announced](#announced)), and responds like `POST /api/admin/sessions`.
Fails with 400 if `announced` isn't a boolean, or when it's announced without a start, and 404 when there's no such
session.

## `DELETE /api/admin/sessions/:id` (admin)

Deletes a session, its flyer if no other session has it, and its sets, which leave the radio's rotation (see
[The rotation of sets, in Radio](radio.md#the-rotation-of-sets)), and responds `{"ok": true}`. Their performers
stay, and so do their applications. Fails with 404 when there's no such session.

## `POST /api/admin/sessions/:id/sets` (admin)

Adds a set to a session, as `"planned"`, after its other sets (see [Sets' order](#sets-order)), which makes the session
planned again if it's done (see [Status](#status)). The request has the set's `performers`, `durationMinutes`,
`performanceTypes`, `otherPerformanceType`, `genres`, `soundcloudTrack`, `youtubeVideo` and `application`, as above,
none of them left out.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | The set's session, with the set as it was added |

Fails with:

| Status | When |
|---|---|
| 400 | A field isn't valid, a performer doesn't exist, the application doesn't exist, isn't one of the performers', or is rejected (see [Applications](#applications)), a link isn't one of those above, or SoundCloud shows no track at `soundcloudTrack` |
| 404 | There's no such session, which is checked before the track is resolved |
| 409 | The session is cancelled, which is checked before the track is resolved too, or the set's track or its video is another set's, with what's in the way in `session` and `set` (see [Rules](#rules)). Or `soundcloudTrack` has to be resolved and the credentials of the SoundCloud app haven't been entered yet, with both null |
| 502 | `soundcloudTrack` has to be resolved, and SoundCloud can't be reached, or answers unexpectedly |

When it fails, nothing is saved.

## `PATCH /api/admin/sets/:id` (admin)

Changes the fields of a set it's sent, even when its session is cancelled, and leaves the others as they are (see
[Changes, in Conventions](README.md#conventions)). It doesn't change the set's session (see
[`PUT /api/admin/sets/:id/session`](#put-apiadminsetsidsession-admin)), its place among its session's sets, or its
status. It takes any of the fields that `POST /api/admin/sessions/:id/sets` takes, and only resolves `soundcloudTrack`
when it's sent (see [Links](#links)). Responds like `POST /api/admin/sessions/:id/sets`, with the session as it is then,
and fails like it, but with 400 when there's no field, with 404 when there's no such set, which is checked before the
track is resolved, and without the 409 for a cancelled session.

## `PUT /api/admin/sets/:id/status` (admin)

| Request field | Type | |
|---|---|---|
| `status` | `"planned"`, `"done"` or `"cancelled"` | |

Changes a set's status, and its session's when that makes it done, or planned again (see [Status](#status)), and
responds like `POST /api/admin/sessions/:id/sets`, with the session as it is then. Fails with 400 if `status` isn't one
of these values, 404 when there's no such set, or 409 when the set wouldn't be cancelled anymore while its session is,
with that session in `session`, or else while its application is rejected, with `session` and `set` null (see
[Applications](#applications)).

## `PUT /api/admin/sets/:id/position` (admin)

| Request field | Type | |
|---|---|---|
| `position` | number | The set's new place among its session's sets, from 0 for the first, cancelled ones included. Past the last, it goes last |

Moves a set to another place among its session's sets, even when its session is cancelled, and leaves the others in
their order (see [Sets' order](#sets-order)). It doesn't change the set's fields or its status, or who last changed it.
Responds like `POST /api/admin/sessions/:id/sets`. Fails with 400 if `position` isn't a whole number from 0 to 2^53 − 1,
and 404 when there's no such set.

## `PUT /api/admin/sets/:id/session` (admin)

| Request field | Type | |
|---|---|---|
| `session` | string | The id of the session to move the set to |

Moves a set to another session, after its sets, which counts as changing the set (`updatedBy` and `updatedAt`), and
leaves the sets of the session it leaves in their order (see [Sets' order](#sets-order)). Nothing else about the set
changes, its status included. Then both sessions follow their sets (see [Status](#status)). A set moved to the session
it's in stays where it is, and no status changes, but it still counts as changed.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `session` | session | The set's session, which it was moved to, with its sets, as it is then |
| `previousSession` | session | The session the set was in, with its other sets, as it is then: the same one as `session` when the set was moved to the session it was in |

Fails with 400 if `session` isn't a string, or when there's no such session (`"No such session"`), 404 when there's no
such set, which is checked before the session, or 409 when the set isn't cancelled and the session is, with that
session in `session` (see [Rules](#rules)).

## `DELETE /api/admin/sets/:id` (admin)

Deletes a set, which can make its session done (see [Status](#status)), and takes it out of the radio's rotation (see
[The rotation of sets, in Radio](radio.md#the-rotation-of-sets)), and responds like
`POST /api/admin/sessions/:id/sets`, with the session as it is then, without the set. The session's other sets keep their
order. Its performers stay, and so does its application. Fails with 404 when there's no such set.
