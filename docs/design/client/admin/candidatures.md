# Candidatures

At `/admin/candidatures`: the artists' applications for a set, for the team to go through (see
[Applications](../../server/applications.md)). Each application's status is shown as "nouvelle" (new), "retenue"
(accepted), "planifiée" (scheduled), "faite" (done) or "refusée" (rejected). What the artist would do is picked from a
list, and shown by its name, the same on the "Appliquer" form and on the admin pages, plus "autre" in a few words.

The section lists every application, the most recently received first, with when it was received ("reçue le"), the
artist, their city and genres, their first few dates, the prestations and the status. Buttons above the list show only
the applications with a status, or all of them ("toutes"), with how many there are of each.

A field above the list searches the applications (see [Searching lists](layout.md#searching-lists)) by their artist,
like in [Artistes](artistes.md), their prestations, their questions or details, and the days the artist would like to
play, written out (e.g. "jeudi 10 décembre 2026"), so that "décembre" or "jeudi" finds the applications with a day in
December, or a Thursday. Clicking "Reçue le", "Artiste", "Ville" (by city, then country), "Dates" (by the first day the
artist would like to play) or "Statut" (nouvelle, retenue, planifiée, faite, then refusée) sorts the list by that
column, and clicking it again sorts it the other way around. The status buttons count the applications the search finds.

Under the list, a line says that who the applications artists send are emailed to is chosen in
[Configuration](configuration.md), and links to it.

Clicking an application opens it at `/admin/candidatures/<id>`. Under its title, it says when it was received (unless
that's the day it was created), who created it and when, or that it was sent through the form, and who last changed it
and when, if anyone did. From top to bottom, it then shows:

- "Statut": the status, as buttons that change it, and which admin last changed it, and when.
- "Artiste": who the artist is and how to reach them, linking to their page.
- "Candidature": everything in the application, and a button that changes it in a form in its place, including the day
  it was received.
- "Supprimer": deletes the application for good, after confirming. The artist stays.

"nouvelle candidature" creates an application by hand, at `/admin/candidatures/nouvelle`, e.g. to bring in one that came
through the original Google Form: a form with the artist, picked from those in the "Artistes" section, the day the
application was received (today if it's left empty), then the application itself. An artist's page leads to it with that
artist picked already (`?artiste=<id>`). The application form says what's wrong with each field once it's left, like the
artist form (see [Artistes](artistes.md)): it checks the application as the server does (see
[Applications](../../server/applications.md)), for immediate feedback. The server's check is the one that counts: if it
refuses what the form accepted, the form shows the server's message.

## Endpoints

- `GET /api/admin/applications`, for the list.
- `GET /api/admin/applications/:id`, `PUT /api/admin/applications/:id`, `PUT /api/admin/applications/:id/status` and
  `DELETE /api/admin/applications/:id`, for an application's page.
- `POST /api/admin/applications`, for "nouvelle candidature".
- `GET /api/admin/artists`, for the artists' names, cities and genres in the list, to search the applications by them,
  and to pick the artist of a new application.
- `GET /api/admin/artists/:id`, for the artist on an application's page.
