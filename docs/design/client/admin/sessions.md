# Sessions

At `/admin/sessions`: the sessions at the studio and their sets: who played, when, and where their recordings are (see
[Sessions](../../server/sessions.md)). A session's status is shown as "planifiée" (planned), "jouée" (done) or "annulée"
(cancelled), and a set's as "planifié", "joué" or "annulé". The rows of sessions and sets are colored by status (see
[Status colors](layout.md#status-colors)). Whether a session is announced (see
[Announced](../../server/sessions.md#announced)) is shown as "annoncée" or "non annoncée". A session's type is shown
as "Guest mixes", "Live performance", "Takeover", "Synth meetup" or "Autre" (see
[Types and names](../../server/sessions.md#types-and-names)).

## Names

A session is called by its title, which the server gives: its own name, or else the one its type gives it (see
[Types and names](../../server/sessions.md#types-and-names)). Where it's named along with others, e.g. in an error, its
day follows, e.g. "HAUTE RIVE TAKEOVER, sam. 14 nov. 2026".

A set is called by its performers, e.g. "Set de Aurore, Brume et Écume", or "Set" once they're all deleted. Where it's
named outside its session's page, e.g. in an error, its session's title and day follow, e.g. "Set de Aurore, HAUTE RIVE
TAKEOVER, sam. 14 nov. 2026". Within a sentence, it's "le set de Aurore", or "le set" once its performers are all
deleted.

## Times

Times are shown and entered in Québec time ("heure du Québec"), whatever the browser's time zone, since that's where
the studio is. A session whose date isn't known yet (see [Times](../../server/sessions.md#times)) shows "date à
déterminer" in place of its day, and its duration in place of its times, e.g. "4 h". Sets have no times, only their
order and their durations (see [Sets' order](../../server/sessions.md#sets-order)): a set's duration is shown e.g.
"1 h 30", or "à déterminer" when it isn't known. Durations are in hours and minutes, even those longer than a day, e.g.
"56 h".

A session's times are written:

- in full, e.g. on its page: "samedi 14 novembre 2026, de 21 h à 23 h", or "samedi 14 novembre 2026, de 21 h à 1 h le
  lendemain" when it ends the next day, at any time, or else "du vendredi 13 novembre 2026 à 18 h au dimanche 15
  novembre 2026 à 2 h";
- in short, e.g. in lists, after its day: "21 h – 1 h", when it ends the day it starts, or the next day at an earlier
  time than it starts, or else with the day it ends, without its year, e.g. "18 h – dim. 15 nov., 2 h", or
  "21 h – dim. 15 nov., 21 h" for a session of 24 hours.

The forms take a session's start and its end each as a day and a time of day, in the 24-hour format (see
[Architecture](../architecture.md)), and turn them into what the server takes (see
[Times](../../server/sessions.md#times)):

- A session's start is refused when the clocks skip it, as they spring forward, and is the first of the two when they
  show it twice, as they fall back.
- Its end likewise is refused when the clocks skip it, and is the first of the two that's after the start when they
  show it twice. An end that isn't after the start is refused, « La fin doit être après le début. »: it's never moved
  to another day.
- A start, or an end, left as the form opened with it stands for what it stood for, e.g. the start of a session at the
  second 1 h 30 of the night clocks fall back, so that changing something else never moves it.

Durations are entered in hours and minutes, as two numbers.

## The list

The section lists the sessions, each with its day ("Date"), linking to its page, its times, in short ("Heure", see
[Times](#times)), its title ("Nom"), its type ("Type"), which for a takeover links to its collective, its sets'
performers ("Artistes"), set by set in their order, the sets separated by "·", each artist linking to their page, its
status, and "annoncée" for an announced session ("Annonce").
Buttons above the list show only the sessions with a status, or all of them ("toutes"), with how many there are of each.
It opens on "planifiées", its default view (see [Searching lists](layout.md#searching-lists)), by date, the earliest
first, past ones included, then those without a date, the first added first. With another status or "toutes", those
without a date come first, the most recently added first, then the others, the latest first. Another group of buttons,
"Annonce", shows only the sessions that are announced ("annoncées"), or those that aren't ("non annoncées"), or both
("toutes"), which it opens on, and which its address leaves out (`announced=true`, `announced=false`, or nothing).

A field above the list searches the sessions (see [Searching lists](layout.md#searching-lists)) by their title, their
type, their takeover's collective, their sets' performers, and their day, written out (e.g. "samedi 14 novembre 2026",
which "14 nov" finds), or "date à déterminer". Clicking "Date" (`date`, by start, sessions without a date being later
than any other, then by when they were added), "Nom" (`name`, by title) or "Statut" (`status`: planifiée, jouée, then
annulée) sorts the list by that column, and clicking it again sorts it the other way around. The buttons of each group
count the sessions that the search, and the other group's buttons, find.

## A session's page

Clicking a session opens it at `/admin/sessions/<id>`, titled as it's called (see [Names](#names)). Under the title, it
says who added it and when, and who last changed it and when, if anyone did. From top to bottom, it then shows:

- "Statut": the status, as buttons that change it, and which admin last changed it, and when. Cancelling a session with
  sets that aren't cancelled first asks to confirm, saying that they'll be cancelled too (see
  [Status](../../server/sessions.md#status)). Marking it "jouée" while it has "planifié" sets first asks to confirm too,
  saying that they'll be marked "joué", « Les sets planifiés seront aussi marqués comme joués : », or « Le set planifié
  sera aussi marqué comme joué : » for one, then naming each one on a line of its own, e.g. « • Set de Aurore », then
  asking « Marquer la session comme jouée ? ». Under it, likewise, whether the session is announced, as "non annoncée"
  and "annoncée". Each says why it couldn't be changed under its own buttons. While the session has no date,
  "annoncée" can't be used, and says « La session n'a pas de date. » (see
  [Controls that can't be used](layout.md#controls-that-cant-be-used)).
- "Session": the session's details, which "modifier" changes in a form in their place (see
  [The session form](#the-session-form)):
  - "Quand": when it is, in full (see [Times](#times)), e.g. "samedi 14 novembre 2026, de 21 h à 1 h le lendemain", or
    "date à déterminer".
  - "Durée": how long it lasts.
  - "Type": its type.
  - "Takeover de", for a takeover: its collective, linking to it.
  - "Candidature", for a takeover: the application it comes from, linking to its page, and named by when it was
    received, e.g. "reçue le 1 septembre 2026". "-" when it has none.
  - "Nom": its title, faded out when it's the name its type gives it.
  - "Description": its description, with its line breaks, faded out when it's the one its type gives it. "-" when it has
    none.
  - "Flyer": its flyer. When it has none, "Pas de flyer" is shown instead, so that the team notices.
  - "Événement RA": its event on RA, linking to it, or "-" when it has none. "créer" opens a panel under it that creates
    the event (see [Creating its event on RA](#creating-its-event-on-ra)).
- "Sets": its sets, in their order (see [Sets' order](../../server/sessions.md#sets-order)). Each set is a row with:
  - "Durée": its duration.
  - "Artistes": its performers, each linking to their page, or "-" once they've all been deleted.
  - "Prestation": its performance types.
  - "Genres": its genres.
  - "Liens": "SoundCloud" and "YouTube", each linking to the recording, then "Candidature", linking to the page of the
    application the set comes from. Screen readers name that last link by when the application was received, e.g.
    "Candidature reçue le 1 septembre 2026".
  - Its status, as buttons that change it.
  - "↑" and "↓", which move it one place up or down among the session's sets, like a set's artists (see
    [A set's form](#a-sets-form)), even while the session is cancelled. The first set's "↑" and the last one's "↓"
    can't be used.
  - "modifier", which opens its form (see [A set's form](#a-sets-form)).
  - "×", which deletes it for good, after confirming. Its artists stay.

  Changing a set's status, or deleting one, can make the session "jouée" (see
  [Status](../../server/sessions.md#status)).

  When a status can't be changed, or a set can't be moved or deleted, the section says why above the sets, naming the
  set.
  "ajouter un set" opens the form of a new set.

  While the session is cancelled, "ajouter un set" can't be used, and says « La session est annulée : on ne peut pas lui
  ajouter de set. ». Its sets' "planifié" and "joué" can't be used either, and say « La session est annulée : on ne peut
  pas rétablir ses sets. » (see [Controls that can't be used](layout.md#controls-that-cant-be-used)).

  When the sets' durations add up to more than the session's, cancelled sets included and unknown durations counting
  for nothing (see [Sets' order](../../server/sessions.md#sets-order)), the section warns of it above the sets (see
  [Warnings](layout.md#warnings)), e.g. « ⚠ Les sets durent 4 h 58, plus que la session (1 h). ». The warning doesn't
  prevent anything, since a session and its sets are changed one at a time.
- "Supprimer": deletes the session, its flyer and its sets for good, after confirming. Its sets' artists, and its
  takeover's collective, stay, which the page says of those it has.

Only one form is open at a time on a session's page, the session's, the panel of its event on RA (see
[Creating its event on RA](#creating-its-event-on-ra)), or a set's: opening one closes the other, losing what wasn't
saved.

What the page's address opens, `?raEvent` (see [Creating its event on RA](#creating-its-event-on-ra)) or `?application`
(see [From an application](#from-an-application)), stays in it until the admin opens a form or closes one, the one it
opened included, whether it's saved or cancelled. It's then removed from the address, in place, so that reloading the
page, or coming back to it, doesn't open it again.

## Creating its event on RA

While a session has no event on Resident Advisor, "créer", after its "Événement RA", opens a panel under it, to create
the event on RA, with the bookmarklet or by hand, from the content the server gives (see
[Events on RA](../../server/sessions.md#events-on-ra)), and save it as the session's:

- « Publier sur RA », which opens RA's form, for the bookmarklet that creates the event (see
  [Publier sur RA](publier-sur-ra.md)). It can't be used while the session has no date, saying « La session n'a pas de
  date. », or is cancelled, saying « La session est annulée. » (see
  [Controls that can't be used](layout.md#controls-that-cant-be-used)), and waits for the content to be read and for the
  environment to be known. Outside production, a warning in red follows it: « Attention : l'événement sera vraiment créé
  sur RA, à partir d'une session de TEST. », with the environment's stamp (see
  [Environment](../architecture.md#environment)).
- A sentence says that « Publier sur RA » opens RA, where the bookmarklet creates the event, linking to Configuration
  for it, or to create the event on RA (linking to RA's form, `https://ra.co/pro/event/create`) with these fields, then
  to paste its link below.
- The event's title ("Titre"), when it is ("Quand"), written like the session's, its lineup ("Line-up"), one performer
  per line, Parking Radio's venue ("Salle") and promoter page ("Promoteur") on RA, each linking to it, and its
  description ("Description"), whole, with its line breaks, or "-" when it has none. A "copier" button, after the first
  line of the title, the lineup and the description, copies it, then says "copié", or "échec de la copie", for a
  moment: the times, the venue and the promoter are picked in RA's form rather than typed. The content is read when the
  panel opens, and again whenever the session or its sets change, and the panel says when it can't be read.
- "Lien de l'événement RA": the event's link, or its number, as a session's `raEvent` takes it (see
  [Links](../../server/sessions.md#links)), with or without its `https://`. "enregistrer" saves it as the session's
  event on RA, which then shows in place of the panel, and "annuler" closes the panel. Saving only changes the session's
  event, and leaves its other fields as they are, even if they changed since the page loaded (see
  [Changes, in Conventions](../../server/README.md#conventions)). An empty field, or one that isn't an event's link,
  says so, and sends nothing.

Once the session has its event on RA, its "Événement RA" only links to it: "modifier" still changes it.

When the bookmarklet leads back to the session's page with the event it created on RA, `?raEvent=<id>`, the page opens
the panel, while the session has no event on RA, with the event's link in its field, under a notice, « L'événement RA n°
<id> vient d'être créé sur RA : enregistrez-le dans la session. ». Only « enregistrer » saves it (see
[Back to the session](publier-sur-ra.md#back-to-the-session)).

## The session form

"nouvelle session" adds a session, as planned, with its sets (see [A new session's sets](#a-new-sessions-sets)), at
`/admin/sessions/nouvelle`, then goes to its page. A new session starts without a type, which has to be picked. A
collective's page leads to it as its takeover, with "Takeover" and the collective picked (`?takeover=<id>`), unless it
isn't one of the collectives loaded, e.g. when they can't be loaded, in which case nothing is picked. From top to
bottom, the form has:

- "Quand": "Début" and "Fin", each a "date" and an "heure", in Québec time (see [Times](#times)), then how long the
  session lasts, e.g. « Dure 4 h. », once they're valid. The end's date keeps its distance in days from the start's:
  when the start's date changes to another day, the end's moves by as many days, from the last day the start had, even
  if its date was cleared in between, e.g. while it's typed. When the start's date changes while the end has none, the
  end takes it. Changing the end's date only changes that distance. Or, with "date à déterminer" checked, only
  "Durée". Checking it fills the duration in from the times, when they're valid. Once the start has both its date and
  its time, whichever is entered last, and the clocks show that time, an empty end time is filled in, with its date, as
  long after the start as the duration the form has, if it has one: the one "Durée" had, e.g. after un-checking "date à
  déterminer", or else the session's as the form opened. The form doesn't check that the session's sets still add up
  to no more than the session once it's shorter: the session's page then warns of it (see
  [A session's page](#a-sessions-page)). While the session is announced, checking "date à déterminer" shows an error
  right away, which screen readers announce, « Une session annoncée a une date : retirez d'abord son annonce. », and the
  form can't be sent until it's un-checked.
- "Type": "Guest mixes", "Live performance", "Takeover", "Synth meetup" or "Autre", one of which is picked, as radio
  buttons, in this order.
- "Collectif", only for a takeover, which has to have one: the collective whose takeover the session is, picked from the
  collectives of [Artistes](artistes.md). Picking another type and then "Takeover" again, while the form is open, finds
  the collective that was picked; the server is only sent one for a takeover.
- "Candidature", only for a takeover, like "Collectif": the application the session comes from, picked from its
  collective's applications, or "Aucune candidature" (see [Applications](#applications)). Like the collective, it's
  kept while another type is picked, and comes back when "Takeover" is picked again. Saving the session as another type
  removes it.
- "Nom": the session's own name, as free text, which an "Autre" needs, and which replaces the name the other types
  give (see [Types and names](../../server/sessions.md#types-and-names)). For those types, that name shows in the
  empty field ("NOM DU COLLECTIF TAKEOVER" until a takeover's collective is picked). For "Autre", or before a type is
  picked, the field shows an example, "p. ex. LISTENING PARTY". The name is sent as it's typed, its case included.
- "Description": the session's own description, as plain text on several lines, which replaces the one its type
  gives (see [Descriptions](../../server/sessions.md#descriptions)). For the types that give one, that description shows
  in the empty field, and, while the field doesn't hold it, "reprendre le texte par défaut" fills the field with it, so
  that a few words of it can be changed, which makes it the session's own.
- "Flyer": the session's flyer, like an artist's photo (see [An artist's page](artistes.md#an-artists-page)): an ×
  removes it once the session is saved, and a flyer that's chosen replaces it. It's checked as soon as it's chosen, as
  the server checks it (see [Flyers](../../server/sessions.md#flyers)).
- "Événement RA": picked from every one of Parking Radio's events, past ones included, read from RA (see
  [Events](../../server/events.md)), or "Aucun événement RA", which leaves it out. Each event is shown by its title and
  the day it starts on in Québec, e.g. "GUEST MIXES, sam. 14 nov. 2026", with its number on RA, e.g. "n° 6683745", the
  upcoming ones first, the soonest first, then the past ones, the most recent first. The field searches them by their
  title and their day, written out (e.g. "samedi 14 novembre 2026", which "14 nov" finds), as the lists are searched
  (see [Searching lists](layout.md#searching-lists)), and, when only digits are typed, by their number too, or part of
  it, exactly (e.g. "2026" finds the events of 2026, and those whose number has "2026" in it), since Parking Radio's
  numbers are close to each other. A link to an event's page on RA, as a session's `raEvent` takes it (see
  [Links](../../server/sessions.md#links)), with or without its `https://`, finds that event, or nothing when it isn't
  offered. "Aucun événement RA" is found by what it shows, and the session's own event, when it isn't among those read
  (see below), by "Événement RA" and by its number, like the others. Once an event is picked, the form links to its page
  on RA, showing its address, like the session's page. The session's own event, when it isn't among those read from RA,
  e.g. another promoter's (see [Links](../../server/sessions.md#links)), is offered too, as "Événement RA n° 6683745",
  so that the session keeps it unless another one is picked. The form doesn't wait for RA: until the events are read, or
  when they can't be, only the session's own event and "Aucun événement RA" can be picked, and the form says when they
  couldn't be.

When the collectives can't be loaded, the form says so: the session's collective stays, but another one can't be picked.

### A new session's sets

After its fields, a new session's form has its sets, which are only sent with it. They're added, changed and listed as
on a session's page (see [A set's form](#a-sets-form)), except that:

- Their rows have no status. Their links open in a new tab. Once the session's times are valid, the list says when the
  sets add up to more than the session, with the same warning as a session's page. "↑" and "↓" move a set in the list,
  which is the order they're added in, and "×" takes it out of the list, without confirming.
- While the session's times aren't valid, its duration isn't known: a new set then lasts an hour by default. A new
  set's form keeps the duration it opened with, even once the session's times change.
- "ajouter la session" can't be used while a set's form is open, saying « Ajoutez d'abord le set, ou annulez-le. »,
  or « Enregistrez d'abord le set, ou annulez-le. » for a listed set's, and the sets can't be changed while it's sent.

## A set's form

A set's form opens under the sets, as a new one's ("ajouter le set") or a set's ("enregistrer"), and "annuler" closes
it. A set's form also says who added it and when, who last changed it and who last changed its status, and when. From
top to bottom, the form has:

- "Artistes": the performers, in order, at least one, which can be reordered and removed like a collective's artists
  (see [Adding a collective](artistes.md#adding-a-collective)), each picked from the artists of
  [Artistes](artistes.md). The set's performers are offered too, greyed out and marked "déjà dans le set", but can't be
  picked. Performers can't be created by typing a name: they're added in Artistes first.
- "Candidature": the application the set comes from, picked from its performers' applications, or "Aucune
  candidature" (see [Applications](#applications)).
- "Durée": how long the set lasts, in hours and minutes (see [Times](../../server/sessions.md#times)), or empty while it
  isn't known. It doesn't check that the sets still add up to no more than the session: the list of sets warns of it
  (see [A session's page](#a-sessions-page)). A new set, which goes after the session's other sets, lasts an hour by
  default, or what's left of the session after its sets, cancelled ones included, if that's less. When the session's
  sets fill it, "Durée" starts empty.
- "Prestation": what the performers do, picked from the same list as the application form's (see
  [Candidatures](candidatures.md)), and "Autre", in a few words.
- "Genres": tags to click, like an artist's (see [Adding an artist](artistes.md#adding-an-artist)). While it has none,
  and its performers have some, "reprendre les genres des artistes" pins its performers' first genres, in the order of
  [a collective's genres](artistes.md#a-collectives-genres), up to 3.
- "SoundCloud" and "YouTube": links to the set's track and video (see [Links](../../server/sessions.md#links)).

When the artists can't be loaded, the form says so: the set's performers stay, but others can't be picked.

## Applications

A set or a session can come from an application (see [Applications](../../server/sessions.md#applications)). Its form
picks that application in "Candidature", which offers "Aucune candidature" first, then:

- in a set's form, its performers' applications, artist by artist, in the order of the performers;
- in a takeover's form, its collective's applications.

Each artist's or collective's applications are listed newest first, by when they were received. In a set's form, an
option names the artist and when the application was received, e.g. "Aurore, reçue le 15 août 2026". In a takeover's form, it only
says when, e.g. "Reçue le 1 septembre 2026". Each option then shows the application's status and the first few days the
artist would like to play, written as [Candidatures](candidatures.md) lists them, e.g. "retenue · 14 nov. 2026, 21 nov.
2026".

When there's nothing to pick, the field says why: "Choisissez d'abord les artistes." or "Choisissez d'abord le
collectif." when none are picked yet, or else "Aucune candidature de cet artiste.", "Aucune candidature de ces
artistes." or "Aucune candidature de ce collectif.".

The set's or the session's own application is always among the options, and so is the one picked. That's true even
when it no longer belongs to the performers or the collective, e.g. once its artist is taken out of the set.

The forms never remove the application on their own. When the set's performers, or the takeover's collective, change
so that the application isn't theirs anymore, the field shows an error right away, which screen readers announce, e.g.
« La candidature doit être celle d'un des artistes du set : choisissez-en une autre, ou « Aucune candidature ». ». The
form can't be sent until another application, or "Aucune candidature", is picked. The one exception is a session saved
as another type than a takeover: it loses its application, as it loses its collective (see
[The session form](#the-session-form)).

The applications are loaded each time a form opens, along with the artists or the collectives. When they can't be
loaded, the form says so above it, and only "Aucune candidature" and the set's or the session's own application, named
by when it was received, can be picked. The form then can't tell whose an application is, so the server's check is the
one that counts (see [Errors](#errors)).

## From an application

An application's page leads to a session's page, or to "nouvelle session", with the application, `?application=<id>`
(see [Candidatures](candidatures.md)), whose forms then start from it:

- On a session's page, unless the session is cancelled, a new set's form opens, filled in from the application: its
  artist as the only performer, its performance types and "autre", and the application itself. The page scrolls to the
  form, whose heading gets the focus.
- On "nouvelle session", an artist's application lists a set, filled in the same way, whose duration isn't known yet. A
  collective's application makes the session its collective's takeover, in place of `?takeover`, with the application
  picked. Above the form, the application's days and time slots are shown as its page shows them, with a link to it,
  which opens in a new tab: they don't fill in the session's times.

An application that doesn't exist, or a collective's on a session's page, is ignored, like a `?takeover` that isn't a
known collective. The application and its artist are looked for among those loaded for the form (see
[Endpoints](#endpoints)): when they can't be loaded, the page says so, and opens a new set's form, or "nouvelle session",
as it would without the application.

## Errors

The forms say what's wrong with each field once it's left, like the artist form (see [Artistes](artistes.md)): they
check sessions and sets as the server does, for immediate feedback, but not the rules that involve other sessions or
sets, e.g. sessions that overlap (see [Rules](../../server/sessions.md#rules)). The server's check is the one that
counts: if it refuses what the form accepted, the form shows the server's message. When the server names what's in the
way, the message names it (see [Names](#names)) and links to its session's page, unless that's the page it's on: a set
of the session whose page this is is named as on its page, without a link, and the session itself isn't named. Changing
a status, or whether the session is announced, shows these the same way.

An error about one of a new session's sets names it, e.g. « Le set de Aurore n'a pas pu être ajouté : … », and another of
its sets in the way is named without a link.

## Endpoints

- `GET /api/admin/sessions`, for the list.
- `GET /api/admin/sessions/:id`, `PUT /api/admin/sessions/:id`, `PUT /api/admin/sessions/:id/status`,
  `PUT /api/admin/sessions/:id/announced` and `DELETE /api/admin/sessions/:id`, for a session's page.
- `GET /api/admin/sessions/:id/flyer`, for its flyer, on its page and in its form.
- `GET /api/admin/sessions/:id/ra-event`, for the content of its event on RA, in the panel that creates it, and
  `PATCH /api/admin/sessions/:id`, to save the event as the session's.
- `POST /api/admin/sessions`, for "nouvelle session".
- `POST /api/admin/sessions/:id/sets`, `PUT /api/admin/sets/:id`, `PUT /api/admin/sets/:id/status`,
  `PUT /api/admin/sets/:id/position` and `DELETE /api/admin/sets/:id`, for its sets.
- `GET /api/admin/collectives`, in the session form, to pick a takeover's collective, and `GET /api/admin/artists`, in a
  set's form, to pick the performers and suggest their genres, each time the form opens.
- `GET /api/admin/applications`, in both forms, to pick the application they come from, each time the form opens, and
  on "nouvelle session", along with `GET /api/admin/artists`, to find the application of `?application`, and its
  artist.
- `GET /api/events`, in the session form, to pick the event on RA, each time it opens, from the year 2000 on, to get
  every one (see [Time ranges](../../server/events.md#time-ranges)).
