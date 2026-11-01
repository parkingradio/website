# Appliquer

This page is the form artists and collectives fill in to apply for a slot at Parking Radio. What it collects is reused
in the rest of Parking Radio's workflow, so it avoids free-form text wherever it can: answers are picked from lists, and
links are reduced to profile names. The form checks the artist's profile and application as the server does (see
[`POST /api/applications`](../server/applications.md#post-apiapplications) and [Applications](../server/applications.md)),
for immediate feedback. The server checks them again, and its check is the one that counts: if it refuses what the form
accepted, the form shows the server's message. On top of those, it sets limits of its own, which the server doesn't
(admins can bring in applications that don't follow them): they're listed in `client/src/pages/appliquer/choices.ts`.

The fields of an artist applying alone are (* means mandatory):

- "Vous postulez en tant que" (*): "Artiste" or "Collectif". The form explains the difference: an artist
  usually gets an hour in one of the programmation's time slots, a collective a whole (4-hour) slot, and once
  its date is confirmed a collective makes its own flyer (to diversify Parking Radio's content and let the
  collective's spirit take over the usual schedule).
- "Nom d'artiste" (*): free-form text.
- "Pays" (*): a search field over every country, by its French name. Canada, the US, France, Belgium and
  Switzerland come first. Only a country from the list counts.
- "Ville" (*): free-form text, which can only be typed once a country is picked, and is emptied when the country
  changes. As the artist types, it suggests the chosen country's cities of at least 5000 inhabitants, with their
  province or state, from GeoNames' free web service (called directly by the browser, with the `parkingradio`
  account). Only the city's name is sent. GeoNames is only a convenience: when it's unavailable, the field works as
  plain text. As GeoNames' terms ask, the bottom of the page credits it.
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

### Collectives

A collective fills in the same parts, with the same numbers, as an artist applying alone, with these differences, so
that the team knows each of its artists, not only the collective:

- The first part, "Le collectif", has "Nom du collectif" (*), then the collective's own "Pays" (*) and "Ville" (*), like
  an artist's, then "Artistes du collectif" (*, see below), and a note saying that collectives make their own flyer. A
  collective has no genres of its own: its genres are its artists'.
- "Présentation" has the collective's photo, its "Description" (*, like a bio) and its links.
- "Prestation" describes the collective's show as a whole.
- "Contact" has a single email address and phone number, and says that they're the collective's contact person's, the
  only one the team communicates with, who gets the confirmation. Its artists have none of their own.

"Artistes du collectif" has the 1 to 4 artists representing the collective (that limit is the form's, not the
server's), as tabs above the profile of the one selected:

- Each tab shows the artist's number and name ("Artiste 2" until it's typed), and "✓" once their profile is complete or
  "○" until then. Once the form was sent, a tab whose profile has errors is shown as one to fix. A "×" takes the artist
  out of the collective, after confirming when something was filled in their profile, but there's no "×" when there's
  only one artist. When the selected artist is taken out, the next tab is selected, or the previous one if it was the
  last; otherwise the selection stays on the same artist.
- "+ ajouter un artiste (2 / 4)", after the tabs, adds an artist and selects their tab, up to 4.
- An artist's profile has the same fields as an artist applying alone, in the same order, with the same rules and the
  same limits of the form's (e.g. up to 3 genres, and a bio of up to 1500 characters): "Nom d'artiste" (*), "Pays" (*),
  "Ville" (*), "Genres musicaux" (*), "Photo" (optional), "Bio" (*) and "Liens" (*). It has no email address or phone
  number. The profiles that aren't selected keep what they show, e.g. a link field that was added.

A link's error shows as soon as it's pasted or its field is left. Other errors only show once the artist tries to send
the form, which brings them to the first field to fix. For a collective, the profile of the first of its artists with
errors is then selected, and the first field to fix may be in it. After that, errors update as the fields are fixed, and
the form says how many are left to fix, counting those in every artist's profile.

Above the button that sends the form, a Cloudflare Turnstile checks that the artist is a person, usually without them
having to do anything: its checkbox is only shown when Cloudflare needs the artist to click it. The form can't be sent
until Turnstile has vouched for the artist (the form says so if they try), and it gets a new token whenever an
application is refused, since Cloudflare only checks each token once (see
[Applying](../server/applications.md#applying)). The widget uses the site key from the configuration (see
[Configuration](architecture.md#configuration)), so the widget only shows once the page has the configuration, and the
form can't be sent when it can't be fetched: it then says so, and to reload the page.

When an artist sends the form, it goes to `POST /api/applications`, which creates the artist, or the collective and its
artists, and the application, and sends the emails about it (see [Applying](../server/applications.md#applying) and
[Emails](../server/applications.md#emails)). Once it's sent, the form thanks the artist and says where the confirmation
went. Otherwise, it shows the server's error, e.g. when an artist, or a collective, already has that email address: the
form is only for new artists and collectives for now. Artists we already know will apply again from a different page,
which isn't designed yet. An error about one of a collective's artists says which one. When the answer isn't the
server's, e.g. the network failed, the form says that the application couldn't be sent, and to try again in a moment.

## Endpoints

- `POST /api/applications`, to send the form.
