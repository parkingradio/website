# Artistes

At `/admin/artistes`: the artists Parking Radio knows of (see [Artists](../../server/artists.md)).

The section lists every artist, by name, with which of the two they are (artist or collective), their city and genres. A
field above the list searches the artists (see [Searching lists](layout.md#searching-lists)) by their name (and a
collective's artists), email address, phone number, city, country, genres and the profile names of their links, but not
their bio, which would match too many searches. Clicking "Nom", "Type" (artists before collectives) or "Ville" (by city,
then country) sorts the list by that column, and clicking it again sorts it the other way around.

## An artist's page

Clicking an artist opens their page at `/admin/artistes/<id>`, with everything about them, their photo (or "Pas de
photo" in its place, so that the team notices), their links rebuilt from the profile names, who added them (or that they
applied by themselves) and who last changed them. A button changes the artist in a form in its place. The form shows the
artist's photo with an × that removes it once the artist is saved, and a photo that's chosen replaces it, shown in its
place with an × that takes it back. Under it, their applications are listed like in [Candidatures](candidatures.md),
with a button to create another one. Since they're all the artist's, the list doesn't show the artist, their city or
genres, and since they're few, it can't be searched, filtered or sorted. At the bottom, the artist can be deleted for
good, with their photo, if they have one, and applications, after confirming.

## Adding an artist

"ajouter un artiste" adds an artist by hand, with the same form. In it, a collective's artists are typed one by one
and pinned with a "+" button (or Enter): only the names pinned are kept, so the form isn't sent while a name is left
typed without being pinned. Genres are tags to click, which pins them in order of importance, and the country is
typed, with the matching countries suggested, of which one has to be picked, "Pays inconnu" leaving it out.
Each field says what's wrong with it once it's left: the form checks the profile as the server does for admins (see
[Profiles](../../server/artists.md#profiles)), for immediate feedback. The server's check is the one that counts: if it
refuses what the form accepted, the form shows the server's message.

## Endpoints

- `GET /api/admin/artists`, for the list.
- `GET /api/admin/artists/:id`, `PUT /api/admin/artists/:id` and `DELETE /api/admin/artists/:id`, for an artist's page.
- `GET /api/admin/artists/:id/photo`, for their photo.
- `GET /api/admin/applications?artist=<id>`, for their applications.
- `POST /api/admin/artists`, for "ajouter un artiste".
