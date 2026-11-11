# Admins

At `/admin/admins`: manages who can access the admin pages (see [Admins](../../server/admins.md)), and connects Claude
to them.

- "Inviter un admin": emails an invite to a given address. It checks the address as the server does first (see
  [`POST /api/admin/invite`](../../server/admins.md#post-apiadmininvite-admin)): when it isn't an email address, even
  when it's blank, nothing is sent, and "Adresse e-mail invalide." shows under the field, in place of what the previous
  invite said, until the field changes.
- "Admins existants": lists the admins by email, with "(vous)" next to the admin's own, their status ("actif",
  "invitation envoyée" with when it expires, or "invitation expirée"), and when they were added and by whom. "révoquer"
  revokes another admin after confirming, which ends their sessions and connections, or cancels their invite if they
  haven't accepted it. Those who haven't can be invited again with "renvoyer".
- "Connecter Claude": how to let Claude do what the admin does on the admin pages, as them (see
  [MCP server](../../server/mcp.md)).
- "Vos applications connectées": the apps the admin connected (see [Connections](../../server/oauth.md#connections)).

## Connecter Claude

The address of the MCP server, i.e. the site's address followed by `/mcp`, with "copier", which copies it, and the
steps to follow, in plain words: in Claude's settings, add a custom connector with that address, leaving its advanced
settings (its OAuth client ID and secret) empty, since the site doesn't let apps register themselves (see
[Clients](../../server/oauth.md#clients)), then connect it, which opens the page where the admin allows it (see
[Autoriser une application](autoriser.md)). It says that depending on the Claude plan, the organization's Owner may have
to add the connector, and gives the command that adds it to Claude Code
(`claude mcp add --transport http parking-radio <address>`).

## Vos applications connectées

The admin's own connections, the most recently used first, each with its app's name (e.g. "Claude"), when it was
connected and when it was last used, and "déconnecter", which ends it right away: the app has to be connected again to
be used. While there are none, it says so. Admins only see their own connections.

## Accepting an invite

The invite links to `/accept-invite`, where the new admin chooses their password (see
[`POST /api/auth/accept-invite`](../../server/admins.md#post-apiauthaccept-invite) for what it has to be), typing it
twice. Saving it logs out whoever was logged in in that browser, and the page then leads to the login form at `/admin`,
which says that it was saved. When someone is logged in, the page says so above the form: "Ce navigateur est connecté en
tant que <email>. Enregistrer ce mot de passe le déconnectera."; while it can't tell, it says nothing. The link `tools/create-admin` gives also leads
to `/accept-invite` (see [Roles](../../server/admins.md#roles)). The page is outside `/admin`, and doesn't require being
logged in.

## Endpoints

- `GET /api/admin/admins`, for the list.
- `POST /api/admin/invite`, for "Inviter un admin" and "renvoyer".
- `DELETE /api/admin/admins/:id`, for "révoquer".
- `GET /api/admin/connections`, for "Vos applications connectées".
- `DELETE /api/admin/connections/:id`, for "déconnecter".
- `GET /api/admin/me`, on `/accept-invite`, to say who's logged in.
- `POST /api/auth/accept-invite`, from `/accept-invite`.
