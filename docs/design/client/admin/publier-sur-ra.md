# Publier sur RA

Creating a session's event on Resident Advisor from its page, with a bookmarklet: a bookmark that runs Parking Radio's
code on RA's site, as the admin logged in to RA there. RA has no public API, so the bookmarklet calls the GraphQL
endpoint RA's own site calls, like the server already does to read events (see [RA events](../../server/ra-events.md)).
What it creates comes from the server (see [Publishing on RA](../../server/ra-publication.md)): the calls to RA are the
bookmarklet's, and only its. It's a convenience that can stop working whenever RA changes its site, without warning:
admins then create the event on RA by hand, from the session's page, and paste its link in the session (see
[Creating its event on RA](sessions.md#creating-its-event-on-ra)), while it gets fixed. Nothing else depends on it: a
session's event on RA is its `raEvent`, which can always be set by hand.

Publishing works from every environment, but the events it creates on RA are real, whatever environment they come from:
outside production, the session's panel and the bookmarklet both warn about it, naming the environment as the navigation
bar's stamp does, « DEV » for `development`, and otherwise its name in capitals (see
[Environment](../architecture.md#environment)), e.g. « Attention : l'événement sera vraiment créé sur RA, à partir d'une
session de TEST. ».

## Steps

1. In the panel that creates a session's event on RA, under its « Événement RA » (see
   [Creating its event on RA](sessions.md#creating-its-event-on-ra)), « Publier sur RA » gets a token for the session
   from the server (see [The token](../../server/ra-publication.md#the-token)), and opens RA's form to create an event
   (`https://ra.co/pro/event/create`) in a new tab, with the token, and only it, in the address's fragment, which never
   reaches RA's server: `#parking-radio=<token>`.
2. The admin logs in to RA with their own account, if they aren't already, and clicks the bookmarklet, which shows a
   panel over RA's page. If logging in lost the fragment, or the token expired, it says to click « Publier sur RA »
   again.
3. The bookmarklet gets the event and its flyer from the site, checks RA, then shows the event: the RA account it's
   logged in as, the title, the start and the end, the venue's name as RA has it, the lineup, the description, the links
   and the media links, the flyer, or « Pas de flyer » when the session has none, then, outside production, the warning
   that the event will be created on RA all the same. « Créer sur RA » sends the flyer to RA and creates the event with
   it, and « Annuler », or the panel's ×, closes it without creating anything.
4. Once the event is created, the bookmarklet shows its link, a link to the session's page that saves it as the
   session's event (see [Back to the session](#back-to-the-session)), and, unless the flyer was sent with it, a reminder
   to add the flyer on RA by hand: the session's page links to it as it was sent (see
   [A session's page](sessions.md#a-sessions-page)).

## The bookmarklet

Intégrations gives it (see [Intégrations](integrations.md#publier-sur-ra)): a link to drag into the browser's
bookmarks, whose code adds a script to RA's page, `<site>/ra-bookmarklet.js`, from the site it was installed from, with
a query that changes each time, so that no cache gives an old one. The script is what does everything below: fixing the
bookmarklet changes that script, and never requires reinstalling it. The script is public, and holds no secrets (see
[Serving the client](../../server/README.md#serving-the-client)). It relies on RA's pages letting it load the script,
and reach the site: should RA ever send a Content-Security-Policy that doesn't, the bookmarklet stops working, and
admins publish by hand.
Each environment has its own bookmarklet, which loads the script from its own site. In development, the script and the
event come from `http://localhost`: the browser may ask to allow RA's site to reach the local network, and the
bookmarklet only works once that's allowed.

The panel is in French, like the admin pages, and only ever shows what it's given, from the site or from RA, as text,
and the flyer as the image the site sent.
Clicking the bookmarklet again replaces it.

What the script does:

- It only runs on `ra.co` or one of its subdomains, e.g. `fr.ra.co`, with a token in the fragment, as the session's
  page puts it there, and once it knows which site its script came from, which the page's content, e.g. an element
  named `currentScript`, can't pass for: otherwise it says what's missing, and does nothing else. It removes the token from the address
  as soon as it reads it, so that it doesn't stay in RA's page's address, or its history: clicking it again on that
  page then says to click « Publier sur RA » again.
- It reads the RA login of the browser, the `next_id_token` cookie, and sends every request to RA's GraphQL endpoint
  (`/graphql`, on RA's site) with it, as `Authorization: Bearer <token>`. Without it, it says to log in to RA, then to
  click « Publier sur RA » again.
- It gets the event from the site it was loaded from, and never from another one, with the token
  ([`GET /api/ra-publication`](../../server/ra-publication.md#get-apira-publication)). When the site refuses the token,
  e.g. once it expired, or when it comes from another environment's site, it says to click « Publier sur RA » on the
  session's page again, then the bookmarklet of that session's site. When the site can't be reached, it says so.
- When the session has a flyer, it gets it from the same site, with the token
  ([`GET /api/ra-publication/flyer`](../../server/ra-publication.md#get-apira-publicationflyer)), and only keeps it when
  it's a JPEG. When it can't have it, it says so, and why, in place of the flyer, and that the event will be created
  without it, to add by hand on RA: creating the event still works. When RA's page doesn't let it show the flyer, it
  says that it can't be shown there, but will be sent all the same.
- It then checks, in one request that changes nothing, that RA knows who's logged in (`user { username }`), that
  Parking Radio's venue is there (`venue`), and that RA still takes what it sends: that the `createEvent` mutation
  exists, that every field of the event the site gives is one of `EventInput`'s, `images` included when it has the
  flyer, and that `EventInput` has no required field (non-null, without a default) that the event doesn't have. When it
  has the flyer, it checks the same of `ImageInput`, for the flyer's fields, `filename` and `type`. When RA doesn't know
  who's logged in, it says to log in again. When the rest doesn't hold, it says that RA changed, and what changed.
- It sends the event as the site gives it, as `EventInput` (see
  [The event](../../server/ra-publication.md#the-event)). It only creates the event, once, when « Créer sur RA » is
  clicked, with the `createEvent` mutation, which gives the new event's `id`. It never tries again on its own.
- When it has the flyer, it first uploads it, as RA's own form does: a `multipart/form-data` `POST` to
  `https://image-uploader.ra.co/upload`, with the flyer in `data`, and the RA login as for RA's GraphQL endpoint. It
  takes the flyer's address on RA from the answer's `filename`, and adds it to the event, as
  `images: [{"filename": <it>, "type": "FLYERFRONT"}]`. When the upload fails, or RA doesn't answer within a minute, it
  creates the event without the flyer, and says that the flyer couldn't be sent to RA, and why, and to add it by hand
  on RA.
- When RA refuses, it shows RA's messages as they come. When anything else goes wrong, it says that something didn't
  work, and why, e.g. the site's error.

## Back to the session

The link back to the session is `<site>/admin/sessions/<session>?raEvent=<id>`. A link can't change anything on its own,
since anyone could write one: on the session's page, while the session has no event on RA, `raEvent` opens the panel
that creates it, with that event's link in its field, under a notice that says it was just created on RA, and only
« enregistrer » saves it (see [Creating its event on RA](sessions.md#creating-its-event-on-ra)). A `raEvent` that isn't
an event on RA, as a session's `raEvent` takes it, is ignored. It's removed from the page's address as
[A session's page](sessions.md#a-sessions-page) says.

## Endpoints

- `POST /api/admin/sessions/:id/ra-publication`, on the session's page, for « Publier sur RA » (see
  [Sessions](sessions.md#endpoints), where the page also saves the event).
- `GET /api/ra-publication`, from the bookmarklet, for the event.
- `GET /api/ra-publication/flyer`, from the bookmarklet, for the session's flyer.
