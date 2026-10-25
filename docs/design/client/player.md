# Player

All pages share a single audio player, a black bar fixed at the bottom of the screen, which plays the radio (see
[Radio](../server/radio.md)). Since the app is a single-page application, it keeps playing while visitors move from
page to page. The radio is called "en ondes" everywhere on the site.

Until the `nouveau-lecteur` feature flag is turned on (see [Feature flags](architecture.md#feature-flags)), there's no
player: neither the bar nor the navigation bar's button. The main page has a player of its own instead (see
[Home](home.md)), which plays its own rotation, and which the shared player replaces while the flag is on: it comes back
if the flag is turned off.

## Playing the radio

The player plays what's on air, at the same position as every other listener: the sets of the rotation can't be played
on their own, from their start. The radio can be paused and played again from the player or from the system's own
controls (e.g. its media keys, or AirPods taken out and put back in), which show the artist: playing it again joins
the radio where it's at by then, rather than where it was paused. When the set it plays ends, it goes on with the one
on air by then. It sticks with the set it's playing until it ends, even if another one is on air by then, e.g. because
another playlist was chosen (see [The rotation](../server/radio.md#the-rotation)).

The sets are streamed from SoundCloud, in HLS. Browsers that can't play HLS themselves (e.g. Firefox) play it through a
library, which only they load. When a stream stops working, e.g. because its address expired, the player asks for it
again and picks up where the radio is at. If that keeps failing, or if the browser refuses to play, the player stops.

The radio is off air when the player can't know what's on air, e.g. because no playlist has been chosen yet or
SoundCloud can't be reached. The bar then doesn't show, and the navigation bar's button reads "hors ondes" and can't be
clicked, unless a set is still playing, which the player finishes. Once the radio is back on air, the player notices
within a minute.

## The bar

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

## Navigation bar button

The navigation bar has an "● en ondes · artiste" button, showing who's on air (in lowercase, like the rest of the
navigation bar), which plays or pauses the radio from any page. Where the navigation bar is short of room for it,
between the width at which its links fit on one line and the width at which the whole button fits too, it's only the
red dot (still named in full for screen readers). On phones, it only shows "● en ondes".

## Endpoints

- `GET /api/radio?upcoming=0`, for what's on air.
- `GET /api/radio/tracks/:id/stream`, for where to play it from.
