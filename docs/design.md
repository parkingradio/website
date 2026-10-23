# Site Design

All pages share a common navigation bar at the top, from which all pages can be reached. The web app is
a single-page application: changing to another page does not require reloading the whole app.
On narrow screens like phones, the navigation links move into a drawer that slides in from the left,
opened by a menu button to the left of the logo.

## Lecteur

All pages share a single audio player, a black bar fixed at the bottom of the screen, which plays the radio. Since the
app is a single-page application, it keeps playing while visitors move from page to page. The radio is called
"en ondes" everywhere on the site.

Until the `nouveau-lecteur` feature flag is turned on (see "Configuration" below), there's no player: neither the bar
nor the navigation bar's button. The main page has a player of its own instead (see "Main page" below), which plays its
own rotation, and which the shared player replaces while the flag is on: it comes back if the flag is turned off.

### Radio rotation

The rotation playing on the radio is the tracks of a SoundCloud playlist, read by the server. The playlist is
chosen on the admin pages. The server reads it through a SoundCloud app, whose credentials are entered on the admin
pages too (see "Configuration" below): until they are, the radio is off air. The server reads the playlist again
every 5 minutes, so that changes made to it on SoundCloud get on the radio. If SoundCloud can't be reached, the radio
goes on with what it read before.

The server decides what's on air: it keeps the track on air and when it started in the database, and moves
along the rotation as tracks end. This is provided to the client via an API:

- `GET /api/radio` returns the track on air, when it started, and the tracks after it.
- `GET /api/radio/tracks/:id/stream` returns where to play a track of the rotation from.

Changing the playlist changes what's on air right away: the new playlist starts from its first track. Listeners
who are playing a track aren't cut off, though: they finish it, then play what's on air by then. The same goes
for a track that's removed from the playlist. To make this possible, the client sticks with the track it's
playing until it ends, and the server still hands out streams for tracks that left the rotation for as long as
they last.

### Playing the radio

The player plays what's on air, at the same position as every other listener: the sets of the rotation can't be played
on their own, from their start. The radio can be paused and played again from the player or from the system's own
controls (e.g. its media keys, or AirPods taken out and put back in), which show the artist: playing it again joins
the radio where it's at by then, rather than where it was paused. When the set it plays ends, it goes on with the one
on air by then.

The sets are streamed from SoundCloud, in HLS. Browsers that can't play HLS themselves (e.g. Firefox) play it through a
library, which only they load. When a stream stops working, e.g. because its address expired, the player asks for it
again and picks up where the radio is at. If that keeps failing, or if the browser refuses to play, the player stops.

The radio is off air when the player can't know what's on air, e.g. because no playlist has been chosen yet or
SoundCloud can't be reached. The bar then doesn't show, and the navigation bar's button reads "hors ondes" and can't be
clicked, unless a set is still playing, which the player finishes. Once the radio is back on air, the player notices
within a minute.

### The bar

The bar is a single row, from left to right: the play/pause button, "● en ondes", the artist, the event for a takeover
(e.g. "qrtz takeover", in a box), a waveform, "rediffusion · " and the date of the session (e.g.
"rediffusion · 19 avril 2026"), and the volume. Its text is in the site's monospace font, except for the artist, in
bold Helvetica. There's no cover and no progress bar. The waveform isn't drawn from the sound: it's a shape of its own
for each set, which scrolls to the left while the radio plays, and stands still, in grey, while it doesn't.

The volume is a speaker button, which mutes or unmutes the sound, and a slider. Its icon shows the level (one or two
waves) or that the sound is muted. Unmuting after sliding the volume down to zero sets it back to half. The browser
remembers the volume for the next visit.

On narrow screens like phones, the bar shows "● en ondes" and the artist, with "rediffusion · " and the date under
them, without the event or the waveform, so that the artist has room, and without the volume: the device's own buttons
set it (and iOS ignores the volume a page sets).

### Navigation bar button

The navigation bar has an "● en ondes · artiste" button, showing who's on air (in lowercase, like the rest of the
navigation bar), which plays or pauses the radio from any page. Where the navigation bar is short of room for it,
between the width at which its links fit on one line and the width at which the whole button fits too, it's only the
red dot (still named in full for screen readers). On phones, it only shows "● en ondes".

## Main page

This page is the radio's home page. From top to bottom, it shows the pieces below, which used to be a single
custom-built widget (a static HTML/JS page hosted externally, on Cloudflare R2, embedded as an iframe), and still look
and behave as they did then.

- **Radio player**: only while the `nouveau-lecteur` feature flag is off (see "Lecteur" above), and once the page knows
  that it is. It's not a real live audio stream, but a simulated 24/7 rotation. It's driven by a playlist manifest (an
  ordered list of tracks, each with a name, date and audio URL) and the tracks' durations, which are
  kept on that R2 bucket, outside of this app (see [deployment.md](deployment.md#the-legacy-radios-r2-bucket)). It
  computes "what's playing now" as `elapsed-time-since-epoch modulo total-playlist-duration`, so all listeners hear
  the same track at the same position at any given moment, like a real broadcast. A play/pause control, a live
  indicator, a progress bar, and the current track's name/date are shown in a bar at the top. A scrolling
  marquee underneath lists all track names in the rotation. A "Schedule" dropdown shows the full rotation as
  a table (start time, artist, date, duration), with the on-air track highlighted; clicking a row plays that
  track on demand (with seeking) instead of the live rotation, and a "Live" button jumps back to the
  synced rotation.
- **Video widget**: shows Parking Radio's YouTube channel: a clickable thumbnail of the channel's most recent upload
  (click-to-play, not autoplay), or a "Hors direct" placeholder if there's no video at all. It's meant to embed the
  live stream while the channel is live, but doesn't detect it yet.
- **Discord chat**: an embedded WidgetBot widget showing a specific text channel from Parking Radio's Discord
  server, letting visitors follow and join the conversation without leaving the site.

Playback of the radio, from either player, and the video widget is mutually exclusive: starting one pauses the other,
so visitors aren't listening to two audio sources at once.

## Archives

This page lets visitors browse and listen to past diffusion sessions. It embeds the SoundCloud player widget
for the `parkingdotradio` account
(`https://w.soundcloud.com/player/?url=https://soundcloud.com/parkingdotradio&visual=false&buying=false&liking=true&download=false&sharing=true&show_comments=true&show_playcount=true&show_teaser=true&show_user=false&hide_related=true&show_reposts=true&callback=true`)
as an iframe, which lists the account's tracks (title, date, play count) and lets visitors play them directly.
SoundCloud handles playback and hosting entirely; this page is just a thin wrapper around the embed.

## Programmation

This page lists Parking Radio's events. Events are managed on Resident Advisor, under the Parking Radio
promoter page (`https://ra.co/promoters/183980`), and the page shows them in the site's own style, linking
back to RA.

The server fetches the events from RA through `GET /api/events`. RA has no public API, so this uses the
GraphQL endpoint ra.co itself calls (`https://ra.co/graphql`), which is undocumented and could change. The
server checks RA's answer against a schema and keeps the outcome for 2 minutes, so RA is asked at most that
often. If the fetch fails for any reason, the page says the events couldn't be loaded and links to RA. In
case the private GraphQL API changes, this should make it possible to quickly notice the problem and get it
fixed.

RA has no notion of event categories, so the server derives one for each event from its title and includes it
in the response, so that the client doesn't have to guess from titles itself. For now, the only category is
synth meetups (events titled "SYNTH MEETUPS" on RA); every other event is categorized as "other".

The page has two tabs, "à venir" (upcoming, soonest first) and "passés" (the 20 most recent past events, most
recent first). Events are grouped by month. Each one shows its date, flyer, title, venue, city, start and end
time, and lineup (from the "Line-up" text on the RA event, or its tagged artists if that's empty). Its
flyer, title and a "voir sur RA" button all link to the event's RA page. Flyers show as
small square thumbnails cropped from the middle, loaded through RA's image resizer (`imgproxy.ra.co`) rather
than full size. Events without a flyer get a plain placeholder. The name "parking.radio" is always shown in lowercase, even where RA
capitalizes it (the venue is "Parking.Radio" there). The header links to the
promoter page. If the events can't be loaded, the page says so and links to the promoter page instead.

## Synth Meetups

This page presents the Synth Meetups, Parking Radio's weekly gatherings for sound and audiovisual creation
(Wednesdays at 18h), where people can learn about the studio's technical setup, try out ideas and meet
collaborators. From top to bottom, it shows:

- The Synth Meetups animated banner.
- A short introduction to the meetups.
- "dates à venir": the upcoming meetup dates (e.g. "mercredi 7 octobre 2026"), soonest first, each linking
  to its event on Resident Advisor. They come from `GET /api/events` so a meetup shows up here once it's
  created on RA.
- "mandat": the goals of the meetups.
- "le plafond": how to show visuals on the studio's LED ceiling
- "évènements passés": a gallery of past meetup posters, most recent first, as cropped portrait thumbnails.
  Clicking one shows it full size in a lightbox over the page.

The banner and posters are static assets served from `assets.<domain>` (see "Assets" in the README). The
list of posters is written in the page's code, so adding a poster means uploading it with
`tools/manage-assets` and adding its key to that list.

## Appliquer

This page is the form artists fill in to apply for a slot at Parking Radio. What it collects is reused in the
rest of Parking Radio's workflow, so it avoids free-form text wherever it can: answers are picked from lists,
and links are reduced to profile names. The form checks the artist's profile and application with the same rules
and messages as the server (`checkProfile` in `shared/src/artists.ts` and `checkApplication` in
`shared/src/applications.ts`), which checks them again. On top of those, it sets limits of its own, which the server
doesn't (admins can bring in applications that don't follow them): they're listed in
`client/src/pages/appliquer/choices.ts`.

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
be sent until it has, and the server checks it again with Cloudflare. Since Cloudflare only checks each token once,
the form gets a new one whenever an application is refused.

When an artist sends the form, it goes to `POST /api/applications` (see "Candidatures" below for what happens then).
Once it's sent, the form thanks the artist and says where the confirmation went. Otherwise, it shows the server's
error, e.g. when an artist already has that email address: the form is only for new artists for now.

Until the `nouveau-formulaire-candidature` feature flag is turned on (see "Configuration" below), the page shows the
original Google Form instead, and it goes back to it when the flag is turned off, e.g. if the form has a problem.

## Contribuer

This page lets visitors make a donation to Parking Radio. It embeds Zeffy's donation form
(`https://www.zeffy.com/embed/donation-form/contribuer-a-parkingradio`) as an iframe, which offers a few
preset amounts as well as a free-form custom amount. Zeffy handles payment processing and the donation
flow entirely; this page is just a thin wrapper around the embed.

## Merch

This isn't a page within the app. The "merch" navbar entry is a direct external link to Parking Radio's
Bigcartel store (`https://parkingdotradio.bigcartel.com`), which handles the merch catalog, checkout, and
payment entirely on its own.

## Page introuvable

Any URL that isn't one of the site's pages, including unknown paths under `/admin`, shows a "page
introuvable" page under the navigation bar, with a link back to the main page. The server still answers
these URLs with the app and a 200 status (a "soft 404"), since it doesn't know which pages the app has.

## Admin

This part of the site provides the tools Parking Radio's team uses to run the project. It lives under
`/admin`, which isn't linked from the navigation bar.

Every admin page requires being logged in. Logged out, a page shows a login form in its place, and once
logged in it shows the page that was asked for.

The admin pages keep the site's navigation bar. Under it, a menu lists the sections below, followed by the
logged-in admin's email and a "se déconnecter" button. The section itself is shown to the right of the menu.
On narrow screens like phones, the menu becomes a row above the section instead. `/admin` shows the first
section.

### Calendrier

At `/admin/calendrier`: the internal calendar of bookings. Not designed yet.

Until then, it embeds the calendar the team already uses (`https://calendar-cross-reference.vercel.app/`), which
cross-references the studio's booking and other calendars.

### Rotation radio

At `/admin/rotation`: chooses the SoundCloud playlist the radio's rotation is read from (see "Radio rotation"
above). From top to bottom, it shows:

- "À l'antenne": the playlist the rotation is read from.
- "Changer de playlist": a field for the link to another playlist.

Until the credentials of the SoundCloud app have been entered, a line at the top says that the radio can't read any
playlist until then, and links to "Configuration", where they're entered.

### Candidatures

At `/admin/candidatures`: the artists' applications for a set, for the team to go through. An application belongs
to an artist (see "Artistes" below), and says when they'd like to play (days, and times of day if they have a
preference), what they'd do and anything else they'd like to say. What they'd do is picked from a list (DJ, Vinyl,
Performance Live, Rap, Full Band), plus "autre" in a few words, the same on the "Appliquer" form and on the admin
pages. Each one in the list is stored as an id that doesn't change, so that applications can be told apart by what the
artists would do, whatever its name. Each application has a status: "nouvelle" when it's created, then "retenue" or
"refusée" as an admin decides, and a retained application is "planifiée" once a date has been set with the artist, then
"faite" once they've played. That's only the usual order: admins can change a status to any other.

Each application also says when the artist sent it ("reçue le"), which isn't always when it was entered on the admin
pages: an application that came by email, or through the original Google Form, can be brought in long after.

The section lists every application, the most recently received first, with when it was received, the artist, their
first few dates, the prestations and the status. Buttons above the list show only the applications with a status, with
how many there are of each.

A field above the list searches the applications by their artist, like in "Artistes" (see below), their prestations,
their questions or details, and the days the artist would like to play, written out (e.g. "jeudi 10 décembre 2026"), so
that "décembre" or "jeudi" finds the applications with a day in December, or a Thursday. Clicking "Reçue le", "Artiste", "Dates" (by the first day the artist would like to play) or
"Statut" (nouvelle, retenue, planifiée, faite, then refusée) sorts the list by that column, and clicking it again sorts
it the other way around. The status buttons count the applications the search finds.

Under the list, a line says that who the applications artists send are emailed to is chosen in "Configuration" (see
below), and links to it.

Clicking an application opens it at `/admin/candidatures/<id>`. Under its title, it says when it was received, unless
it's the day it was created, and who created it and when (or that it was sent through the form). From top to bottom, it
then shows:

- "Statut": the status, as buttons that change it, and which admin last changed it, and when.
- "Artiste": who the artist is and how to reach them, linking to their page.
- "Candidature": everything in the application, and a button that changes it in a form in its place, including the day
  it was received.
- "Supprimer": deletes the application for good, after confirming. The artist stays.

"nouvelle candidature" creates an application by hand, e.g. to bring in one that came through the original Google
Form: a form with the artist, picked from those in the "Artistes" section, the day the application was received (today
if it's left empty), then the application itself. An artist's page leads to it with that artist picked already.

Artists apply through the "Appliquer" form once its feature flag is on, and through the original Google Form until
then. When a new artist applies through the form (`POST /api/applications`), the server creates both the artist and
their application. On the application's page, admins see that it was sent through the form, where they'd
otherwise see which admin created it.

The form is only for new artists. If someone applies with the email of an artist we already know, the application is
refused. Otherwise, anyone could take over an artist's profile just by typing their email. Artists we already know will
apply again from a different page, which isn't designed yet.

### Artistes

At `/admin/artistes`: the artists Parking Radio knows of, which are the artists who applied. An artist is an
artist or a collective, with their name (and for a collective, the names of its artists), country and city,
genres (most important first), bio, links, email address, phone number and photo, which is optional.

Admins can leave out an artist's country, city, genres, links and phone, unlike artists on the "Appliquer" form, since
admins bring in artists who applied elsewhere, e.g. through the original Google Form, which didn't always ask for them.
The admin pages show "-" in place of what's left out, or only the city or the country, when the other one is.

The section lists every artist, by name, with which of the two they are, their city and genres. A field above the list
searches the artists by their name (and a collective's artists), email address, phone number, city, country, genres and
the profile names of their links, but not their bio, which would match too many searches. Clicking "Nom", "Type"
(artists before collectives) or "Ville" (by city, then country) sorts the list by that column, and clicking it again
sorts it the other way around.

Both this list and the applications' (see "Candidatures" above) find the entries that have every word searched for, in
any of the fields searched, whatever their case and accents, and allowing for a typo in words of 5 letters or more. The
search and the order are kept in the page's address, along with the applications' status, so that going back to a list
from one of its entries with the browser's back button finds it as it was.

Clicking an artist opens their page at `/admin/artistes/<id>`, with everything about them, their photo (or "Pas de
photo" in its place, so that the team notices), their links rebuilt from the profile names, who added them (or that they
applied by themselves) and who last changed them. A button changes the artist in a form in its place. The form shows the
artist's photo with an × that removes it once the artist is saved, and a photo that's chosen replaces it, shown in its
place with an × that takes it back. Under it, their applications are listed like in "Candidatures", with a button to
create another one. At the bottom, the artist can be deleted for good, with their photo, if they have one, and
applications, after confirming.

"ajouter un artiste" adds an artist by hand, with the same form. In it, a collective's artists are typed one by one
and pinned with a "+" button (or Enter): only the names pinned are kept, so the form isn't sent while a name is left
typed without being pinned. Genres are tags to click, which pins them in order of importance, and the country is
typed, with the matching countries suggested, of which one has to be picked, "Pays inconnu" leaving it out.
Each field says what's wrong with it once it's left, with the same rules and messages as the server, for admins (see
`checkProfile` in shared/src/artists.ts), and so does the application form (see `checkApplication`).

### Admins

At `/admin/admins`: manages who can access the admin pages.

- "Inviter un admin": emails an invite to a given address. The invite links to `/accept-invite`, where the
  new admin chooses their password, after which they can log in.
- "Admins existants": lists the admins by email, with "(vous)" next to the admin's own, their status ("actif",
  "invitation envoyée" with when it expires, or "invitation expirée"), and when they were added and by whom. "révoquer"
  revokes another admin after confirming, which ends their sessions, or cancels their invite if they haven't accepted it.
  Those who haven't can be invited again with "renvoyer".

There's no admin to begin with: the first admin of a deployment is created with `tools/create-admin` (see
[deployment.md](deployment.md#creating-admins)), which also gives an admin who forgot their password a link to choose a
new one.

### Configuration

At `/admin/configuration`: the settings that change what the site does. From top to bottom, it shows:

- "Envoi des candidatures par e-mail": who the applications artists send are emailed to.
- "Application SoundCloud": the credentials of the SoundCloud app the radio reads its playlist through.
- "Features": the feature flags.

`/admin/features`, where the feature flags used to be, leads here.

#### Envoi des candidatures par e-mail

Chooses who the applications artists send are emailed to: email addresses, each typed then added with + (or Enter) and
removed with its ×, like a collective's artists. Each change is saved right away. It also says which admin last
changed them, and when. Each application is emailed to them, without the artist's photo, which is on the artist's page,
and replying answers the artist.
The artist also gets an email confirming that their application was received, and replying to that one answers these
addresses. Until someone is chosen, applications are only listed in "Candidatures", and only the artist gets an email.
Applications that admins create by hand aren't emailed.

#### Application SoundCloud

The credentials of the SoundCloud app the radio reads its playlist through (see "Radio rotation" above), which are
found in the apps of the SoundCloud account it belongs to. It shows which admin last changed the credentials, and when,
or that the radio is off air until they're entered.

Under that, a form replaces the credentials: the client ID, filled in with the current one, and the secret. The secret is
never shown again once it's entered, so its field only shows dots in its place, and it has to be typed to replace the
credentials. "vérifier" asks SoundCloud whether it accepts the credentials typed, without saving them, and
"enregistrer" saves them, which it only allows once the credentials typed have been verified. Each one shows a green
check mark next to it once it went through, until the credentials are changed again. The server checks the credentials
with SoundCloud again when it saves them, so that a typo can't take the radio off air, and the radio reads its playlist
through them right away. They're kept in the database rather than set when
the site is deployed, so that they can be changed without deploying it again.

#### Features

The feature flags, switches that turn parts of the site on or off without deploying it again. They're meant for going
back to the old version of something, e.g. the Google Form in place of the new "Appliquer" form if it has a problem.

It lists every flag, each with a switch, its name, what it does, and which admin last switched it, and when.
Each switch is saved right away, and visitors get the change as soon as they load a page of the site. A page they
already have open stays as it was until they load it again. While there are no flags, it says so.

Every flag is off until an admin turns it on, so that a flag can be deployed without changing anything until then. A
page that depends on a flag shows nothing until it knows whether the flag is on, rather than switching from one version
to the other in front of the visitor. When it can't know, it behaves as if the flag were off. For that reason, "off"
always has to be the safe option: the old version, or the one that relies the least on our own server.

The flags are listed in `FEATURES`, in shared/src/features.ts, and named in `FEATURE_LABELS`, in
client/src/pages/admin/describe.ts. Retiring a flag only takes removing it from both.
