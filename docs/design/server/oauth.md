# OAuth

Apps that act as an admin, e.g. Claude, through the [MCP server](mcp.md). The server is its own OAuth 2.1 authorization
server: an admin allows an app on a page of the site, once logged in (see
[Autoriser une application](../client/admin/autoriser.md)), and the app then gets tokens with which it uses the MCP
server as them. The admin pages keep using the session cookie (see [Sessions](admins.md#sessions)): tokens are only for
apps (see [Conventions](README.md#conventions)).

The site's address, e.g. `https://parking.radio`, written `<site>` below, is the one the deployment gives it, which
invites link to (see [Invites](admins.md#invites)), rather than the one requests are sent to. It's the authorization
server's issuer, and the MCP server is at `<site>/mcp`.

## Connections

A connection is an app that a user allowed to act as them. It has its user, its app (see [Clients](#clients)), its
scopes (see [Scopes](#scopes)), when it was made, and when the app last used it. A connection is made when the app
exchanges its code for tokens (see [`POST /api/oauth/token`](#post-apioauthtoken)), and connecting an app again makes
another one.

An app uses its connection with two tokens:

- An **access token**, which the MCP server takes (see [Authorization](mcp.md#authorization)), and which lasts 1 hour,
  or until the next refresh.
- A **refresh token**, which gets the app a new access token and a new refresh token, after which it can't be used
  again.

Tokens are random, so they can't be guessed, and the server doesn't keep them, only what it needs to recognize them.

A connection ends, and its tokens stop working right away, even an access token that hasn't expired:

- when its user disconnects it from the admin pages, or the app revokes it,
- when its user is revoked, or chooses a new password, like their sessions (see [Sessions](admins.md#sessions)), but
  not when they log out,
- when its refresh token goes unused for 90 days,
- when its code or a refresh token that was already used is used again, since someone else may have it. So an app
  that doesn't get the answer to a refresh, e.g. because the network failed, has to be connected again.

A code that wasn't exchanged yet also stops working when its user is revoked, or chooses a new password.

## Clients

Apps identify themselves by the address of a document that describes them (a client ID metadata document), which is
their `client_id`. Rather than fetching these documents, the server knows those of the apps it's for, and only these
apps can connect:

| `client_id` | Name | Redirect URIs |
|---|---|---|
| `https://claude.ai/oauth/mcp-oauth-client-metadata` | Claude | `https://claude.ai/api/mcp/auth_callback` |
| `https://claude.ai/oauth/claude-code-client-metadata` | Claude Code | `http://localhost/callback` and `http://127.0.0.1/callback`, on any port |
| `https://parking.radio/oauth/parkingradio-cli.json` | Parking Radio CLI | `http://localhost/callback` and `http://127.0.0.1/callback`, on any port |

Claude, on claude.ai and in its apps, connects to the MCP server from its servers. Claude Code and the Parking Radio
CLI, the `parkingradio` command-line tool of [parkingradio/tools](https://github.com/parkingradio/tools), run on the
user's computer, and listen there for the browser, on a new port each time. When an app changes its document, e.g. its
redirect URIs, this list has to change with it. Apps can't register themselves (dynamic client registration). The name
the pages show is the one of this list, not the one an app gives itself.

The Parking Radio CLI's document is a file of the site, at `/oauth/parkingradio-cli.json`. Its `client_id` is that
file's address on the production site, as a client ID metadata document's `client_id` must be. It also has the
`client_name` and the `redirect_uris` of this list, `grant_types` `authorization_code` and `refresh_token`,
`response_types` `code`, and `token_endpoint_auth_method` `none`. Every environment serves it as it is: like Claude's
and Claude Code's ids, which are always on claude.ai, the id names the app, not the site it connects to.

## Scopes

What a connection can do. There's only one scope:

| Scope | |
|---|---|
| `admin` | Everything the MCP server's tools do (see [Tools](mcp.md#tools)), as the user, who has to be an admin |

A connection gets the scopes the app asks for. By default, when it asks for none that the server knows, it gets all of
its user's scopes, which may become fewer once there are other scopes. Scopes the server doesn't know are ignored, and
connections always get a refresh token, without asking for one. Asking for a scope the user doesn't have fails with
`invalid_scope`. At each request, a connection can only do what its scopes allow and its user can still do.

## Authorizing an app

An app finds out how to connect from the MCP server's answer to a request without a token (see
[Authorization](mcp.md#authorization)), which leads to the two metadata documents below. It then sends the user's
browser to the authorization endpoint, `<site>/autoriser`, which is a page of the site (see
[Autoriser une application](../client/admin/autoriser.md)), with these parameters in its query:

| Parameter | |
|---|---|
| `response_type` | `code` |
| `client_id` | One of the [clients](#clients) |
| `redirect_uri` | One of that client's redirect URIs, exactly, except for the port of those on the user's computer |
| `code_challenge` | The PKCE challenge ([RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)) |
| `code_challenge_method` | `S256`, the only one |
| `scope` | Optional. The scopes the app asks for, separated by spaces (see [Scopes](#scopes)) |
| `state` | Optional. Given back to the app as it is |
| `resource` | Optional. The MCP server's address, `<site>/mcp` ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)), whose scheme and host can be in any case |

The browser then goes back to the app's redirect URI: with `code`, which lasts 10 minutes and can only be used once,
when the user allows the app, or else with `error` and `error_description`. Either way, it has `state`, when the app
sent it, and `iss`, the issuer ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207)).

`client_id` and `redirect_uri` are checked first: when either one is missing, there more than once, or isn't valid,
i.e. `client_id` isn't one of the clients, or `redirect_uri` isn't one of its redirect URIs, the browser isn't sent back
to the app, since it may not be the app's, and the page says what's wrong instead. The server logs a `client_id` it
doesn't know, so that a new app, or a change of Claude's, doesn't go unnoticed. Only then are the other errors sent back
to the app:

| `error` | When |
|---|---|
| `access_denied` | The user refused |
| `unsupported_response_type` | `response_type` isn't `code` |
| `invalid_request` | `code_challenge` is missing, `code_challenge_method` isn't `S256`, or a parameter is there more than once |
| `invalid_scope` | The app asks for a scope the user doesn't have |
| `invalid_target` | `resource` isn't the MCP server |

## `GET /.well-known/oauth-protected-resource/mcp`

The MCP server's metadata ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)), which also answers at
`/.well-known/oauth-protected-resource`, where some apps look for it:

| Response field | Value |
|---|---|
| `resource` | `<site>/mcp` |
| `authorization_servers` | `["<site>"]` |
| `scopes_supported` | `["admin"]` |
| `bearer_methods_supported` | `["header"]` |

## `GET /.well-known/oauth-authorization-server`

The authorization server's metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)):

| Response field | Value |
|---|---|
| `issuer` | `<site>` |
| `authorization_endpoint` | `<site>/autoriser` |
| `token_endpoint` | `<site>/api/oauth/token` |
| `revocation_endpoint` | `<site>/api/oauth/revoke` |
| `scopes_supported` | `["admin"]` |
| `response_types_supported` | `["code"]` |
| `grant_types_supported` | `["authorization_code", "refresh_token"]` |
| `code_challenge_methods_supported` | `["S256"]` |
| `token_endpoint_auth_methods_supported` | `["none"]`: apps don't authenticate, PKCE is what proves that a code is theirs |
| `revocation_endpoint_auth_methods_supported` | `["none"]` |
| `client_id_metadata_document_supported` | `true` |
| `authorization_response_iss_parameter_supported` | `true` |

## `GET /api/admin/oauth/authorization` (admin)

What allowing an app would grant, for the authorization page. Its query has the parameters of
[Authorizing an app](#authorizing-an-app).

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `client` | string | The app's name (see [Clients](#clients)), e.g. `"Claude"` |
| `redirectHost` | string | The host of `redirect_uri`, e.g. `"claude.ai"` |
| `local` | boolean | Whether `redirect_uri` is on the user's computer, where any program could be listening |
| `scopes` | list of strings | The scopes the connection would get |

Fails with 400 when the parameters aren't valid (see [Authorizing an app](#authorizing-an-app)): with `redirect`, the
app's redirect URI with the error, when the app can be told, and otherwise with `unknownClient`, which is `true` when
`client_id` isn't one of the clients.

## `POST /api/admin/oauth/authorization` (admin)

Allows the app, or refuses. The request has the parameters of [Authorizing an app](#authorizing-an-app), as strings,
and:

| Request field | Type | |
|---|---|---|
| `allow` | boolean | Whether the user allows the app |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `redirect` | string | Where to send the browser: the app's redirect URI, with a `code`, or with `access_denied` when the user refused |

Fails like `GET /api/admin/oauth/authorization`.

## `POST /api/oauth/token`

Gets tokens for a connection. The request is a form, and errors are OAuth's, with a 400 status (see
[Conventions](README.md#conventions)). Apps don't authenticate (see
[`GET /.well-known/oauth-authorization-server`](#get-well-knownoauth-authorization-server)), so a request with an
`Authorization` header or a `client_secret` fails with `invalid_request`.

With `grant_type` set to `authorization_code`, it exchanges a code for the tokens of a new connection:

| Request field | |
|---|---|
| `code` | From the authorization |
| `client_id` | The app the code was given to |
| `redirect_uri` | The one the code was given for |
| `code_verifier` | The PKCE verifier of the authorization's `code_challenge` |
| `resource` | Optional. Like in the authorization |

With `grant_type` set to `refresh_token`, it gets the connection new tokens:

| Request field | |
|---|---|
| `refresh_token` | The connection's latest |
| `client_id` | The connection's app |
| `resource` | Optional. Like in the authorization |
| `scope` | Optional. Some of the connection's scopes, which it keeps from then on, rather than the others |

Either way, the response, which is never cached (`Cache-Control: no-store`), is:

| Response field | Type | |
|---|---|---|
| `access_token` | string | |
| `token_type` | `"Bearer"` | |
| `expires_in` | number | In seconds |
| `refresh_token` | string | The connection's new refresh token |
| `scope` | string | The connection's scopes, separated by spaces |

| `error` | When |
|---|---|
| `invalid_request` | A field is missing, or isn't valid, `redirect_uri` isn't the one the code was given for, or the request isn't a form |
| `unsupported_grant_type` | `grant_type` is neither of the above |
| `invalid_client` | `client_id` isn't one of the [clients](#clients) |
| `invalid_grant` | The code or the refresh token is unknown, expired, already used (see [Connections](#connections)) or another app's, the verifier is missing or doesn't match, or the connection ended |
| `invalid_scope` | `scope` has a scope the connection doesn't have |
| `invalid_target` | `resource` isn't the MCP server |

## `POST /api/oauth/revoke`

Ends the connection of a token, for an app that's done with it ([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009)).
The request is a form, like for [`POST /api/oauth/token`](#post-apioauthtoken):

| Request field | |
|---|---|
| `token` | One of the connection's tokens, the access token or the refresh token |
| `client_id` | The connection's app |
| `token_type_hint` | Optional, ignored |

Responds with an empty object, even when `token` isn't one the server knows, or is another app's, which is then left as
it is. Fails with 400 (`invalid_request`) without `token` or `client_id`, or with an `Authorization` header or a
`client_secret`, like the token endpoint.

## `GET /api/admin/connections` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many connections `connections` has (see [Conventions](README.md#conventions)) |
| `connections` | list of connections | The logged-in admin's own, the most recently used first |

A connection has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `client` | string | The app's name, e.g. `"Claude"` |
| `scopes` | list of strings | |
| `createdAt` | string | When the app was connected |
| `lastUsedAt` | string | When the app last used the connection, give or take a few minutes |

## `DELETE /api/admin/connections/:id` (admin)

Ends one of the logged-in admin's connections (see [Connections](#connections)), and responds `{"ok": true}`. Fails with
404 when there's no such connection, including when it's another admin's.
