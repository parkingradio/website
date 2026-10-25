# Rotation radio

At `/admin/rotation`: chooses the SoundCloud playlist the radio's rotation is read from (see
[Radio](../../server/radio.md)). From top to bottom, it shows:

- "À l'antenne": the playlist the rotation is read from.
- "Changer de playlist": a field for the link to another playlist.

Until the credentials of the SoundCloud app have been entered, a line at the top says that the radio can't read any
playlist until then, and links to [Configuration](configuration.md), where they're entered.

## Endpoints

- `GET /api/admin/radio`, for the chosen playlist and whether the credentials have been entered.
- `GET /api/radio?upcoming=0`, for the track on air.
- `POST /api/admin/radio/preview`, to show another playlist before choosing it.
- `POST /api/admin/radio/playlist`, to choose it.
