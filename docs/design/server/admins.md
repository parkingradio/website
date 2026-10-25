# Admins

The admins are who can access the admin pages.

## Roles

Every admin can do everything: there are no roles. There's no admin to begin with: the first admin of a deployment is
created with `tools/create-admin` (see [deployment.md](../../deployment.md#creating-admins)), which also gives an admin
who forgot their password a link to choose a new one.

## Invites

Admins invite others by email. The invite links to the client's `/accept-invite?token=<token>` page (see
[Accepting an invite](../client/admin/admins.md#accepting-an-invite)), which sets the admin's password with
`POST /api/auth/accept-invite`. An invite lasts 24 hours and can only be used once. Inviting an address again replaces
its earlier invite. Invites can't be sent when `MAIL_DOMAIN` isn't set (see [Conventions](README.md#conventions)).

## Sessions

Logging in sets a `session` cookie (`session-<port>` in development, with the server's port, see "Several checkouts" in
the [README](../../../README.md#several-checkouts)): a JWT signed by the server, HTTP-only, `SameSite=Lax`, `Secure` in
production, which lasts 7 days. A session also ends when its admin is revoked, or chooses a new password. Since
`SameSite=Lax` still lets pages on other subdomains send the cookie, admin requests other than `GET` that come from
another origin are refused (see [Conventions](README.md#conventions)).

## `POST /api/auth/login`

| Request field | Type | |
|---|---|---|
| `email` | string | Matched whatever its case |
| `password` | string | |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `email` | string | The admin's email, as it was invited |

Sets the session cookie. Fails with 400 (missing fields), 401 (wrong email or password, or an invite that wasn't
accepted yet) or 429: each client gets 10 attempts per 15 minutes.

## `POST /api/auth/logout`

Takes no body. Clears the session cookie, and responds `{"ok": true}`. There's nothing to revoke on the server: the
session is only in the cookie.

## `POST /api/auth/accept-invite`

| Request field | Type | |
|---|---|---|
| `token` | string | From the link the invite emailed |
| `password` | string | At least 8 characters |

Sets the password of the admin `token` invites, and responds `{"ok": true}`. The invite can't be used again, and the
admin's sessions end, e.g. when the invite resets their password. Fails with 400: missing fields, a password that's too
short, or an invalid or expired invite.

## `GET /api/admin/me` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `email` | string | The logged-in admin's email |

Tells whether there's a session, and whose.

## `POST /api/admin/invite` (admin)

| Request field | Type | |
|---|---|---|
| `email` | string | Who to invite |

Emails an invite to `email` (see [Invites](#invites)), and responds `{"ok": true}`. Fails with 400 (missing email), 409
(already an admin who accepted their invite) or 500 (the server isn't set up to send email). An email that fails to send
is only logged.

## `GET /api/admin/admins` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
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

Revokes the admin, and responds `{"ok": true}`: they can't log in anymore, and their sessions end. For an admin who
hasn't accepted their invite, this cancels it. Fails with 404 (no such admin) or 409 (the admin who asks).
