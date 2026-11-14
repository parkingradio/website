# Candidatures

At `/admin/candidatures`: the applications of artists and collectives for a set, for the team to go through (see
[Applications](../../server/applications.md)). Each application's status is shown as "nouvelle" (new), "retenue"
(accepted), "planifiée" (scheduled), "faite" (done) or "refusée" (rejected). Wherever applications are listed, their rows
are colored by status (see [Status colors](layout.md#status-colors)), and "nouvelle" is in bold. What the artist would do
is picked from a list, and shown by its name, the same on the "Appliquer" form and on the admin pages, plus "autre" in a
few words.

The section lists the applications, each with when it was received ("reçue le"), the artist or the collective, followed
by "(collectif)" for a collective, their city and genres (see
[A collective's genres](artistes.md#a-collectives-genres)), the first few dates, the performance types and the status,
as a dropdown that changes it, without confirming.
Buttons above the list show only the applications with a status, or all of them ("toutes"), with how many there are of
each. It opens on "nouvelles", its default view (see [Searching lists](layout.md#searching-lists)). "nouvelles" and
"retenues" list the oldest received first, and the other statuses and "toutes" the most recently received first. When
the list shows a single status, an application changed to another leaves it as soon as that's saved. In "toutes", it
stays, with its new status. Only its own dropdown is locked while it's saved. When a status can't be changed, the list
says why above it, naming the application, and the row keeps its status.

A field above the list searches the applications (see [Searching lists](layout.md#searching-lists)) by their artist or
collective, as [Artistes](artistes.md) searches them, their performance types, their questions or details, and the days
the artist would like to play, written out (e.g. "jeudi 10 décembre 2026"), so that "décembre" or "jeudi" finds the
applications with a day in December, or a Thursday, and "26 déc" those with December 26th. Clicking "Reçue le"
(`received`), "Artiste" (`artist`), "Ville" (`city`, by city, then country), "Dates" (`dates`, by the first day the
artist would like to play) or "Statut" (`status`: nouvelle, retenue, planifiée, faite, then refusée) sorts the list by
that column, and clicking it again sorts it the other way around. The status buttons count the applications the search
finds.

Clicking an application opens it at `/admin/candidatures/<id>`. Under its title, it says when it was received (unless
that's the day it was created), who created it and when, or that it was sent through the form, and who last changed it
and when, if anyone did. From top to bottom, it then shows:

- "Statut": the status, as buttons that change it, and which admin last changed it, and when.
- "Artiste" or "Collectif": who the artist is, with their city and genres, and how to reach them, linking to their
  page. A collective's lists its artists, linking to them, and its genres are theirs.
- "Candidature": everything in the application, and a button that changes it in a form in its place, including the day
  it was received.
- "Sets", for an artist's application, or "Sessions", for a collective's: the sets or sessions that come from it (see
  [Applications, in Sessions](../../server/sessions.md#applications)), in the server's order. Each row shows the day
  ("Date"), the times ("Heure", written as on a session's page, see [Times](sessions.md#times)) and the status
  ("Statut"). A set also shows its session's title ("Session"), which links to the session's page. A session shows its
  own title ("Nom"), and its day links to its page. When there are none, the section says so, and that they're linked
  from the form of one of the artist's sets, or of one of the collective's takeovers (see
  [Applications](sessions.md#applications)). They can't be changed from here.
- "Supprimer": deletes the application for good, after confirming. The artist or the collective stays, and so do the
  sets or sessions that come from it. When there are some, the page says « Les sets associés restent. » or « Les
  sessions associées restent. ».

"nouvelle candidature" creates an application by hand, at `/admin/candidatures/nouvelle`, e.g. to bring in one that came
through the original Google Form: a form with the artist or the collective, picked in a single field from those in the
"Artistes" section, where collectives say so, the day the application was received (today if it's left empty), sent as
its midnight in Québec time, then the application itself. An artist's page leads to it with that artist picked already
(`?artist=<id>`), and a collective's page with that collective (`?collective=<id>`). Either is ignored when it isn't a
known artist or collective. The application form says what's wrong with each field once it's left, like the artist form
(see [Artistes](artistes.md)): it checks the application as the server does (see
[Applications](../../server/applications.md)), for immediate feedback. The server's check is the one that counts: if it
refuses what the form accepted, the form shows the server's message.

## Endpoints

- `GET /api/admin/applications`, for the list, and `PUT /api/admin/applications/:id/status`, to change a status from it.
- `GET /api/admin/applications/:id`, `PUT /api/admin/applications/:id`, `PUT /api/admin/applications/:id/status` and
  `DELETE /api/admin/applications/:id`, for an application's page.
- `POST /api/admin/applications`, for "nouvelle candidature".
- `GET /api/admin/artists` and `GET /api/admin/collectives`, for the names, cities and genres of artists and collectives
  in the list, to search the applications by them, and to pick who a new application is for.
- `GET /api/admin/artists/:id`, for the artist on an application's page, or `GET /api/admin/collectives/:id` and
  `GET /api/admin/artists?collective=<id>`, for the collective and its genres.
