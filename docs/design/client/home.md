# Home

This page is the radio's home page. From top to bottom, it shows the pieces below. Apart from the rotation banner, they
used to be a single custom-built widget (a static HTML/JS page hosted externally, on Cloudflare R2, embedded as an
iframe), and still look and behave as they did then.

- **Radio player**: only while the `nouveau-lecteur` feature flag is off (see [Player](player.md)), and once the page
  knows that it is. It's not a real live audio stream, but a simulated 24/7 rotation. It's driven by a playlist
  manifest (an ordered list of tracks, each with a name, date and audio URL) and the tracks' durations, which are
  kept on that R2 bucket, outside of this app (see [deployment.md](../../deployment.md#the-legacy-radios-r2-bucket)).
  It computes "what's playing now" as `elapsed-time-since-epoch modulo total-playlist-duration`, so all listeners hear
  the same track at the same position at any given moment, like a real broadcast. A play/pause control, a live
  indicator, a progress bar, and the current track's name/date are shown in a bar at the top. A scrolling
  marquee underneath lists all track names in the rotation. A "Schedule" dropdown shows the full rotation as
  a table (start time, artist, date, duration), with the on-air track highlighted; clicking a row plays that
  track on demand (with seeking) instead of the live rotation, and a "Live" button jumps back to the
  synced rotation.
- **Rotation banner**: in the radio player's place, while the `nouveau-lecteur` feature flag is on, and once the page
  knows that it is. It lists the artists of the radio's rotation (see [Radio](../server/radio.md)), from the set on air
  and once per set, scrolling like the radio player's marquee. The rotation is read each time the page is shown. The
  banner's band shows, empty, while it's read, and goes away if the radio is off air.
- **Video widget**: shows Parking Radio's YouTube channel: a clickable thumbnail of the channel's most recent upload
  (click-to-play, not autoplay), or a "Hors direct" placeholder if there's no video at all. It's meant to embed the
  live stream while the channel is live, but doesn't detect it yet.
- **Discord chat**: an embedded WidgetBot widget showing a specific text channel from Parking Radio's Discord
  server, letting visitors follow and join the conversation without leaving the site.

Playback of the radio, from either player, and the video widget is mutually exclusive: starting one pauses the other,
so visitors aren't listening to two audio sources at once.

## Endpoints

- `GET /api/radio`, for the rotation banner.
