# Publier sur RA

Creating a session's event on Resident Advisor from its page, with a bookmarklet: a bookmark that runs Parking Radio's
code on RA's site, as the admin logged in to RA there. RA has no public API, so the bookmarklet calls the GraphQL
endpoint RA's own site calls, like the server already does to read events (see [Events](../../server/events.md)). It's a
convenience that can stop working whenever RA changes its site, without warning: admins then create the event by hand,
with the copy buttons of the session's page (see [Creating its event on RA](sessions.md#creating-its-event-on-ra)),
while it gets fixed. Nothing else depends on it: a session's event on RA is its `raEvent`, which can always be set by
hand.

Publishing works from every environment, but the events it creates on RA are real, whatever environment they come from:
outside production, the session's panel and the bookmarklet both warn about it, naming the environment as the navigation
bar's stamp does, « DEV » for `development`, and otherwise its name in capitals (see
[Environment](../architecture.md#environment)), e.g. « Attention : l'événement sera vraiment créé sur RA, à partir d'une
session de TEST. ».

## Steps

1. In the panel that creates a session's event on RA, under its « Événement RA » (see
   [Creating its event on RA](sessions.md#creating-its-event-on-ra)), « Publier sur RA » opens RA's form to create an
   event (`https://ra.co/pro/event/create`) in a new tab, with the content of the session's event (see
   [Events on RA](../../server/sessions.md#events-on-ra)) in the address's fragment, which never reaches RA's server:
   `#parking-radio=` followed by `{"site", "environment", "session", "event"}` as JSON, URI-encoded, where `site` is the
   site's origin, `environment` its environment (see [`GET /api/config`](../../server/README.md#get-apiconfig)),
   `session` the session's id, and `event` the content as the server gives it.
2. The admin logs in to RA with their own account, if they aren't already, and clicks the bookmarklet, which shows a
   panel over RA's page. If logging in lost the fragment, it says to click « Publier sur RA » again.
3. The bookmarklet checks RA, then shows the event: the RA account it's logged in as, the title, the start and the end,
   the venue's name as RA has it, the lineup and the description, then, outside production, the warning that the event
   will be created on RA all the same. « Créer sur RA » creates it, and « Annuler », or the panel's ×, closes it without
   creating anything.
4. Once the event is created, the bookmarklet shows its link, a link to the session's page that saves it as the
   session's event (see [Back to the session](#back-to-the-session)), and a reminder to add the flyer on RA by hand.

## The bookmarklet

Configuration gives it (see [Configuration](configuration.md#publier-sur-ra)): a link to drag into the browser's
bookmarks, whose code adds a script to RA's page, `<site>/ra-bookmarklet.js`, from the site it was installed from, with
a query that changes each time, so that no cache gives an old one. The script is what does everything below: fixing the
bookmarklet changes that script, and never requires reinstalling it. The script is public, and holds no secrets (see
[Serving the client](../../server/README.md#serving-the-client)). It relies on RA's pages letting it load the script:
should RA ever send a Content-Security-Policy that doesn't, the bookmarklet stops working, and admins publish by hand.
Each environment has its own bookmarklet, which loads the script from its own site. In development, the script comes
from `http://localhost`: the browser may ask to allow ra.co to reach the local network, and the bookmarklet only works
once that's allowed.

The panel is in French, like the admin pages, and only ever shows what it's given, from the address or from RA, as text.
Clicking the bookmarklet again replaces it.

What the script does:

- It only runs on `ra.co`, with an event in the fragment, as the session's page puts it there, from the site it was
  loaded from: otherwise it says what's missing, and does nothing else.
- It reads the RA login of the browser, the `next_id_token` cookie, and sends every request to RA's GraphQL endpoint
  (`/graphql`, on RA's site) with it, as `Authorization: Bearer <token>`. Without it, it says to log in to RA, then to
  click « Publier sur RA » again.
- It first checks, in one request that changes nothing, that RA knows who's logged in (`user { username }`), that
  Parking Radio's venue is there (`venue`), and that RA still takes what it sends: that the `createEvent` mutation
  exists, that every field it sends is one of `EventInput`'s, and that `EventInput` has no required field (non-null,
  without a default) that it doesn't send. When RA doesn't know who's logged in, it says to log in again. When the rest
  doesn't hold, it says that RA changed, and what changed.
- It sends the event as `EventInput`: `title`, `startTime` and `endTime`, in Québec time without their offset, as
  `"2026-11-20T21:00:00.000"`, `lineup`, `venueId`, `promoterIds` and `content`, as the server gives them, and
  `submissionSource`, `"SUBMITEVENTPAGE"`. It only creates the event, once, when « Créer sur RA » is clicked, with the
  `createEvent` mutation, which gives the new event's `id`. It never tries again on its own.
- When RA refuses, it shows RA's messages as they come. When anything else goes wrong, it says that something didn't
  work.

## Back to the session

The link back to the session is `<site>/admin/sessions/<session>?raEvent=<id>`. A link can't change anything on its own,
since anyone could write one: on the session's page, while the session has no event on RA, `raEvent` opens the panel
that creates it, with that event's link in its field, under a notice that says it was just created on RA, and only
« enregistrer » saves it (see [Creating its event on RA](sessions.md#creating-its-event-on-ra)). A `raEvent` that isn't
an event on RA, as a session's `raEvent` takes it, is ignored. « enregistrer » and « annuler » remove it from the page's
address. Once the event is created, the bookmarklet also removes the event from RA's page's address, so that clicking it
again there doesn't offer to create it again.

## Later

The flyer isn't sent to RA: admins add it to the event on RA by hand.

## Endpoints

None of the API's: the bookmarklet only calls RA's GraphQL endpoint, and the session's page saves the event (see
[Sessions](sessions.md#endpoints)).
