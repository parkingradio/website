# Appliquer

This page is the form artists fill in to apply for a slot at Parking Radio. What it collects is reused in the
rest of Parking Radio's workflow, so it avoids free-form text wherever it can: answers are picked from lists,
and links are reduced to profile names. The form checks the artist's profile and application as the server does (see
[Profiles](../server/artists.md#profiles) and [Applications](../server/artists.md#applications)), for immediate
feedback. The server checks them again, and its check is the one that counts: if it refuses what the form accepted, the form
shows the server's message. On top of those, it sets limits of its own, which the server doesn't (admins can bring in applications
that don't follow them): they're listed in `client/src/pages/appliquer/choices.ts`.

The fields are (* means mandatory):

- "Vous postulez en tant que" (*): "Artiste" or "Collectif". The form explains the difference: an artist
  usually gets an hour in one of the programmation's time slots, a collective a whole (4-hour) slot, and once
  its date is confirmed a collective makes its own flyer (to diversify Parking Radio's content and let the
  collective's spirit take over the usual schedule).
- "Nom d'artiste" or "Nom du collectif" (*): free-form text.
- "Artistes du collectif" (*, for a collective only): the names of the 1 to 4 artists representing it.
- "Pays" (*): a search field over every country, by its French name. Canada, the US, France, Belgium and
  Switzerland come first. Only a country from the list counts.
- "Ville" (*): free-form text. As the artist types, it suggests the chosen country's cities of at least 5000
  inhabitants, with their province or state, from GeoNames' free web service (called directly by the browser, with
  the `parkingradio` account). Only the city's name is sent. GeoNames is only a convenience: when it's unavailable,
  the field works as plain text. As GeoNames' terms ask, the bottom of the page credits it.
- "Genres musicaux" (*): 1 to 3 genres from a list grouped by family, in order: the first one is the artist's
  main genre.
- "Photo": a JPEG, PNG or WebP image of up to 10 MB. It's optional, but the form encourages it by asking for a good
  quality press photo for our site. A photo that was picked can be removed.
- "Bio" (*): free-form text, up to 1500 characters.
- "Liens" (*, at least one): one field per site (SoundCloud, Instagram, website and Bandcamp are always shown;
  Mixcloud, Resident Advisor, YouTube, Spotify and TikTok can be added). Each field shows the site's address
  around the profile name. A pasted address is reduced to the profile name, which is what's stored, as soon as it's
  pasted (or when leaving the field, for one that's typed); one that can't be read says why right away.
- "Type de prestation" (*, at least one): any of "DJ", "Vinyl", "Performance Live", "Rap" and "Full Band", and
  "Autre", which asks for a few words.
- "Adresse e-mail" (*) and "Numéro de téléphone" (*).
- "Dates souhaitées" (*): a calendar where the artist picks 1 to 14 days, from 2 months ahead (to leave time to
  plan) up to 12 months ahead. The form says these availabilities may not be respected.
- "Plages horaires préférées": any of the programmation's time slots (11 h – 15 h, 13 h – 17 h and
  18 h – 22 h), for all the chosen dates. None means any of them. They're sent as the times they start and end.
- "Questions ou détails": free-form text.

Errors only show once the artist tries to send the form, which brings them to the first field to fix. After that,
they update as the fields are fixed.

Above the button that sends the form, a Cloudflare Turnstile checks that the artist is a person, usually without
them having to do anything: its checkbox is only shown when Cloudflare needs the artist to click it. The form can't
be sent until Turnstile has vouched for the artist, and it gets a new token whenever an application is refused, since
Cloudflare only checks each token once (see [Applying](../server/artists.md#applying)). The widget uses the site key
from the configuration (see [Configuration](architecture.md#configuration)).

When an artist sends the form, it goes to `POST /api/applications`, which creates the artist and their application, and
sends the emails about it (see [Applying](../server/artists.md#applying) and [Emails](../server/artists.md#emails)).
Once it's sent, the form thanks the artist and says where the confirmation went. Otherwise, it shows the server's error,
e.g. when an artist already has that email address: the form is only for new artists for now. Artists we already know
will apply again from a different page, which isn't designed yet.

Until the `nouveau-formulaire-candidature` feature flag is turned on (see
[Feature flags](architecture.md#feature-flags)), the page shows the original Google Form instead, and it goes back to it
when the flag is turned off, e.g. if the form has a problem.

## Endpoints

- `POST /api/applications`, to send the form.
