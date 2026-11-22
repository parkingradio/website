# Home

This page is the radio's home page. From top to bottom, it shows the pieces below. The video widget and WidgetBot's chat
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
- **Chat**: the #chat channel of Parking Radio's Discord server, where visitors follow the conversation, and join it as
  guests (see [Chat](#chat)), when the `nouveau-chat` feature flag is on. While it's off, an embedded WidgetBot widget
  shows the channel instead, and until the page knows, the chat's place stays empty (see
  [Feature flags](architecture.md#feature-flags)).

The radio (see [Player](player.md)) and the video widget never play at once: playing the video pauses the radio, and
the radio starting to play stops the video, which goes back to its cover.

## Chat

The chat takes WidgetBot's place, at its size, under a black bar that says "#chat". It shows the messages the server
sends (see [Chat](../server/chat.md)), the oldest at the top:

- Each one under its author's name, in bold, in one of nine colors, always the same for the same name, followed by an
  "invité·e" tag for a guest, "youtube" for a YouTube viewer, and "bot" for a bot. A message right after another one by
  the same author, of the same kind, doesn't repeat them, so that a guest can't pass for a member by taking their name.
- Its time, in Québec time, e.g. "21 h 30", after its date when it isn't today in Québec, e.g. "14 nov., 21 h 30".
- Its text, from its runs (see [Text](../server/chat.md#text)), in its styles, with its line breaks, links that show
  their address and open in a new tab, and custom emojis as images the size of the text, or `:name:` when they don't
  load. Long words and addresses wrap.

Each name and each text is isolated from the direction of the text around it, so that characters that reverse text
can't change how the rest of the chat reads.
- After its text, when it has attachments, "1 pièce jointe" or "N pièces jointes", in grey, which are only on Discord.

The list opens at its bottom, and new messages scroll it down to them, unless the visitor scrolled up to read older
ones: a "nouveaux messages ↓" button then takes them down. Until it has the messages, the chat says "connexion…", and
without any, "aucun message pour l'instant". When the messages can't be read, e.g. when the chat isn't set up, the bar
says "hors ligne", and the page tries again every 30 seconds, keeping what it shows. When the connection is lost once
it's open, the browser opens it again on its own.

### Writing

Under the messages, visitors write as guests (see [Guests](../server/chat.md#guests)). When it shows the chat, the page
asks who the visitor is, and whether guests can write:

- A wide "envoyer un message" button asks for "votre pseudo", with "ok", and ✕ to cancel. Cloudflare Turnstile checks
  that the visitor is a person, as on [Appliquer](appliquer.md), with its checkbox only shown when Cloudflare needs them
  to click it. The page only loads Turnstile then, and gets a new token after an error other than the name's.
- Once the visitor has entered the chat, "invité·e : <name>" and a "changer" link, which asks for a name again the same
  way, sit above the message field and its "envoyer" button.
- The field takes up to 140 characters, counted as the server counts them (see [Guests](../server/chat.md#guests)). It
  doesn't stop the visitor from typing or pasting more: once 20 or fewer are left, a counter says how many, in red once
  it's over, and "envoyer" can't be used until the text is shortened.
- "envoyer" can't be used while a message is being sent. Once the server has accepted it, the field empties and the list
  scrolls down: the message shows once the server sends it back.
- The page checks the name and the message as the server does, and shows the server's error under the field otherwise,
  e.g. when too many messages were sent, keeping the text. When the server says the visitor has to enter the chat again
  (401), it asks for their name.
- While guests can't write, including once the server refuses a name or a message with 403, the chat only says
  "Les invité·e·s ne peuvent pas écrire pour le moment.".

## Endpoints

- `GET /api/radio`, for the rotation banner.
- `GET /api/video`, for the video widget.
- `GET /api/chat/stream`, for the chat's messages, and `GET /api/chat/guest`, `POST /api/chat/guest` and
  `POST /api/chat/messages`, for writing in it.
