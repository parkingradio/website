# Site Design

All pages share a common navigation bar at the top, from which all pages can be reached. The web app is
a single-page application: changing to another page does not require reloading the whole app.
On narrow screens like phones, the navigation links move into a drawer that slides in from the left,
opened by a menu button to the left of the logo.

## Main page

This page is the radio's home page. It embeds a single custom-built widget (currently a static HTML/JS page hosted
externally, on Cloudflare R2) as an iframe, combining three pieces:

- **Radio player**: not a real live audio stream, but a simulated 24/7 rotation. It's driven by a playlist
  manifest (an ordered list of tracks, each with a name, date, audio URL, and duration) and computes "what's
  playing now" as `elapsed-time-since-epoch modulo total-playlist-duration`, so all listeners hear the same
  track at the same position at any given moment, like a real broadcast. A play/pause control, a live
  indicator, a progress bar, and the current track's name/date are shown in a bar at the top. A scrolling
  marquee underneath lists all track names in the rotation. A "Schedule" dropdown shows the full rotation as
  a table (start time, artist, date, duration), with the on-air track highlighted; clicking a row plays that
  track on demand (with seeking) instead of the live rotation, and a "Live" button jumps back to the
  synced rotation.
- **Video widget**: shows Parking Radio's YouTube channel — if the channel is currently live, the live
  stream is embedded and autoplays; otherwise, a clickable thumbnail of the channel's most recent upload is
  shown (click-to-play, not autoplay); if there's no video at all, a "Hors direct" placeholder is shown
  instead. This is polled periodically to detect when the channel goes live.
- **Discord chat**: an embedded WidgetBot widget showing a specific text channel from Parking Radio's Discord
  server, letting visitors follow and join the conversation without leaving the site.

Playback of the radio player and the video widget is mutually exclusive: starting one pauses the other, so
visitors aren't listening to two audio sources at once.

### Radio rotation

The rotation playing on the radio is the tracks of a SoundCloud playlist, read by the server. The playlist is
chosen on the admin pages. The server reads the playlist again every 5 minutes, so that changes made to it on
SoundCloud get on the radio. If SoundCloud can't be reached, the radio goes on with what it read before.

The server decides what's on air: it keeps the track on air and when it started in the database, and moves
along the rotation as tracks end. This is provided to the client via an API:

- `GET /api/radio` returns the track on air, when it started, and the tracks after it.
- `GET /api/radio/tracks/:id/stream` returns where to play a track of the rotation from.

Changing the playlist changes what's on air right away: the new playlist starts from its first track. Listeners
who are playing a track aren't cut off, though: they finish it, then play what's on air by then. The same goes
for a track that's removed from the playlist. To make this possible, the client sticks with the track it's
playing until it ends, and the server still hands out streams for tracks that left the rotation for as long as
they last.

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

This page is the form that artists can fill to apply for a slot at Parking Radio. This form collects all the information
that Parking Radio has about an artist. The fields of the form are (* means mandatory):

- "Nom de l'artiste ou collectif" (*): free form text
- "Ville / Pays" (*): free form text
- "Genre musical" (*): free form text
- "Bio" (*): free form text
- "Photo" (*): image upload input
- "Site web": free work text with link validation
- "Soundcloud": free work text with link validation
- "Instagram": free form text with validation
- "Bandcamp": free form text with link validation
- "Youtube": free form text with link validation
- "Type de prestation" (*): choice between "DJ", "Vinyl", "Performance Live", "Rap", "Full Band", "Autre" (with free form text input)
- "Adresse e-mail" (*): free form text with format validation
- "Numéro de téléphone" (*): free form text with format validation
- "Disponibilités" (*): date picker that allows selecting multiple days. Mention that it may or may not be respected.
- "Questions ou détails": free form text

When an artist submits this form, an entry is created in the database with that form's information. The form is protected
from bots by a Cloudflare Turnstile.

For now we use the original Google Forms link.

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

### Admins

At `/admin/admins`: manages who can access the admin pages.

- "Inviter un admin": emails an invite to a given address. The invite links to `/accept-invite`, where the
  new admin chooses their password, after which they can log in.
- "Admins existants": lists the existing admins, and lets an admin revoke another one. Not designed yet.

### Calendrier

At `/admin/calendrier`: the internal calendar of bookings. Not designed yet.

Until then, it embeds the calendar the team already uses (`https://calendar-cross-reference.vercel.app/`), which
cross-references the studio's booking and other calendars.

### Rotation radio

At `/admin/rotation`: chooses the SoundCloud playlist the radio's rotation is read from (see "Radio rotation"
above). From top to bottom, it shows:

- "À l'antenne": the playlist the rotation is read from.
- "Changer de playlist": a field for the link to another playlist.

### Candidatures

At `/admin/candidatures`: the artists' applications for a set, for the team to go through. An application belongs
to an artist (see "Artistes" below), and says when they'd like to play (days, and times of day if they have a
preference), what they'd do and anything else they'd like to say. What they'd do is picked from a list (DJ, Vinyl,
Performance Live, Rap, Full Band), plus "autre" in a few words, the same on the "Appliquer" form and on the admin
pages. Each one in the list is stored as an id that doesn't change, so that applications can be told apart by what the
artists would do, whatever its name. Each application has a status: "nouvelle" when it's created, then "retenue" or
"refusée" as an admin decides.

The section lists every application, most recent first, with when it was created, the artist, their first few
dates, the prestations and the status. Buttons above the list show only the applications with a status, with how
many there are of each.

Under the list, "Envoi par e-mail" chooses who the applications artists send are emailed to: email addresses, each
typed then added with + (or Enter) and removed with its ×, like a collective's artists. Each change is saved right
away. It also says which admin last changed them, and when. Each application is emailed to them with the artist's
photo, and replying answers the artist. The artist also gets an email confirming that their application was
received, and replying to that one answers these addresses. Until someone is chosen, applications are only listed
here, and only the artist gets an email. Applications that admins create by hand aren't emailed.

Clicking an application opens it at `/admin/candidatures/<id>`. From top to bottom, it shows:

- "Statut": the status, as buttons that change it, and which admin last changed it, and when.
- "Artiste": who the artist is and how to reach them, linking to their page.
- "Candidature": everything in the application, and a button that changes it in a form in its place.
- "Supprimer": deletes the application for good, after confirming. The artist stays.

"nouvelle candidature" creates an application by hand, e.g. to bring in one that came through the original Google
Form: a form with the artist, picked from those in the "Artistes" section, then the application itself. An
artist's page leads to it with that artist picked already.

For now, artists still apply through the original Google Form. Once the "Appliquer" form is implemented, most
applications will come from it.

The server is already ready for that form: when a new artist applies (`POST /api/applications`), it creates both the
artist and their application. On the application's page, admins see that it was sent through the form, where they'd
otherwise see which admin created it.

The form is only for new artists. If someone applies with the email of an artist we already know, the application is
refused. Otherwise, anyone could take over an artist's profile just by typing their email. Artists we already know will
apply again from a different page, which isn't designed yet.

### Artistes

At `/admin/artistes`: the artists Parking Radio knows of, which are the artists who applied. An artist is an
artist or a collective, with their name (and for a collective, the names of its artists), country and city,
genres (most important first), bio, links, email address, phone number and photo.

The section lists every artist, by name, with which of the two they are, their city, genres and how many
applications they have.

Clicking an artist opens their page at `/admin/artistes/<id>`, with everything about them, their photo, their links
rebuilt from the profile names, who added them (or that they applied by themselves) and who last changed them. A
button changes the artist in a form in its place, where the photo is only replaced if another one is chosen. Under
it, their applications are listed like in "Candidatures", with a button to create another one. At the bottom, the
artist can be deleted for good, with their photo and applications, after confirming.

"ajouter un artiste" adds an artist by hand, with the same form. In it, a collective's artists are typed one by one
and pinned with a "+" button (or Enter): only the names pinned are kept, so the form isn't sent while a name is left
typed without being pinned. Genres are tags to click, which pins them in order of importance, and the country is
typed, with the matching countries suggested, of which one has to be picked.
Each field says what's wrong with it once it's left, with the same rules and messages as the server (see
`checkProfile` in shared/src/artists.ts), and so does the application form (see `checkApplication`).

### Features

At `/admin/features`: the feature flags, switches that turn parts of the site on or off without deploying it again.
They're meant for going back to the old version of something, e.g. the Google Form in place of the new "Appliquer"
form if it has a problem.

The section lists every flag, each with a switch, its name, what it does, and which admin last switched it, and when.
Each switch is saved right away, and visitors get the change as soon as they load a page of the site. A page they
already have open stays as it was until they load it again. While there are no flags, the section says so.

Every flag is off until an admin turns it on, so that a flag can be deployed without changing anything until then. A
page that depends on a flag shows nothing until it knows whether the flag is on, rather than switching from one version
to the other in front of the visitor. When it can't know, it behaves as if the flag were off. For that reason, "off"
always has to be the safe option: the old version, or the one that relies the least on our own server.

The flags are listed in `FEATURES`, in shared/src/features.ts, and named in `FEATURE_LABELS`, in
client/src/pages/admin/describe.ts. Retiring a flag only takes removing it from both.
