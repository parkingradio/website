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

Clicking an application opens it at `/admin/candidatures/<id>`, with the list's status, search and order in its address,
as the list's own address has them, and the status even for the default view (see
[Searching lists](layout.md#searching-lists)). Only the links of this list have them: elsewhere, e.g. on an artist's
page, links to applications have none. Above its title, links lead back to the list and go through it (see
[Going through the list](#going-through-the-list)). Under its title, it says when it was received (unless that's the day
it was created), who created it and when, or that it was sent through the form, and who last changed it and when, if
anyone did. From top to bottom, it then shows:

- "Statut": the status, as buttons that change it, and which admin last changed it, and when.
- "Artiste" or "Collectif": the artist's or the collective's photo and profile, as their page shows them (see
  [An artist's page](artistes.md#an-artists-page) and [A collective's page](artistes.md#a-collectives-page)), starting
  with their name, which links to their page. It leaves out who added them and who last changed them, and what their
  page shows under their profile, e.g. their applications.
- "Candidature": everything in the application, and a button that changes it, including the day it was received, in a
  form that takes the place of everything under the title until it's saved or cancelled.
- "Sets", for an artist's application, or "Sessions", for a collective's: the sets or sessions that come from it (see
  [Applications, in Sessions](../../server/sessions.md#applications)), in the server's order. Each row shows the day
  ("Date"), the times ("Heure", written as on a session's page, see [Times](sessions.md#times)) and the status
  ("Statut"). A set also shows its session's title ("Session"), which links to the session's page. A session shows its
  own title ("Nom"), and its day links to its page. When there are none, the section says so, and that they're linked
  from the form of one of the artist's sets, or of one of the collective's takeovers (see
  [Applications](sessions.md#applications)). They can't be changed from here.
- "Supprimer": deletes the application for good, after confirming, then shows the list, as "← candidatures" leads to it
  (see [Going through the list](#going-through-the-list)). The artist or the collective stays, and so do the sets or
  sessions that come from it. When there are some, the page says « Les sets associés restent. » or « Les sessions
  associées restent. ».

"nouvelle candidature" creates an application by hand, at `/admin/candidatures/nouvelle`, e.g. to bring in one that came
through the original Google Form: a form with the artist or the collective, picked in a single field from those in the
"Artistes" section, where collectives say so, the day the application was received (today if it's left empty), sent as
its midnight in Québec time, then the application itself. An artist's page leads to it with that artist picked already
(`?artist=<id>`), and a collective's page with that collective (`?collective=<id>`). Either is ignored when it isn't a
known artist or collective. The application form says what's wrong with each field once it's left, like the artist form
(see [Artistes](artistes.md)): it checks the application as the server does (see
[Applications](../../server/applications.md)), for immediate feedback. The server's check is the one that counts: if it
refuses what the form accepted, the form shows the server's message.

## Going through the list

Above an application's title, "← candidatures" leads back to the list, and across from it, « ← précédente » and
« suivante → » lead to the applications before and after this one in the list, without going back to it. Between them,
the page says where this one is in the list, written « 3 / 12 » and read « 3 sur 12 » by screen readers. All three keep
the status, search and order of the application's address in theirs, with the default view's status when it has none,
or one that the list doesn't know (see [Searching lists](layout.md#searching-lists)).

When the application's address has a status that the list knows, `all` included, as when it was opened from the list,
the page goes through the applications that the list shows with the address's status, search and order. Otherwise, e.g.
when it's opened from an artist's page or a session's, it goes through the default view, but only if the application
was new when its page opened. If it wasn't, e.g. for one that's done, the page has neither « précédente » and
« suivante » nor where the application is, since it has nothing to do with the new ones.

The application's place, and the ones before and after it, are those of the list when its page opens, where the
application keeps its place in the list's order even when the list doesn't show it, e.g. once it's been accepted while
going through the new ones, so that coming back to it, e.g. with the browser's back button, finds it where it was. What
changes on the page, e.g. its status, doesn't move it. Another application that has left the list since is skipped,
though: after accepting the 5th of 12 new applications, « suivante » shows the next one as the 5th of 11, and its
« précédente » leads to the 4th.

The first application's « précédente » and the last one's « suivante » can't be used, saying « C'est la première
candidature de la liste. » and « C'est la dernière candidature de la liste. » (see
[Controls that can't be used](layout.md#controls-that-cant-be-used)). While the list loads, and while the application
loads when its address has a status, both are only greyed out, and the page doesn't say yet where the application is.
When the applications, the artists or the collectives can't be loaded, the page says so in their place. They stay while
the application is changed in its form, which they leave, like "← candidatures", losing what wasn't saved.

## Endpoints

- `GET /api/admin/applications`, for the list, and on an application's page, for « précédente » and « suivante », and
  `PUT /api/admin/applications/:id/status`, to change a status from the list.
- `GET /api/admin/applications/:id`, `PUT /api/admin/applications/:id`, `PUT /api/admin/applications/:id/status` and
  `DELETE /api/admin/applications/:id`, for an application's page.
- `POST /api/admin/applications`, for "nouvelle candidature".
- `GET /api/admin/artists` and `GET /api/admin/collectives`, for the names, cities and genres of artists and collectives
  in the list, to search the applications by them, also for « précédente » and « suivante » on an application's page,
  and to pick who a new application is for.
- `GET /api/admin/artists/:id` and `GET /api/admin/artists/:id/photo`, for the artist on an application's page, or
  `GET /api/admin/collectives/:id`, `GET /api/admin/collectives/:id/photo` and `GET /api/admin/artists?collective=<id>`,
  for the collective, its photo and its genres.
