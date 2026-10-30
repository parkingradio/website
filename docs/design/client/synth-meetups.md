# Synth Meetups

This page presents the Synth Meetups, Parking Radio's weekly gatherings for sound and audiovisual creation
(Wednesdays at 18h), where people can learn about the studio's technical setup, try out ideas and meet
collaborators. From top to bottom, it shows:

- The Synth Meetups animated banner.
- A short introduction to the meetups.
- "dates à venir": the upcoming meetup dates (e.g. "mercredi 7 octobre 2026"), soonest first, each linking
  to its event on Resident Advisor. They're the upcoming events in the synth meetups category (see
  [Events](../server/events.md)), so a meetup shows up here once it's created on RA. When there are none, it says
  that no date is announced yet. When the events can't be loaded, it says so, and links to the promoter page on RA.
- "mandat": the goals of the meetups.
- "le plafond": how to show visuals on the studio's LED ceiling
- "évènements passés": a gallery of past meetup posters, most recent first, as cropped portrait thumbnails.
  Clicking one shows it full size in a lightbox over the whole screen, navigation bar and player included. While it's
  open, nothing else can be reached, not even with the keyboard. Clicking anywhere or pressing Escape closes it, and the
  focus goes back to where it was before it opened.

The banner and posters are static assets (see [Assets](architecture.md#assets)). The list of posters is written in the
page's code, so adding a poster means uploading it with `tools/manage-assets` and adding its key to that list.

## Endpoints

- `GET /api/events`.
