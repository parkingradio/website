# Candidatures

At `/admin/candidatures`: the applications of artists and collectives for a set, for the team to go through (see
[Applications](../../server/applications.md)). Each application's status is shown as "nouvelle" (new), "retenue"
(accepted), "planifiée" (planned), "jouée" (done) or "refusée" (rejected) (see
[Status, in Applications](../../server/applications.md#status)). Wherever applications are listed, their rows
are colored by status (see [Status colors](layout.md#status-colors)), and "nouvelle" is in bold. What the artist would do
is picked from a list, and shown by its name, the same on the "Appliquer" form and on the admin pages, plus "autre" in a
few words.

The section lists the applications, each with when it was received ("reçue le"), the artist or the collective, followed
by "(collectif)" for a collective, their city and genres (see
[A collective's genres](artistes.md#a-collectives-genres)), the first few dates, the performance types and the status,
as a dropdown that changes it, without confirming, to those it can be given (see [Statuses](#statuses)), or only its
name for a "planifiée" or "jouée" application, which its sets or sessions make so.
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
artist would like to play) or "Statut" (`status`: nouvelle, retenue, planifiée, jouée, then refusée) sorts the list by
that column, and clicking it again sorts it the other way around. The status buttons count the applications the search
finds.

Clicking an application opens it at `/admin/candidatures/<id>`, with the list's status (even for the default view),
search and order in its address (see [Going through the list](#going-through-the-list)). Under its title, it says when
it was received (unless that's the day it was created), who created it and when, or that it was sent through the form,
and who last changed it and when, if anyone did. From top to bottom, it then shows:

- "Statut": the five statuses, as buttons, the application's in black (see [Status colors](layout.md#status-colors)),
  where those it can be given change it (see [Statuses](#statuses)), and the others are greyed out, saying why (see
  [Controls that can't be used](layout.md#controls-that-cant-be-used)), e.g. « Une candidature est planifiée quand un de
  ses sets est planifié. ». Under them, which admin last changed what was decided, and when, unless its sets or sessions
  make it "planifiée" or "jouée", which no admin chose.
- "Artiste" or "Collectif": the artist's or the collective's photo and profile, as their page shows them (see
  [An artist's page](artistes.md#an-artists-page) and [A collective's page](artistes.md#a-collectives-page)), starting
  with their name, which links to their page. It leaves out who added them and who last changed them, and what their
  page shows under their profile, e.g. their applications.
- "Candidature": everything in the application, and a button that changes it in a form in its place, including the day
  it was received.
- "Sets", for an artist's application, or "Sessions", for a collective's: the sets or sessions that come from it (see
  [Applications, in Sessions](../../server/sessions.md#applications)), in the server's order. Each row shows the day
  ("Date") and the status ("Statut"). A set also shows its session's title ("Session"), which links to the session's
  page, and its duration ("Durée"). A session shows its times ("Heure"), and its own title ("Nom"), and its day links to
  its page. Times are written in short, and durations as everywhere else (see [Times](sessions.md#times)). When there are
  none, the section says so. They can't be changed from here. An artist's application's "Sets" has "créer un set", which
  opens a field that picks the session to add a set to: "nouvelle session", then the planned sessions, past ones and
  those without a date included, first those on one of the days the artist would like to play, by date, marked "date
  souhaitée", then the others, in the order of the default view of [the list of sessions](sessions.md#the-list). Each
  one is named as sessions are among others (see [Names](sessions.md#names)), with its times as that list's "Heure"
  shows them, and the field searches them as that list does. "créer le set" then leads to the session's page, or to
  "nouvelle session", with the application (see [From an application](sessions.md#from-an-application)): it can't be
  used until a session is picked, saying « Choisissez d'abord une session. ». "annuler" closes the field. When the
  sessions can't be loaded, the field says so, and only offers "nouvelle session". A collective's application's
  "Sessions" has "créer une session", which leads to "nouvelle session" with the application. Neither can be used while
  the application is rejected, since its new set or session would be planned (see
  [Applications, in Sessions](../../server/sessions.md#applications)), saying « Une candidature refusée ne peut pas avoir
  de set ou de session planifié. ».
- "Supprimer": deletes the application for good, after confirming, then shows the list as "← candidatures" does. The
  artist or the collective stays, and so do the sets or sessions that come from it. When there are some, the page says
  « Les sets associés restent. » or « Les sessions associées restent. ».

"nouvelle candidature" creates an application by hand, at `/admin/candidatures/nouvelle`, e.g. to bring in one that came
through the original Google Form: a form with the artist or the collective, picked in a single field from those in the
"Artistes" section, where collectives say so, the day the application was received (today if it's left empty), sent as
its midnight in Québec time, then the application itself. An artist's page leads to it with that artist picked already
(`?artist=<id>`), and a collective's page with that collective (`?collective=<id>`). Either is ignored when it isn't a
known artist or collective. The application form says what's wrong with each field once it's left, like the artist form
(see [Artistes](artistes.md)): it checks the application as the server does (see
[Applications](../../server/applications.md)), for immediate feedback. The server's check is the one that counts: if it
refuses what the form accepted, the form shows the server's message.

## Statuses

Admins only give an application what they decide, "nouvelle", "retenue" or "refusée" (see
[Status, in Applications](../../server/applications.md#status)), and only when it's then the status it shows: nothing
while its sets or sessions make it "planifiée" or "jouée", and not "nouvelle" while it has sets or sessions, all of them
cancelled, which keep it "retenue".

## Going through the list

Above an application's title, "← candidatures" leads back to the list. When the application's address has a status that
the list knows (see [Searching lists](layout.md#searching-lists)), as the list's links give it, it shows the list with
the address's status, search and order, and « ← précédente » and « suivante → » lead to the applications before and
after this one in it, keeping them in their address, with this one's place between them, e.g. « 3 / 12 » (« 3 sur 12 »
for screen readers). The first one's « précédente » and the last one's « suivante » can't be used, saying « C'est la
première candidature de la liste. » and « C'est la dernière candidature de la liste. » (see
[Controls that can't be used](layout.md#controls-that-cant-be-used)). When the applications, the artists or the
collectives can't be loaded, the page says so in their place. Without such a status, e.g. from an artist's page,
"← candidatures" shows the list as it opens, and the page has nothing else to go through it.

The list is the one when the page opens, where the application keeps its place in the list's order even when the list
doesn't show it, e.g. once it's been accepted while going through the new ones. Other applications that have left it
are skipped: after accepting the 5th of 12 new applications, « suivante » shows the next one as the 5th of 11, and its
« précédente » leads to the 4th.

## Endpoints

- `GET /api/admin/applications`, for the list, and on an application's page, for « précédente » and « suivante », and
  `PUT /api/admin/applications/:id/decision`, to change a status from the list.
- `GET /api/admin/applications/:id`, `PUT /api/admin/applications/:id`, `PUT /api/admin/applications/:id/decision` and
  `DELETE /api/admin/applications/:id`, for an application's page.
- `GET /api/admin/sessions`, on an artist's application's page, to pick the session to add a set to, each time
  "créer un set" opens the field.
- `POST /api/admin/applications`, for "nouvelle candidature".
- `GET /api/admin/artists` and `GET /api/admin/collectives`, for the names, cities and genres of artists and collectives
  in the list, to search the applications by them, also for « précédente » and « suivante » on an application's page,
  and to pick who a new application is for.
- `GET /api/admin/artists/:id` and `GET /api/admin/artists/:id/photo`, for the artist on an application's page, or
  `GET /api/admin/collectives/:id`, `GET /api/admin/collectives/:id/photo` and `GET /api/admin/artists?collective=<id>`,
  for the collective, its photo and its genres.
