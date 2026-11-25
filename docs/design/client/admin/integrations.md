# Intégrations

At `/admin/integrations`: what lets other apps and sites work with the admin pages, i.e. Claude, calendar apps and
Resident Advisor. From top to bottom, it shows:

- "Connecter Claude": how to let Claude do what the admin does on the admin pages, as them (see
  [MCP server](../../server/mcp.md)).
- "Vos applications connectées": the apps the admin connected (see [Connections](../../server/oauth.md#connections)).
- "Calendriers": about the links to the admin's calendars, which it replaces (see
  [Admins' calendars](../../server/admin-calendars.md)).
- "Publier sur RA": the bookmarklet that creates sessions' events on Resident Advisor.

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

## Calendriers

One line, saying that the links to the admin's calendars in the legend of Calendrier, which it links to (see
[Subscribing, in Calendrier](calendrier.md#subscribing)), are personal, so that whoever has them sees these calendars,
and that regenerating them stops the calendars subscribed with the current ones from being updated. Then "régénérer les
liens", which replaces them (see
[`POST /api/admin/ics-subscription-token`](../../server/admin-calendars.md#post-apiadminics-subscription-token-admin)),
once the admin confirms « Régénérer vos liens ? Les calendriers abonnés avec les liens actuels ne seront plus mis à
jour. ». The section then says « Liens régénérés : abonnez-vous à nouveau depuis la légende du Calendrier, puis retirez
les anciens calendriers de votre application. ». While the links are replaced, and only then, the button is greyed out
(see [Controls that can't be used](layout.md#controls-that-cant-be-used)). When replacing them fails, the section says
why, « Les liens n'ont pas pu être régénérés : … ». Either message stays until "régénérer les liens" is used again.

## Publier sur RA

The bookmarklet that creates a session's event on Resident Advisor from its page (see
[Publier sur RA](publier-sur-ra.md)). It's a link, « Parking Radio → RA », followed outside production by the
environment's stamp, e.g. « Parking Radio → RA [TEST] », so that admins tell their bookmarks apart (see
[Environment](../architecture.md#environment)), to drag into the browser's bookmarks, whose code loads the bookmarklet's
script from the site it's on (see [The bookmarklet](publier-sur-ra.md#the-bookmarklet)), and clicking it on this page
does nothing. How to use it is said where it's used, under a session's « Événement RA » (see
[Creating its event on RA](sessions.md#creating-its-event-on-ra)).

## Endpoints

- `GET /api/admin/connections`, for "Vos applications connectées".
- `DELETE /api/admin/connections/:id`, for "déconnecter".
- `POST /api/admin/ics-subscription-token`, for "régénérer les liens".
