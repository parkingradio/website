# Programmation

This page lists Parking Radio's events (see [Events](../server/events.md)), in the site's own style, linking back to
Resident Advisor.

The page has two tabs, "à venir" (upcoming, soonest first) and "passés" (the 20 most recent past events, most recent
first). Events are grouped by month, and a tab without any says so. Each event shows its date, flyer, title, venue,
city, start and end time, and lineup. Its flyer, title and a "voir sur RA" button all link to the event's RA page.
Flyers show as small square thumbnails cropped from the middle, loaded through RA's image resizer (`imgproxy.ra.co`)
rather than full size. Events without a flyer get a plain placeholder. The name "parking.radio" is always shown in
lowercase, even where RA capitalizes it (the venue is "Parking.Radio" there). The header links to the promoter page.

If the events can't be loaded, for any reason, the page says so and links to the promoter page
(`https://ra.co/promoters/183980`) instead.

## Endpoints

- `GET /api/events`.
