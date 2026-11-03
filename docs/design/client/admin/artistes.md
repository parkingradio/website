# Artistes

At `/admin/artistes`: the artists and collectives Parking Radio knows of (see [Artists](../../server/artists.md) and
[Collectives](../../server/collectives.md)).

The section lists every artist and every collective together, by name, with which of the two they are (artist or
collective), their city and genres. A collective's genres are its members' (see
[A collective's genres](#a-collectives-genres)). A field above the list searches it (see
[Searching lists](layout.md#searching-lists)) by name, email address, phone number, city, country, genres and the
profile names of links, and a collective also by its artists' names, but not by bio or description, which would match
too many searches. Clicking "Nom" (`name`), "Type" (`type`, artists before collectives) or "Ville" (`city`, by city,
then country) sorts the list by that column, and clicking it again sorts it the other way around.

## A collective's genres

A collective has no genres of its own: wherever the admin pages show or search a collective's genres, they're its
members': every member's first genre, in the order of the members, then every member's second genre, and so on, each
genre only once, so that the first ones are still the most important.

## An artist's page

Clicking an artist opens their page at `/admin/artistes/<id>`, with everything about them, their photo (or "Pas de
photo" in its place, so that the team notices), their links rebuilt from the profile names, the collectives they're in,
linking to them, who added them (or that they came through the "Appliquer" form, alone or with a collective) and who
last changed them. A button changes the artist in a form in its place. The form shows the artist's photo with an × that
removes it once the artist is saved, and a photo that's chosen replaces it, shown in its place with an × that takes it
back. Under it, their applications are listed like in [Candidatures](candidatures.md), with a button to create another
one. Since they're all the artist's, the list doesn't show the artist, their city or genres, and since they're few, it
can't be searched, filtered or sorted. Under them, the sets they played, whatever their status, but not the other sets
of the same sessions, are listed like a session's sets (see [A session's page](sessions.md#a-sessions-page)), with
their session's day ("Date") and name ("Session"), linking to its page, but without being changed there: their status
is only shown. Sets are added in their session, so there's no button to add one, and the list can't be searched,
filtered or sorted either. At the bottom, the artist can be deleted for good, with their photo, if they have one, and
applications, after confirming. They're then taken out of their collectives and their sets, which stay, which the page
says of those they have.

## A collective's page

Clicking a collective opens its page at `/admin/artistes/collectifs/<id>` (`/admin/artistes/collectifs` leads to the
list), with everything about it, its photo (or "Pas de photo"), its links, its artists in order, each linking to their
page (or that it has none, which happens once its artists are deleted), its genres, who added it (or that it applied by
itself) and who last changed it. A button changes the collective in a form in its place, which shows its photo like an
artist's. Under it, its applications are listed like an artist's, with a button to create another one, then the
sessions of its takeovers, like in [Sessions](sessions.md) but without their takeover, with a button to add another one
as its takeover ("nouvelle session"), and the list can't be searched, filtered or sorted either. At the bottom, the
collective can be deleted for good, with its photo, if it has one, and applications, after confirming. Its artists
stay, and so do their own applications, and the sessions of its takeovers, without one, which the page says when it has
some.

## Adding an artist

"ajouter un artiste" adds an artist by hand, at `/admin/artistes/nouveau`, with the same form. Genres are tags to click,
which pins them in order of importance, and the country is typed, with the matching countries suggested, of which one
has to be picked, "Pays inconnu" leaving it out. It starts on Canada. Each field says what's wrong with it once it's
left: the form checks the profile as the server does for admins (see [Profiles](../../server/artists.md#profiles)), for
immediate feedback. The server's check is the one that counts: if it refuses what the form accepted, the form shows the
server's message.

The form only adds artists: collectives are added with "ajouter un collectif".

## Adding a collective

"ajouter un collectif" adds a collective by hand, at `/admin/artistes/collectifs/nouveau`, with the same form as the
collective's page. It works like the artist form (see [Adding an artist](#adding-an-artist)), and checks the profile as
the server does for admins (see [Profiles](../../server/collectives.md#profiles)). It has no genres, which are the
artists'.

Its artists are in order, at least one, and can be reordered and removed. Each one is either:

- an artist picked from those in this section, other than the collective's artists already, which are offered too,
  greyed out and marked "déjà dans le collectif", but can't be picked, or
- a new artist, whose name is typed in "Ajouter un nouvel artiste", then added with a "+" button (or Enter), and whom
  the server creates with that name only when the collective is saved. The form isn't sent while a name is left typed
  without being added. Names are the same here whatever their case and accents, with hyphens, apostrophes and dots the
  same as spaces, and "œ" and "æ" the same as "oe" and "ae". While the name typed is that of one of the collective's
  artists, the form says so, and the name can't be added. Otherwise, while it's that of an artist in this section, the
  form says so too, since picking them would avoid a duplicate.

## Endpoints

- `GET /api/admin/artists` and `GET /api/admin/collectives`, for the list.
- `GET /api/admin/artists/:id`, `PUT /api/admin/artists/:id` and `DELETE /api/admin/artists/:id`, for an artist's page.
- `GET /api/admin/artists/:id/photo`, for their photo.
- `GET /api/admin/applications?artist=<id>`, for their applications.
- `GET /api/admin/sessions?artist=<id>`, for their sets.
- `POST /api/admin/artists`, for "ajouter un artiste".
- `GET /api/admin/collectives/:id`, `PUT /api/admin/collectives/:id` and `DELETE /api/admin/collectives/:id`, for a
  collective's page.
- `GET /api/admin/collectives/:id/photo`, for its photo.
- `GET /api/admin/artists?collective=<id>`, for its genres, again each time it's saved.
- `GET /api/admin/applications?collective=<id>`, for its applications.
- `GET /api/admin/sessions?takeover=<id>`, for the sessions of its takeovers.
- `GET /api/admin/artists`, in a collective's form and in "ajouter un collectif", to pick its artists, each time the
  form opens.
- `POST /api/admin/collectives`, for "ajouter un collectif".
