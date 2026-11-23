# Chat

The chat is the #chat channel of Parking Radio's Discord server, where its members talk. The server reaches Discord
through a bot of its own, whose token and channel are entered on the admin pages (see
[The Discord credentials](#the-discord-credentials)). They're only checked and kept: the server doesn't connect to
Discord with them, and [Home](../client/home.md) shows the chat through WidgetBot.

Creating the bot on Discord, and giving it what it needs, are in [deployment.md](../../deployment.md#discord).

In development and in tests, `CHAT_STAND_IN` has the server use a stand-in for Discord instead, so that nothing reaches
it (see "The chat" in the [README](../../../README.md#the-chat)): it accepts any credentials in the right format.

## The Discord credentials

The bot's token, and the id of the channel it reaches, which are kept in the database rather than set when the site is
deployed, so that they can be changed without deploying it again. The token is made only of letters, digits, `.`, `_`
and `-`, as Discord's tokens are: one in any other form, e.g. with a line break pasted into it, is refused without being
sent anywhere. The token is never sent back once it's entered: it can only be replaced. It never appears in the logs, or
in any error.

The server checks them with Discord before it saves them, so that a typo, or a bot set up wrong, is caught then:

- Discord has to accept the token.
- The bot has to have the Message Content intent, which lets it read messages' text.
- The channel has to be a text channel that the bot can see.
- The bot has to have, in the channel, the View Channel and Read Message History permissions, to read its messages, and
  Manage Webhooks, to post messages in it under other names than its own. Discord works them out from the bot's roles
  and the channel's permissions, and a bot with the Administrator permission has them all.

The bot's username and the channel's name, as Discord gives them then, are kept with them, so that admins can tell which bot
and channel they are, e.g. a test deployment's rather than production's. They aren't updated when they change on
Discord.

## `GET /api/admin/chat/discord` (admin)

The Discord bot the server reaches the chat through, and its channel (see
[The Discord credentials](#the-discord-credentials)).

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `credentials` | object or null | The `channelId`, the bot's username and the channel's name (`botName`, and `channelName`, without `#`), who last changed the credentials (`updatedBy`, an admin's email) and when (`updatedAt`). Null until they're entered |

## `PUT /api/admin/chat/discord` (admin)

| Request field | Type | |
|---|---|---|
| `botToken` | string | The bot's token: up to 200 letters, digits, `.`, `_` or `-`, which Discord's tokens are made of. Trimmed |
| `channelId` | string | The channel's id on Discord: up to 20 digits. Trimmed |

Checks the credentials with Discord (see [The Discord credentials](#the-discord-credentials)), and only if they pass,
saves them, and responds like `GET /api/admin/chat/discord`. Fails with 400 (either one is blank, too long or not in its
format, or the check fails, saying why, e.g. which permissions the bot doesn't have) or 502 (Discord can't be reached,
refuses requests for now, or answers something unexpected).

## `POST /api/admin/chat/discord/check` (admin)

Takes the same request as `PUT /api/admin/chat/discord`, and checks the credentials with Discord the same way, but
doesn't save them: it responds `{"ok": true}` when they pass, and fails like `PUT` otherwise. This lets credentials be
verified before they're saved.
