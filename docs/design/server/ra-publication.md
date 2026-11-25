# Publishing on RA

What the bookmarklet that creates a session's event on Resident Advisor gets from the server (see
[Publier sur RA](../client/admin/publier-sur-ra.md)). The bookmarklet runs on RA's site, as the admin logged in to RA
there, since RA only takes their login from their own browser: it's the one that calls RA, and the server never does.
Everything else, i.e. what the event is, comes from the server. A session's event on RA is its `raEvent` (see
[Links, in Sessions](sessions.md#links)), which an admin sets once the event is created on RA.

These endpoints aren't tools of the [MCP server](mcp.md), since the token is a secret.

## The token

The session's page asks for a token for the session
([`POST /api/admin/sessions/:id/ra-publication`](#post-apiadminsessionsidra-publication-admin)), which it hands to the
bookmarklet. The token gives access to that session's event and its flyer for publishing them, and to nothing else.

It's signed by the server, with a key it derives from its secret for this purpose only, so that it can never pass for
another of its tokens, e.g. an admin's session. It holds the session, the admin who asked for it, and when it expires,
1 hour after it was given. The server keeps nothing of it: on each use, it checks its signature, that it hasn't expired,
and that the admin hasn't been revoked or chosen a new password since it was given, which end it as they end the
admin's sessions (see [Sessions, in Admins](admins.md#sessions)).

Requests send it in their `Authorization` header, as `Bearer <token>`, rather than in their address, which the
servers in front of this one log, e.g. nginx and Cloudflare. Requests without a valid one fail with 403, and an error
that doesn't quote it, before anything else is read. Not 401, which only admin endpoints give (see
[Admin endpoints, in Conventions](README.md#conventions)). There's no rate limit (see
[Rate limits, in Conventions](README.md#conventions)): tokens can't be guessed.

The bookmarklet gets the token through the fragment of RA's page's address, which RA's own scripts can read before the
bookmarklet removes it: whoever has it can only read the event that's going to RA, and its flyer, for an hour at most.

## Reaching them from RA

The bookmarklet calls the endpoints that take the token from RA's pages, i.e. from another site: they allow
`https://ra.co` and its subdomains, e.g. `https://fr.ra.co`, to read their responses, errors included (CORS), without
cookies, and no other site. Since requests send the `Authorization` header, browsers first ask whether they may, with an
`OPTIONS` request to the same path (a preflight), which gets 204, allowing that header and the endpoint's methods to
those sites. Every response, whether it succeeds or fails, has `Cache-Control: no-store`.

## The event

What the bookmarklet sends to RA to create the session's event, as RA's `EventInput` (RA's own name for what its
`createEvent` mutation takes):

| Field | Type | |
|---|---|---|
| `title` | string | The session's `title` |
| `startTime`, `endTime` | string | The session's `start` and `end`, in Québec time without their offset, to the millisecond, as RA takes them, e.g. `"2026-11-20T21:00:00.000"` |
| `lineup` | string | One performer per line: the names of the session's lineup, as its event gives it, or would once it's announced (see `lineup` in [Events](events.md#whats-public)): the performers of its sets that aren't cancelled, in the order of its `sets`, each set's in their order, each artist once, e.g. `"Aurore\nBrume"` for a set of Aurore and Brume. RA needs one, so a session without such performers has `"OPEN JAM"` for a `"synth-meetup"`, as Parking Radio's synth meetups do on RA, or else its `title` |
| `venueId` | string | Parking Radio's venue on RA, `"288529"` (`https://ra.co/clubs/288529`) |
| `promoterIds` | list of strings | Parking Radio's promoter page on RA, `["183980"]` (`https://ra.co/promoters/183980`) |
| `content` | string | The session's `effectiveDescription` |
| `promotionalLinks` | list of objects | The event's promotional links on RA, Parking Radio's site and Instagram, each a `title` and its `url`: `[{"title": "parking.radio", "url": "https://parking.radio"}, {"title": "instagram", "url": "https://www.instagram.com/parking.radio"}]` |
| `playerLinks` | list of objects | The event's media links on RA, Parking Radio's YouTube and SoundCloud, each a `sourceId`, its address: `[{"sourceId": "https://www.youtube.com/@parkingdotradio"}, {"sourceId": "https://soundcloud.com/parkingdotradio"}]` |
| `submissionSource` | string | `"SUBMITEVENTPAGE"`, as RA's own form sends it |

It's the same whether the session is announced or not. The bookmarklet adds the session's flyer to it, as `images`, once
RA has it (see [The flyer](#the-flyer)).

## The flyer

The session's flyer (see [Flyers, in Sessions](sessions.md#flyers)), as the bookmarklet uploads it to RA: a JPEG of at
most 2000 × 2000 pixels and 3,000,000 bytes, as RA takes them, with the flyer's proportions, never larger than it,
upright and without any of its metadata, as photos' sizes are (see [Photos, in Artists](artists.md#photos)), in sRGB,
with its transparent parts, if any, on white, lowering its quality only as far as it needs to fit.

## `POST /api/admin/sessions/:id/ra-publication` (admin)

Takes no body. Gives a new token for the session (see [The token](#the-token)), for the logged-in admin.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `token` | string | The token |

Fails with 404 when there's no such session.

## `GET /api/ra-publication`

The session's event, for the token in `Authorization`.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `environment` | string | The server's environment, as [`GET /api/config`](README.md#get-apiconfig) gives it, so that the bookmarklet warns outside production |
| `session` | string | The session's id, which the bookmarklet's link back to the session's page has |
| `hasFlyer` | boolean | Whether the session has a flyer, which [`GET /api/ra-publication/flyer`](#get-apira-publicationflyer) gives |
| `event` | object | The session's event (see [The event](#the-event)) |

Fails with 403 without a valid token, 404 when the session no longer exists, and 409 when it has no start, since RA
needs one, or is cancelled, e.g. since the token was given.

## `GET /api/ra-publication/flyer`

The session's flyer, for the token in `Authorization`, as the bookmarklet uploads it to RA (see
[The flyer](#the-flyer)), as `image/jpeg` rather than JSON. Browsers are told not to guess another type
(`X-Content-Type-Options: nosniff`).

Fails with 403 without a valid token, and 404 when the session no longer exists, when it has no flyer, or when its flyer
is missing.
