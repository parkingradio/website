# Programmation

This page lists Parking Radio's events, in the site's own style: its events on Resident Advisor (see
[RA events](../server/ra-events.md)) while the `evenements-publics` feature flag is off, and the public events, its
announced sessions (see [Events](../server/events.md)), once it's on (see [Features](../server/features.md)). It only
asks for them once it knows whether the flag is on, and says that it's loading until then (see
[Feature flags](architecture.md#feature-flags)).

The page has two tabs, "à venir" (upcoming, soonest first) and "passés" (the 20 most recent past events, most recent
first), in the order the server gives them. Events are grouped by month, and a tab without any says so. Each event shows
its date, flyer, title, start and end time, and lineup, as below. Days, months and times are in Québec time, like the
rest of the site, whatever the browser's time zone. Flyers show as small square thumbnails, cropped from the middle, and
events without a flyer get a plain placeholder. The name "parking.radio" is always shown in lowercase, even where RA
capitalizes it (the venue is "Parking.Radio" there). The header links to the promoter page
(`https://ra.co/promoters/183980`).

If the events can't be loaded, for any reason, the page says so and links to the promoter page instead.

## From RA

While the flag is off, each event shows its venue and city too, and its lineup is the one RA gives. Its times are in
Québec time even for an event abroad (see [Times](../server/ra-events.md#times)). Its flyer, title and a "voir sur RA"
button all link to the event's RA page. Flyers are loaded through RA's image resizer (`imgproxy.ra.co`) rather than full
size.

## From the public events

Once the flag is on, each event shows:

- Its title, or, for a cancelled event, which stays listed, "[CANCELLED] " then its title, the way RA marks its
  cancelled events.
- Its start and end (see [Events](../server/events.md)), but no venue or city, since the events are always at the
  studio.
- Its lineup, the event's `lineup` (see [Events](../server/events.md#whats-public)). A synth meetup without one that
  isn't cancelled shows "OPEN JAM", as on RA, and any other event without one shows no lineup.
- Its flyer, at its 320-pixel size (see [Photos](../server/artists.md#photos)), downloaded once it's about to come into
  view, and shown as the same small square thumbnail.

When the event has an event on RA, its flyer, title and a "voir sur RA" button link to it. Otherwise, neither its flyer
nor its title is a link, and there's no button.

The header also links to the calendar feed of the events (see
[`GET /calendar.ics`](../server/events.md#get-calendarics)), whether the events are loading, loaded, or couldn't be, since
the feed doesn't depend on them: "s'abonner au calendrier", a link to `webcal://<site's host>/calendar.ics`, which opens
the calendar app.

## Endpoints

- `GET /api/ra-events`, while the flag is off.
- `GET /api/events` and `GET /api/events/:id/flyer?width=320`, once it's on, and it links to `GET /calendar.ics`.
