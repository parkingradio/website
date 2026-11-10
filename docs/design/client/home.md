# Home

This page is the radio's home page. From top to bottom, it shows the pieces below. Apart from the rotation banner, they
used to be a single custom-built widget (a static HTML/JS page hosted externally, on Cloudflare R2, embedded as an
iframe), and still look as they did then.

- **Rotation banner**: lists the artists of the radio's rotation (see [Radio](../server/radio.md)), from the set on air
  and once per set, scrolling from right to left in a loop. The rotation is read each time the page is shown. The
  banner's band shows, empty, while it's read, and goes away if the radio is off air.
- **Video widget**: shows the video the site shows now, which the server decides (see [Video](../server/video.md)),
  asking for it each time the page is shown, then again a minute after each answer: a clickable thumbnail of the video
  (click-to-play, not autoplay), or a "Hors direct" placeholder when there's no video to show. When the server says
  another video, or none, the widget shows that instead, even if that stops the one being watched, so that it always
  shows what loading the page again would. When the server can't say, it keeps what it shows, or shows "Hors direct" if
  it has nothing to show yet: visitors never see an error.
- **Discord chat**: an embedded WidgetBot widget showing a specific text channel from Parking Radio's Discord
  server, letting visitors follow and join the conversation without leaving the site.

The radio (see [Player](player.md)) and the video widget never play at once: playing the video pauses the radio, and
the radio starting to play stops the video, which goes back to its cover.

## Endpoints

- `GET /api/radio`, for the rotation banner.
- `GET /api/video`, for the video widget.
