# Rotation radio

At `/admin/rotation`: chooses the SoundCloud playlist the radio's rotation is read from (see
[Radio](../../server/radio.md)). From top to bottom, it shows:

- "À l'antenne": the playlist the rotation is read from.
- "Changer de playlist": a field for the link to another playlist.

Until the credentials of the SoundCloud app have been entered, a line at the top says that the radio can't read any
playlist until then, and links to [Configuration](configuration.md), where they're entered.

## À l'antenne

The chosen playlist's title (linking to it), whether it's private or public, the SoundCloud account it belongs to, and
which admin chose it and when. Until a playlist has been chosen, it says that the radio is off air ("hors ondes").
When the playlist couldn't be read, it says why, and that the radio goes on with what it read before, if anything.
When what's on air can't be loaded, it says that the radio is off air, and why.

Under that, the playlist's tracks are listed in the order they come on air: from the one on air, marked "en cours",
around the playlist and back. Each track of the rotation shows when it begins, with the day whenever it changes. The
tracks left out of the rotation stand out, and say why. Only the first tracks are listed at first, and "afficher plus"
lists more.

## Changer de playlist

A link that isn't to a playlist is refused. "prévisualiser" shows the playlist as the radio would read it, its tracks
listed from the first, and says that the radio will go to its start right away, without cutting off listeners (see
[`POST /api/admin/radio/playlist`](../../server/radio.md#post-apiadminradioplaylist-admin)), then "jouer cette playlist"
chooses it. Only the playlist previewed can be chosen, and not one with no track that can be played in full.
Once it's chosen, the page says that the radio plays it, and shows it in "À l'antenne".

## Endpoints

- `GET /api/admin/radio`, for the chosen playlist and whether the credentials have been entered.
- `GET /api/radio?upcoming=0`, for the track on air.
- `POST /api/admin/radio/preview`, to show another playlist before choosing it.
- `POST /api/admin/radio/playlist`, to choose it.
