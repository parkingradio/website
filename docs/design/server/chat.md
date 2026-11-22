# Chat

The chat on [Home](../client/home.md) is the #chat channel of Parking Radio's Discord server, where its members, the
viewers of Parking Radio's YouTube live streams and the site's visitors talk together. The chat happens on Discord: the
server follows the channel through a Discord bot of its own, keeps its latest messages in memory, and sends them to
pages as they're written, edited and deleted. Visitors write as guests, without a Discord account, and the server posts
their messages in the channel through a webhook. Nothing from the channel is kept in the database.

parking.relay, a program outside the site, copies the chat of Parking Radio's YouTube live streams into the channel,
through a bot of its own, and the channel's messages to YouTube.

## Discord

The server connects to Discord with its bot's token, and follows one channel, both entered on the admin pages (see
[The Discord credentials](#the-discord-credentials)). Until they're entered, the chat isn't set up: the endpoints under
`/api/chat` fail with 503, and the rest of the site works as usual. Creating the bot on Discord, and the permissions it
needs, are in [deployment.md](../../deployment.md#discord).

The server follows the channel's new, edited and deleted messages, and keeps the latest 50 of those that show (see
[Messages](#messages)) in memory:

- When it connects to Discord without picking up where it left off, e.g. when it starts, and after a bulk delete, it
  reads the channel's latest 100 messages, and keeps the latest 50 of those that show. Pages then get them as a
  snapshot (see [`GET /api/chat/stream`](#get-apichatstream)). Reading them after a bulk delete keeps a purge from
  emptying the chat while older messages remain.
- A new message is added after the others, and the oldest is dropped when there are more than 50.
- An edited message is replaced, or removed when it doesn't show anymore. Edits of messages it doesn't keep are ignored.
- A deleted message is removed, without reading the channel again: there are fewer than 50 until new ones come.

While Discord can't be reached, pages keep what they have. When the channel can't be found, or the bot can't read it,
the server tries again every minute, so that fixing the bot's permissions on Discord is enough. When Discord refuses the
token, or the bot doesn't have the Message Content intent, it waits until new credentials are saved. Either way, admins
see why in the credentials' `error`.

In development and in tests, `CHAT_STAND_IN` has the server use a stand-in for Discord instead (see "The chat" in the
[README](../../../README.md#the-chat)): a channel that starts with a few messages of every kind, and where guests'
messages are posted. The chat then works without credentials, and the stand-in accepts any.

## Messages

A message shows on the site when it's an ordinary message or a reply, with text, attachments, or both. Discord's own
messages, e.g. that someone joined, don't show, and neither do messages without text or attachments, e.g. only a
sticker, an embed or a poll. A reply shows like any other message, without what it replies to. Attachments are only
counted, since Discord's links to them expire.

Each message is one of four kinds, by who sent it:

| `kind` | Sent by | `author` |
|---|---|---|
| `"guest"` | A webhook whose name ends with ` (invité·e)`, the way the server posts guests' messages (see [Guests](#guests)). Only Discord's moderators can create webhooks, so the public can't pass for a guest | The name before ` (invité·e)` |
| `"youtube"` | parking.relay's account (its `relayUserId`, see [The Discord credentials](#the-discord-credentials)), with the text `**[YouTube] <name>** : <text>`, the way it copies a YouTube viewer's message. The name ends at the first `** : `, since parking.relay doesn't escape it. The message's text is `<text>` | `<name>`, the viewer's name on YouTube, e.g. `"@viewer"` |
| `"bot"` | Any other bot or webhook, e.g. parking.relay's messages about a live stream starting or ending | Its name |
| `"member"` | Anyone else | Their nickname on the server, or else their display name, or else their username, whether the server got the message as it was sent, or read it from the channel. Discord only gives nicknames with messages as they're sent, so the server looks up the members of the messages it reads |

A message has:

| Field | Type | |
|---|---|---|
| `id` | string | Its id on Discord |
| `kind` | string | See above |
| `author` | string | See above |
| `sentAt` | string | When it was sent |
| `content` | list of runs | Its text (see [Text](#text)). Empty when it only has attachments |
| `attachments` | number | How many files are attached to it on Discord, which the site doesn't show |

### Text

The server reads a message's text, and gives it as runs, which pages show one after the other, so that they don't need
to know Discord's syntax:

| `type` | Fields | |
|---|---|---|
| `"text"` | `text` | Text, with its line breaks |
| `"code"` | `text` | Inline code |
| `"link"` | `url` | A link, which shows as its address |
| `"emoji"` | `name`, `url` | A custom emoji of Discord's: its image, or `:name:` when it can't show |

Each run can also have `bold`, `italic` and `strikethrough`, set to `true` when it's in that style.

- Only bold (`**`), italics (`*` or `_`), strikethrough (`~~`), inline code (`` ` ``) and links are read. The rest shows
  as written, e.g. underline, spoilers, whose content then shows, quotes, headings, lists, code blocks, timestamps and
  masked links (`[text](address)`), and so do markers that aren't closed, or that Discord wouldn't read. A backslash
  before a character that isn't a letter, a digit or a space shows that character as written, without the backslash,
  as on Discord.
- A link is an address that starts with `http://` or `https://`, as Discord reads them, e.g. without the comma or the
  period after it, or one between `<` and `>`, which shows without them. Markdown doesn't apply inside it. A link's
  `url` is always exactly the address it shows: in a masked link, the address is a link like any other, and the text
  before it shows as written. So the site never shows a link under other text.
- Mentions are written out as names: `@` and a member's name, as for `author`, or a role's, and `#` and a channel's.
  `@everyone` and `@here` are text. A mention whose name Discord doesn't give shows as `@inconnu` or `#inconnu`.
- Unicode emojis are text. A custom emoji's `url` is its image on Discord's CDN, which the server makes from the
  emoji's id, never from the text: `https://cdn.discordapp.com/emojis/<id>...`, animated for an animated one. YouTube's
  emojis come from parking.relay as text, e.g. `:face-fuchsia-wide-eyes:`, and stay text.

## `GET /api/chat/stream`

The chat's messages as they're written, edited and deleted, as server-sent events (`text/event-stream`), which pages
read with `EventSource`. It isn't JSON, unless it fails (see [Conventions](README.md#conventions)). Each event has a
name, `event`, and JSON in its `data`:

| `event` | `data` | |
|---|---|---|
| `snapshot` | `{"messages": [...]}` | Every message to show, the oldest first. It's the first event, once the server has read the channel, and comes again whenever the server reads it again (see [Discord](#discord)): pages replace what they show with it |
| `message` | `{"message": {...}}` | A new message, which comes after the others, or an edited one, which replaces the one with its `id`. Pages then keep the latest 50, like the server |
| `delete` | `{"ids": [...]}` | Messages that were deleted, e.g. by a moderator, or that don't show anymore |

The events have no `id`, so a page that connects again, e.g. after losing its connection, always starts with a
snapshot. The server answers right away, even before it has read the channel, e.g. when it just started: the snapshot
comes once it has. When it can't follow the channel, though (see `error`, in
[The Discord credentials](#the-discord-credentials)), and hasn't read it since it started, or since the credentials were
saved, the stream fails, so that pages say the chat is offline, and try again. Pages that already have it keep what they
have. It sends a comment line every 25 seconds, so that nginx and Cloudflare keep quiet streams open. The
stream is never cached (`Cache-Control: no-store`), nginx doesn't buffer it, and the server closes it when it stops.

The server sends at most 2000 streams at once, and 20 to each client (see
[Rate limits, in Conventions](README.md#conventions)), which leaves room for people who share an address, e.g. at the
studio. Its errors are in English, since pages don't show them:

| Status | When |
|---|---|
| 429 | The client already has 20 streams |
| 503 | The chat isn't set up, the server can't follow the channel (see above), or 2000 streams are already open |

## Guests

Visitors write in the chat as guests, without a Discord account. A visitor enters the chat by choosing a name, with
[`POST /api/chat/guest`](#post-apichatguest), which checks with Cloudflare Turnstile that they're a person, like applying
does (see [Applying](applications.md#applying)). Since Turnstile only accepts each token once, only entering needs one,
not each message.

The server then sets a `chat-guest` cookie (`chat-guest-<port>` in development, like an admin's
[session](admins.md#sessions)), with a random id for the guest, and their name: nothing about guests is kept on the
server. It's a token signed by the server, which can't be used as an admin's session, nor a session as a guest's. It's
HTTP-only, only sent to `/api/chat`, `SameSite=Lax`, `Secure` in production, and lasts 400 days, the most browsers keep
a cookie, from the last request that sent it: every request that sends a valid one gets it again. So guests keep their
name until they clear their cookies. Choosing another name keeps the guest's id. Since pages can't read the cookie, they
ask who the visitor is with [`GET /api/chat/guest`](#get-apichatguest).

Names and messages are counted in UTF-16 code units, e.g. 2 for most emojis, which is never fewer than YouTube counts
(see below).

A guest's name is trimmed, with each run of spaces made a single space, and has 1 to 32 characters. It can't contain
`@`, `#`, `:`, three backticks, `discord` or `clyde`, whatever their case, which Discord refuses in a webhook's name, nor
a line break, nor control or format characters, e.g. zero-width spaces or the characters that reverse text, which can
make a name look like another one, except for the zero-width joiner and tag characters, which emojis like 👩‍💻 and
flags use.

A guest's message is trimmed, can't have a line break, and has 1 to 140 characters, so that parking.relay can copy it
to YouTube's live chat, which takes at most 200 characters per message, with its prefix,
`[Discord] <name> (invité·e) : `, of up to 56.

The server posts guests' messages through a webhook that its bot creates in the channel, under `<name> (invité·e)`, so
that Discord's members can tell guests apart. A message mentions nobody, even with `@everyone`, its links get no
preview, and its text is escaped, so that Discord shows it exactly as it was typed: a backslash goes before every
character that Discord would otherwise read, i.e. `*`, `_`, `~`, `|`, `` ` ``, `\`, `<`, which starts mentions,
timestamps and custom emojis, `[`, which starts masked links, and at the start of the text, `#`, `>`, `-`, and the `.`
of a number followed by one, e.g. `1\.`, which start headings, quotes and lists. Links, as the server reads them (see
[Text](#text)), are left as they are. The message then comes back through the stream like any other, where it shows
as it was typed.

The bot reuses the webhook it created before, and only creates one when the channel has none of its own, or when Discord
says the one it used doesn't exist anymore, e.g. because a moderator deleted it, and then posts the message once more: a
channel can only have 15 webhooks. The webhook's address, which holds its token, is a secret like the bot's token, since
it lets anyone post in the channel: neither ever appears in the logs, in an error or in a response.

Guests' names and messages, and messages' text in general, are never logged, and neither are the values in Discord's
errors.

**Limits.** Each client can enter the chat 30 times per hour, requests that fail included. Each guest can send 6
messages per minute, each client 15, and all guests together 25, which stays under Discord's limits for webhooks. When
Discord refuses a message for its limits anyway, the request fails right away with 429, rather than waiting. Discord's
slowmode doesn't apply to webhooks, so these are the only limits on guests.

**Moderation.** Moderators delete guests' messages on Discord, like any other, and they disappear from the site.
Admins can also stop guests from writing at any time (see [`PUT /api/admin/chat/guests`](#put-apiadminchatguests-admin)).
Guests can't write until an admin lets them.

`POST /api/chat/guest` and `POST /api/chat/messages` fail with 403 when a browser says they come from another origin, like
admin requests (see [Conventions](README.md#conventions)), so that other sites can't post as a visitor. Their errors are
in French, since pages show them.

## `GET /api/chat/guest`

Who the visitor is in the chat.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `guest` | object or null | The guest, with their `name`, or null when the visitor hasn't entered the chat, or their cookie isn't valid |
| `canWrite` | boolean | Whether guests can write (see [Moderation](#guests)) |

Fails with 503 when the chat isn't set up.

## `POST /api/chat/guest`

Enters the chat, or chooses another name (see [Guests](#guests)).

| Request field | Type | |
|---|---|---|
| `name` | string | The guest's name |
| `turnstileToken` | string | The token Turnstile gave the page |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `guest` | object | The guest, with their `name` as it was saved |

Sets the cookie. The name is checked before the token is sent to Cloudflare, so that after an error about the name, the
page can send the same token again (see [When the page needs a new token](applications.md#applying)).

| Status | When |
|---|---|
| 400 | The name isn't valid, or Turnstile refused the token |
| 403 | Guests can't write, or the request comes from another origin |
| 429 | The client entered the chat too many times |
| 502 | Cloudflare couldn't be reached, or couldn't check the token |
| 503 | The chat isn't set up |

## `POST /api/chat/messages`

A guest writes in the chat (see [Guests](#guests)).

| Request field | Type | |
|---|---|---|
| `text` | string | The message |

Posts the message in the channel, and once Discord has accepted it, responds `{"ok": true}`. The message then comes
through [`GET /api/chat/stream`](#get-apichatstream).

| Status | When |
|---|---|
| 400 | The text isn't valid |
| 401 | The visitor hasn't entered the chat, or their cookie isn't valid: they have to enter it again |
| 403 | Guests can't write, or the request comes from another origin |
| 429 | Over one of the limits, or Discord's (see [Limits](#guests)) |
| 502 | Discord refused the message, or couldn't be reached |
| 503 | The chat isn't set up |

## The Discord credentials

The bot's token, the id of the channel it follows, and the id of parking.relay's account, which are entered on the
admin pages. Without parking.relay's id, no message is a YouTube viewer's. They're kept in the database. The token
is never sent back once it's entered: it can only be replaced. It never appears in the logs, or in any error.

The server checks them with Discord before it saves them: Discord has to accept the token, the bot has to have the
Message Content intent, and in the channel, the permissions to read its messages and to manage its webhooks (see
[deployment.md](../../deployment.md#discord)). Saving them makes the server drop its connection to Discord, the
messages it keeps and its webhook, clear `error`, and connect again with them: pages get the new channel's messages as
a snapshot, once it's read.

Their `error` is why the server can't follow the channel, when it can't, or else why the last guest's message failed on
the server's side, when it did, e.g. because the bot can't create its webhook without the Manage Webhooks permission.
Each one clears when the server next succeeds at it: following the channel, or posting a guest's message. Messages
refused for their text, or for the limits, don't count. It's only kept in memory, so it's null after the server
restarts, until something fails.

## `GET /api/admin/chat/credentials` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `standIn` | boolean | Whether the server uses the stand-in for Discord (see [Discord](#discord)), with which the chat works whatever the credentials |
| `credentials` | object or null | The `channelId`, the `relayUserId`, or null when there's none, who last changed the credentials (`updatedBy`, an admin's email) and when (`updatedAt`), and `error` (see [The Discord credentials](#the-discord-credentials)). Null until they're entered: until then, the chat isn't set up |

## `PUT /api/admin/chat/credentials` (admin)

| Request field | Type | |
|---|---|---|
| `botToken` | string | The bot's token, up to 200 characters. Trimmed |
| `channelId` | string | The channel's id on Discord: up to 20 digits. Trimmed |
| `relayUserId` | string or null | The id of parking.relay's account, like `channelId`, or null or a blank string for none |

Checks the credentials with Discord (see [The Discord credentials](#the-discord-credentials)), and only if they pass,
saves them, connects with them, and responds like `GET /api/admin/chat/credentials`. Fails with 400 (one of them is
blank, too long or not in its format, Discord refuses the token, the bot doesn't have the Message Content intent, or it
can't read the channel or manage its webhooks, e.g. because it doesn't exist, isn't a text channel, or the bot doesn't
have the permissions, saying which) or 502 (Discord can't be reached).

## `POST /api/admin/chat/credentials/check` (admin)

Takes the same request as `PUT /api/admin/chat/credentials`, and checks the credentials the same way, but doesn't save
them: it responds `{"ok": true}` when they pass, and fails like `PUT` otherwise.
This lets credentials be verified before they're saved.

## `GET /api/admin/chat/guests` (admin)

Whether guests can write in the chat (see [Moderation](#guests)).

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `canWrite` | boolean | Whether guests can write. `false` until an admin lets them |
| `updatedBy`, `updatedAt` | string or null | Who last changed it (an admin's email), and when |

## `PUT /api/admin/chat/guests` (admin)

| Request field | Type | |
|---|---|---|
| `canWrite` | boolean | Whether guests can write |

Changes whether guests can write, which takes effect right away, and responds like `GET /api/admin/chat/guests`. It can
be changed even when the chat isn't set up. Fails with 400 if `canWrite` isn't a boolean.
