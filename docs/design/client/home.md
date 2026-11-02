# Home

This page is the radio's home page. From top to bottom, it shows the pieces below. Apart from the rotation banner, they
used to be a single custom-built widget (a static HTML/JS page hosted externally, on Cloudflare R2, embedded as an
iframe), and still look and behave as they did then.

- **Rotation banner**: lists the artists of the radio's rotation (see [Radio](../server/radio.md)), from the set on air
  and once per set, scrolling from right to left in a loop. The rotation is read each time the page is shown. The
  banner's band shows, empty, while it's read, and goes away if the radio is off air.
- **Video widget**: shows Parking Radio's YouTube channel: a clickable thumbnail of the channel's most recent upload
  (click-to-play, not autoplay), or a "Hors direct" placeholder if there's no video at all. It's meant to embed the
  live stream while the channel is live, but doesn't detect it yet.
- **Discord chat**: an embedded WidgetBot widget showing a specific text channel from Parking Radio's Discord
  server, letting visitors follow and join the conversation without leaving the site.

The radio (see [Player](player.md)) and the video widget never play at once: starting one pauses the other.

## Endpoints

- `GET /api/radio`, for the rotation banner.
