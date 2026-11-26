# Autoriser une application

At `/autoriser`: where an admin allows an app, e.g. Claude, to act as them (see
[Authorizing an app](../../server/oauth.md#authorizing-an-app)). Apps send the admin's browser there, with what they ask
for in the page's address. Like `/accept-invite`, the page is outside `/admin`, and isn't linked from the site. It
requires being logged in like the admin pages: logged out, it shows their login form, without their menu, saying that
logging in is to allow the app (see [Admin](layout.md)).

The page shows:

- The app asking, by its name, e.g. "Claude", and that it will act as the logged-in admin, by their email.
- What it will be able to do, in plain words: for the `admin` scope, everything the admin does on the admin pages,
  except what the MCP server leaves out, which it lists (see [Tools](../../server/mcp.md#tools)).
- That the admin should only allow it if they just started connecting it themselves, since anyone can send them a link
  to this page.

"autoriser" allows the app and "refuser" refuses, and either one sends the browser back to the app, which says how it
went. When what the app asks for isn't valid, the page sends the browser back to the app right away, which says what's
wrong, except when it can't (see [Authorizing an app](../../server/oauth.md#authorizing-an-app)): the page then says
that the link isn't valid, or, for an app the site doesn't know (`unknownClient`), that this app can't connect to
Parking Radio. The server's errors are shown as it gives them, in English, inside the page's sentences, like on the
admin pages.

## Once the app is done connecting

At `/autoriser/termine`: where an app, e.g. the Parking Radio CLI, can send the browser once it's done connecting,
whether it worked or not (see [Authorizing an app](../../server/oauth.md#authorizing-an-app)), rather than show a page of
its own. It isn't linked from the site, and doesn't require being logged in: it shows nothing that needs a session, and
the admin may have been logged out meanwhile. It loads with the public pages, calls no endpoint, and is styled like
[Page introuvable](../not-found.md).

Without `failed` in its query, it's titled « Application connectée », and says « L'application est maintenant connectée
à Parking Radio. Vous pouvez fermer cet onglet. ». With `failed` in its query, with or without a value (e.g. `?failed` or
`?failed=1`), it's titled « Application non connectée », and says « L'application n'a pas pu être connectée à Parking
Radio. Revenez à l'application pour savoir pourquoi. ». It shows nothing from its address, not even the app's name,
since anyone can link to it.

## Endpoints

- `GET /api/admin/oauth/authorization`, for what the app asks for.
- `POST /api/admin/oauth/authorization`, from "autoriser" and "refuser".
- `GET /api/admin/me` and `POST /api/auth/login`, like every admin page (see [Admin](layout.md)).
