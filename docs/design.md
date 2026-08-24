# Site Design

All pages share a common navigation bar at the top, from which all pages can be reached. The web app is
a single-page application: changing to another page does not require reloading the whole app.

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

## Archives

This page lets visitors browse and listen to past diffusion sessions. It embeds the SoundCloud player widget
for the `parkingdotradio` account
(`https://w.soundcloud.com/player/?url=https://soundcloud.com/parkingdotradio&visual=false&buying=false&liking=true&download=false&sharing=true&show_comments=true&show_playcount=true&show_teaser=true&show_user=false&hide_related=true&show_reposts=true&callback=true`)
as an iframe, which lists the account's tracks (title, date, play count) and lets visitors play them directly.
SoundCloud handles playback and hosting entirely; this page is just a thin wrapper around the embed.

## Programmation

This page lists Parking Radio's upcoming events. It embeds Resident Advisor's promoter events widget for
their RA promoter profile
(`https://ra.co/promoters/183980/widget/events?theme=light&transparentBackground=true&customBackgroundColor=&customTextColor=%23000000`)
as an iframe. Resident Advisor handles the event listing entirely; this page is just a thin wrapper around
the embed. **Note**: this embed is currently broken on the live site (it fails to render), so it needs to
be fixed or replaced as part of the migration.

## Synth Meetups

TODO

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
- "Type de prestation" (*): choice between "DJ", "Performance Live", "Rap", "Full Band", "Other:" (with free form text input)
- "Adresse e-mail" (*): free form text with format validation
- "Numéro de téléphone" (*): free form text with format validation
- "Disponibilités" (*): date picker that allows selecting multiple days
- "Questions ou détails": free form text
- "Entente de collaboration" (*): a form to sign in order to submit an application

When an artist submits this form, an entry is created in the database with that form's information. The form is protected
from bots by a Cloudflare Turnstile.

## Contribuer

This page lets visitors make a donation to Parking Radio. It embeds Zeffy's donation form
(`https://www.zeffy.com/embed/donation-form/contribuer-a-parkingradio`) as an iframe, which offers a few
preset amounts as well as a free-form custom amount. Zeffy handles payment processing and the donation
flow entirely; this page is just a thin wrapper around the embed.

## Merch

This isn't a page within the app. The "merch" navbar entry is a direct external link to Parking Radio's
Bigcartel store (`https://parkingdotradio.bigcartel.com`), which handles the merch catalog, checkout, and
payment entirely on its own.

## Admin

This page requires authentication. It provides various tools to manage the project like uploading sets, managing
artist information, scheduling diffusion sessions, etc.
