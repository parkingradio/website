# Sessions

At `/admin/sessions`: the sessions at the studio and their sets: who played, when, and where their recordings are (see
[Sessions](../../server/sessions.md)). A session's status is shown as "planifiée" (planned), "jouée" (done) or "annulée"
(cancelled), and a set's as "planifié", "joué" or "annulé". The rows of sessions and sets are colored by status (see
[Status colors](layout.md#status-colors)). A session's type is shown as "Guest mixes", "Live performance", "Takeover",
"Synth meetup" or "Autre" (see [Types and names](../../server/sessions.md#types-and-names)).

## Names

A session is called by its title, which the server gives: its own name, or else the one its type gives it (see
[Types and names](../../server/sessions.md#types-and-names)). Where it's named along with others, e.g. in an error, its
day follows, e.g. "HAUTE RIVE TAKEOVER, sam. 14 nov. 2026".

A set is called by its performers, e.g. "Set de Aurore, Brume et Écume", or "Set" once they're all deleted. Where it's
named outside its session's page, e.g. in an error, its session's title and its times follow, e.g.
"Set de Aurore, HAUTE RIVE TAKEOVER, sam. 14 nov. 2026, 21 h – 22 h". Within a sentence, it's "le set de Aurore, 21 h –
22 h", or "le set, 21 h – 22 h" once its performers are all deleted, with its times as its session's page shows them (see
[Times](#times)), e.g. "le set de Aurore, +1 h – +2 h 30" in a session without a date.

## Times

Times are shown and entered in Québec time ("heure du Québec"), whatever the browser's time zone, since that's where
the studio is, e.g. "sam. 14 nov. 2026, 21 h – 1 h". A session whose date isn't known yet (see
[Times](../../server/sessions.md#times)) shows "date à déterminer" in place of its day, and its duration in place of its
times, e.g. "4 h". Its sets' times are counted from its start, in hours and minutes, e.g. "+0 h – +1 h 30". A set whose
place in its session isn't known shows "horaire à déterminer", with its duration when it has one, e.g. "horaire à
déterminer (1 h)".

The forms take a session's day and times of day, in the 24-hour format (see [Architecture](../architecture.md)), and
turn them into what the server takes (see [Times](../../server/sessions.md#times)):

- A session's start is its day and its start time. A time that doesn't happen that day, as clocks spring forward, is
  refused, and one that happens twice, as they fall back, is the first of the two.
- Every other time is the first time, after the one it follows, when Québec's clocks show it, unless they skip it before
  showing it, in which case it's refused: a session's end, after its start; a set's start, from its session's start on,
  which it can be; a set's end, after the set's start. So an end time that isn't after the start time is the next day,
  and so is a set's start time that's before its session's.
- A time left as the form opened with it stands for what it stood for, e.g. the start of a set at the second 1 h 30 of
  the night clocks fall back, so that changing something else, even the set's end, never moves it. A new set's default
  place counts as what its form opened with.

Durations, and the times of the sets of a session without a date, are entered in hours and minutes, as two numbers.

## The list

The section lists the sessions, each with its day ("Date"), linking to its page, its start and end ("Heure"), its title
("Nom"), its type ("Type"), which for a takeover links to its collective, its sets' performers ("Artistes"), set by set
in their order, the sets separated by "·", each artist linking to their page, and its status.
Buttons above the list show only the sessions with a status, or all of them ("toutes"), with how many there are of each.
It opens on "planifiées", its default view (see [Searching lists](layout.md#searching-lists)), by date, the earliest
first, past ones included, then those without a date, the first added first. With another status or "toutes", those
without a date come first, the most recently added first, then the others, the latest first.

A field above the list searches the sessions (see [Searching lists](layout.md#searching-lists)) by their title, their
type, their takeover's collective, their sets' performers, and their day, written out (e.g. "samedi 14 novembre 2026",
which "14 nov" finds), or "date à déterminer". Clicking "Date" (`date`, by start, sessions without a date being later
than any other, then by when they were added), "Nom" (`name`, by title) or "Statut" (`status`: planifiée, jouée, then
annulée) sorts the list by that column, and clicking it again sorts it the other way around. The status buttons count
the sessions the search finds.

## A session's page

Clicking a session opens it at `/admin/sessions/<id>`, titled as it's called (see [Names](#names)). Under the title, it
says who added it and when, and who last changed it and when, if anyone did. From top to bottom, it then shows:

- "Statut": the status, as buttons that change it, and which admin last changed it, and when. Cancelling a session with
  sets that aren't cancelled first asks to confirm, saying that they'll be cancelled too (see
  [Status](../../server/sessions.md#status)).
- "Session": the session's details, which "modifier" changes in a form in their place (see
  [The session form](#the-session-form)):
  - "Quand": when it is, e.g. "samedi 14 novembre 2026, de 21 h à 1 h le lendemain", or "date à déterminer".
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
- "Sets": its sets, in the server's order. Each set is a row with:
  - "Heure": its times.
  - "Artistes": its performers, each linking to their page, or "-" once they've all been deleted.
  - "Prestation": its performance types.
  - "Genres": its genres.
  - "Liens": "SoundCloud" and "YouTube", each linking to the recording, then "Candidature", linking to the page of the
    application the set comes from. Screen readers name that last link by when the application was received, e.g.
    "Candidature reçue le 1 septembre 2026".
  - Its status, as buttons that change it.
  - "modifier", which opens its form (see [A set's form](#a-sets-form)).
  - "×", which deletes it for good, after confirming. Its artists stay.

  When a status can't be changed, or a set can't be deleted, the section says why above the sets, naming the set.
  "ajouter un set" opens the form of a new set.

  While the session is cancelled, "ajouter un set" can't be used, and says « La session est annulée : on ne peut pas lui
  ajouter de set. ». Its sets' "planifié" and "joué" can't be used either, and say « La session est annulée : on ne peut
  pas rétablir ses sets. » (see [Controls that can't be used](layout.md#controls-that-cant-be-used)).

  A set that isn't cancelled has a "⚠" after its times when it doesn't fit in the session, or overlaps another set that
  isn't cancelled (see [Sets' places](../../server/sessions.md#sets-places)). Its tooltip (see
  [Tooltips](layout.md#tooltips)) says why, one sentence per line:
  - first, « Commence après la session. » when the set starts at or after the session's end, « Finit après la
    session. » when it ends after it, or « Dure plus longtemps que la session. » when its place isn't known but it lasts
    longer than the session;
  - then « Chevauche le set de Cyan, 22 h – 23 h 30. » for each set it overlaps, in the order of the session's sets (see
    [Names](#names)).

  The "⚠" doesn't prevent anything, since times are changed one at a time.
- "Supprimer": deletes the session, its flyer and its sets for good, after confirming. Its sets' artists, and its
  takeover's collective, stay, which the page says of those it has.

Only one form is open at a time on a session's page, the session's, the panel of its event on RA (see
[Creating its event on RA](#creating-its-event-on-ra)), or a set's: opening one closes the other, losing what wasn't
saved.

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

"nouvelle session" adds a session, as planned, at `/admin/sessions/nouvelle`, then goes to its page, where its sets are
added. A new session starts without a type, which has to be picked. A collective's page leads to it as its takeover,
with "Takeover" and the collective picked (`?takeover=<id>`), unless it isn't one of the collectives loaded, e.g. when
they can't be loaded, in which case nothing is picked. From top to bottom, the form has:

- "Quand": "Date", "Début" and "Fin", in Québec time (see [Times](#times)), then how long the session lasts, and when
  it ends the next day. Or, with "date à déterminer" checked, only "Durée". Checking it fills the duration in from the
  times, when they're valid. Once a start time is entered after un-checking it, an empty end time is filled in that long
  after. The form says that the sets of a session move with it. It doesn't check that they still fit in it once it's
  shorter: the session's page then marks those that don't (see [A session's page](#a-sessions-page)).
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
- "Horaire": in a session with a date, "Début" and "Fin", in Québec time (see [Times](#times)), then how long the set
  lasts; in a session without one, "Début", in hours and minutes after the session's start, and "Durée", which is needed
  once there's a start. With "horaire à déterminer" checked, e.g. while the order of the sets isn't known, only "Durée",
  which can be left empty. A set starts at most 23 h 59 after its session's start, and lasts at most 24 h, which the
  form checks (see [Times](../../server/sessions.md#times)). The form says when the session is, and, in a session with a
  date, that the set « commence le lendemain » or « finit le lendemain » when its start or its end is on a later day
  than the session's start, since a start time before the session's is the next day's. It doesn't check that the set
  fits in the session, or doesn't overlap another set: the session's page marks those (see [A session's
  page](#a-sessions-page)). A new set starts by default when the last of the session's sets that isn't cancelled and
  whose place is known ends, or at the session's start when there's none, for an hour, or until the session ends if
  that's sooner. When the session's sets fill it, "Début" and "Fin" (or "Durée") start empty.
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

## Errors

The forms say what's wrong with each field once it's left, like the artist form (see [Artistes](artistes.md)): they
check sessions and sets as the server does, for immediate feedback, but not the rules that involve other sessions or
sets, e.g. sessions that overlap (see [Rules](../../server/sessions.md#rules)). The server's check is the one that
counts: if it refuses what the form accepted, the form shows the server's message. When the server names what's in the
way, the message names it (see [Names](#names)) and links to its session's page, unless that's the page it's on: a set
of the session whose page this is is named by its performers and times, without a link, and the session itself isn't
named. Changing a status shows these the same way.

## Endpoints

- `GET /api/admin/sessions`, for the list.
- `GET /api/admin/sessions/:id`, `PUT /api/admin/sessions/:id`, `PUT /api/admin/sessions/:id/status` and
  `DELETE /api/admin/sessions/:id`, for a session's page.
- `GET /api/admin/sessions/:id/flyer`, for its flyer, on its page and in its form.
- `GET /api/admin/sessions/:id/ra-event`, for the content of its event on RA, in the panel that creates it, and
  `PATCH /api/admin/sessions/:id`, to save the event as the session's.
- `POST /api/admin/sessions`, for "nouvelle session".
- `POST /api/admin/sessions/:id/sets`, `PUT /api/admin/sets/:id`, `PUT /api/admin/sets/:id/status` and
  `DELETE /api/admin/sets/:id`, for its sets.
- `GET /api/admin/collectives`, in the session form, to pick a takeover's collective, and `GET /api/admin/artists`, in a
  set's form, to pick the performers and suggest their genres, each time the form opens.
- `GET /api/admin/applications`, in both forms, to pick the application they come from, each time the form opens.
- `GET /api/events`, in the session form, to pick the event on RA, each time it opens, from the year 2000 on, to get
  every one (see [Time ranges](../../server/events.md#time-ranges)).
