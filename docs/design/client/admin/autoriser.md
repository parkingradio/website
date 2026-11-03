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
- Where the browser goes back to, by its host, e.g. "claude.ai", or that it's the admin's own computer, e.g. for Claude
  Code.
- That the admin should only allow it if they just started connecting it themselves, since anyone can send them a link
  to this page.

"autoriser" allows the app and "refuser" refuses, and either one sends the browser back to the app, which says how it
went. When what the app asks for isn't valid, the page sends the browser back to the app right away, which says what's
wrong, except when it can't (see [Authorizing an app](../../server/oauth.md#authorizing-an-app)): the page then says
that the link isn't valid, or, for an app the site doesn't know (`unknownClient`), that only Claude and Claude Code can
connect. The server's errors are shown as it gives them, in English, inside the page's sentences, like on the admin
pages.

## Endpoints

- `GET /api/admin/oauth/authorization`, for what the app asks for.
- `POST /api/admin/oauth/authorization`, from "autoriser" and "refuser".
- `GET /api/admin/me` and `POST /api/auth/login`, like every admin page (see [Admin](layout.md)).
