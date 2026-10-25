# Events

Parking Radio's events are managed on Resident Advisor, under the Parking Radio promoter page
(`https://ra.co/promoters/183980`).

## Reading the events from RA

RA has no public API, so the server uses the GraphQL endpoint ra.co itself calls (`https://ra.co/graphql`), which is
undocumented and could change. The server checks RA's answer against a schema and keeps the outcome, successful or
not, for 2 minutes, so RA is asked at most that often. In case RA's private API changes, this should make it
possible to quickly notice the problem and get it fixed.

RA has no notion of event categories, so the server derives one for each event from its title, so that the client
doesn't have to guess from titles itself. For now, the only category is synth meetups (events titled "SYNTH MEETUPS" on
RA); every other event is categorized as "other".

An event's lineup is the "Line-up" text on the RA event, one act per line, or its tagged artists if that's empty.

## `GET /api/events`

| Response field | Type | |
|---|---|---|
| `promoterUrl` | string | Parking Radio's page on RA |
| `upcoming` | list of events | All of them, in no particular order |
| `past` | list of events | The 20 most recent, in no particular order |

An event has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `category` | `"synth-meetup"` or `"other"` | Derived from the title |
| `start` | string | Local time, as RA gives it, without a timezone: `"YYYY-MM-DDTHH:mm"` |
| `end` | string or null | Same |
| `venue` | string or null | |
| `city` | string or null | |
| `lineup` | list of strings | |
| `url` | string | The event's page on RA |
| `flyer` | string or null | Full size, on images.ra.co |

Fails with 502 when the events can't be read from RA.
