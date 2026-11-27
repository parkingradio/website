# Admins

The admins are who can access the admin pages.

## Roles

Every admin can do everything: there are no roles. There's no admin to begin with: the first admin of a deployment is
created with `tools/create-admin` (see [deployment.md](../../deployment.md#creating-admins)), which also gives an admin
who forgot their password a link to choose a new one.

## Invites

Admins invite others by email. The invite links to the client's `/accept-invite?token=<token>` page (see
[Accepting an invite](../client/admin/admins.md#accepting-an-invite)), which sets the admin's password with
`POST /api/auth/accept-invite`. An invite lasts 24 hours and can only be used once. Inviting an address again, whatever
its case, replaces its earlier invite, but keeps the address as it was first invited, and when and by whom. Invites
can't be sent when `MAIL_DOMAIN` isn't set (see [Conventions](README.md#conventions)).

## Sessions

Logging in sets a `session` cookie (`session-<port>` in development, with the server's port, see "Several checkouts" in
the [README](../../../README.md#several-checkouts)): a JWT signed by the server, HTTP-only, `SameSite=Lax`, `Secure` in
production. A session lasts 7 days from when its cookie was last set, and 30 days from logging in at most. Any admin
request that isn't refused, whatever its response, gets a new cookie for the same session once its own is more than a
day old, e.g. [`GET /api/admin/me`](#get-apiadminme-admin) when an admin page opens. The new cookie lasts 7 days from
then, or until those 30 days are up if that's sooner. A session also ends when its admin is revoked, or chooses a new
password. Since `SameSite=Lax` still lets pages on other subdomains send the cookie, admin requests other than `GET`
that come from another origin are refused (see [Conventions](README.md#conventions)).

Admins can also connect apps, e.g. Claude, which then act as them through the MCP server, with tokens rather than the
cookie (see [OAuth](oauth.md)). Their connections end along with their sessions, when they're revoked or choose a new
password, but not when they log out.

Their calendar apps read their calendars with the token in their links (see [Admins' calendars](admin-calendars.md)),
which stop working when they're revoked, but not when they choose a new password, or log out.

The tokens with which the bookmarklet publishes sessions' events on RA, which last an hour, end along with their
sessions, when they're revoked or choose a new password, but not when they log out (see
[Publishing on RA](ra-publication.md)).

## `POST /api/auth/login`

| Request field | Type | |
|---|---|---|
| `email` | string | Matched whatever its case |
| `password` | string | |
| `turnstileToken` | string | The token Turnstile gave the page (see Turnstile, in [Conventions](README.md#conventions)) |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `email` | string | The admin's email, as it was invited |

Sets the session cookie. Each client gets 10 attempts per 15 minutes, whatever they fail with. The server only sends the
token to Cloudflare once the fields are valid, and only looks at the email and the password once Cloudflare has
accepted the token. So the token may be used up after any failure other than a 400 for the fields, a 413 or a 429: the
caller gets a new one after any failure. How long a 401 takes doesn't tell whether the email is an admin's, nor whether
that admin has chosen a password yet.

Fails with 400 (missing fields, or Turnstile refused the token), 401 (wrong email or password, or an invite that wasn't
accepted yet), 429 (too many attempts) or 502 (Cloudflare couldn't be reached, or couldn't check the token).

## `POST /api/auth/logout`

Takes no body. Clears the session cookie, and responds `{"ok": true}`. There's nothing to revoke on the server: the
session is only in the cookie. The admin's connections stay (see [Sessions](#sessions)).

## `POST /api/auth/accept-invite`

| Request field | Type | |
|---|---|---|
| `token` | string | From the link the invite emailed |
| `password` | string | At least 8 characters |

Sets the password of the admin `token` invites, and responds `{"ok": true}`. The invite can't be used again, and the
admin's sessions, connections and tokens to publish on RA end, e.g. when the invite resets their password. It also
clears the session cookie, as logging out does, so that whoever accepts it in someone else's browser, e.g. that of the
admin who sent the invite, then logs in as themselves; that admin stays logged in in other browsers. Fails with 400,
which changes nothing: missing fields, a password that's too short, or an invalid or expired invite.

## `GET /api/admin/me` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `email` | string | The logged-in admin's email |

Tells whether there's a session, and whose.

## `POST /api/admin/invite` (admin)

| Request field | Type | |
|---|---|---|
| `email` | string | Who to invite: an email address like an artist's (see [Profiles](artists.md#profiles)), up to 200 characters. It's trimmed |

Emails an invite to `email` (see [Invites](#invites)), and responds `{"ok": true}`. Fails with 400 (an `email` that
isn't such an address), 409 (already an admin who accepted their invite) or 500 (the server isn't set up to send email).
An email that fails to send is only logged.

## `GET /api/admin/admins` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many admins `admins` has (see [Conventions](README.md#conventions)) |
| `admins` | list of admins | By email |

An admin has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `email` | string | |
| `status` | `"active"`, `"invited"` or `"expired"` | Active once they've chosen their password, and until then, invited while their invite lasts |
| `inviteExpiresAt` | string or null | When their invite expires, while they're invited |
| `invitedBy` | string or null | The email of the admin who invited them. Null when they were created with `tools/create-admin`, or before that was known |
| `createdAt` | string | When they were invited |
| `you` | boolean | Whether this is the admin who asks |

## `DELETE /api/admin/admins/:id` (admin)

Revokes the admin, and responds `{"ok": true}`: they can't log in anymore, their sessions, connections and tokens to
publish on RA end (see [Publishing on RA](ra-publication.md)), and the links of their calendars stop working (see
[Admins' calendars](admin-calendars.md)). For an admin who hasn't accepted their invite, this cancels it. Fails with 404
(no such admin) or 409 (the admin who asks).
