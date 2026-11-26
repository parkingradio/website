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
- in short, e.g. in lists, after its day: "21 h – 1 h", or "10 h – 0 h", when it ends the day it starts, or the next
  day at an earlier time than it starts, at 00:00 or at most 12 hours after it starts; or else with the day it ends,
  without its year, e.g. "15 h – dim. 15 nov., 11 h", "18 h – dim. 15 nov., 2 h", or "21 h – dim. 15 nov., 21 h" for a
  session of 24 hours.

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
status ("Statut"), as a dropdown, "planifiée", "jouée" or "annulée", that changes it as soon as another status is picked,
first asking to confirm as its page's buttons do (see [A session's page](#a-sessions-page)), and whether it's announced
("Annonce"), as a dropdown, "non annoncée" or "annoncée", that announces it or un-announces it as soon as the other value
is picked, without confirming, except that un-announcing a session that has an event on RA first asks to confirm, saying
« L'événement sur RA ne sera pas modifié. » (see [Events on RA](../../server/sessions.md#events-on-ra)). When a change
isn't confirmed, its row keeps its value. A session without a date can't be announced: its dropdown can't be used, and
says « La session n'a pas de date. » (see [Controls that can't be used](layout.md#controls-that-cant-be-used)).
Buttons above the list show only the sessions with a status, or all of them ("toutes"), with how many there are of each.
It opens on "planifiées", its default view (see [Searching lists](layout.md#searching-lists)), by date, the earliest
first, past ones included, then those without a date, the first added first. With another status or "toutes", those
without a date come first, the most recently added first, then the others, the latest first. Another group of buttons,
"Annonce", shows only the sessions that are announced ("annoncées"), or those that aren't ("non annoncées"), or both
("toutes"), which it opens on, and which its address leaves out (`announced=true`, `announced=false`, or nothing).
While the buttons show only the sessions with a status, or only the announced sessions, or only those that aren't, a
session changed to another value leaves the list as soon as that's saved. With "toutes", it stays. Only the dropdown
that changed is locked while it's saved. When a session's status, or whether it's announced, can't be changed, the list
says why above it, naming the session (see [Names](#names)), and its row keeps its value.

A field above the list searches the sessions (see [Searching lists](layout.md#searching-lists)) by their title, their
type, their takeover's collective, their sets' performers, and their day, written out (e.g. "samedi 14 novembre 2026",
which "14 nov" finds), or "date à déterminer". Clicking "Date" (`date`, by start, sessions without a date being later
than any other, then by when they were added), "Nom" (`name`, by title) or "Statut" (`status`: planifiée, jouée, then
annulée) sorts the list by that column, and clicking it again sorts it the other way around. The buttons of each group
count the sessions that the search, and the other group's buttons, find.

## A session's page

Clicking a session opens it at `/admin/sessions/<id>`, with the list's parameters in its address (see
[Going through a list](layout.md#going-through-a-list)), titled as it's called (see [Names](#names)). Under the title, it
says who added it and when, and who last changed it and when, if anyone did. From top to bottom, it then shows:

- "Statut": the status, as buttons that change it, and which admin last changed it, and when. Cancelling a session first
  asks to confirm when it has sets that aren't cancelled or an event on RA: the confirmation names those sets, marking
  those that are "joué", and says that they'll be cancelled too (see [Status](../../server/sessions.md#status)), then
  says « L'événement sur RA ne sera pas modifié. » for an event on RA (see
  [Events on RA](../../server/sessions.md#events-on-ra)). Marking it "jouée" while it has "planifié" sets first asks to
  confirm too, naming them and saying that they'll be marked "joué". Under it, likewise, whether the session is
  announced, as "non annoncée" and "annoncée". Un-announcing a session that has an event on RA first asks to confirm
  too, saying « L'événement sur RA ne sera pas modifié. ». Each says why it couldn't be changed under its own buttons.
  While the session has no date, "annoncée" can't be used, and says « La session n'a pas de date. » (see
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
  - "Flyer": its flyer, at its 1280-pixel size, linking to the flyer as it was sent, in a new tab, e.g. to download it
    and add it to the session's event on RA by hand, when the bookmarklet couldn't (see
    [Publier sur RA](publier-sur-ra.md)). When it has none, "Pas de flyer"
    is shown instead, so that the team notices.
  - "Événement RA": its event on RA, linking to it, or "-" when it has none. "créer" opens a panel under it that creates
    the event (see [Creating its event on RA](#creating-its-event-on-ra)).
- "Sets": its sets, in their order (see [Sets' order](../../server/sessions.md#sets-order)). Each set is a row with:
  - A handle, by which it's dragged to another place among the session's sets (see [Reordering](layout.md#reordering)),
    even while the session is cancelled. It shows there as soon as it's dropped, while that's saved.
  - "Durée": its duration.
  - "Artistes": its performers, each linking to their page, or "-" once they've all been deleted.
  - "Prestation": its performance types.
  - "Genres": its genres.
  - "Liens": "SoundCloud" and "YouTube", each linking to the recording, then "Candidature", linking to the page of the
    application the set comes from. Screen readers name that last link by when the application was received, e.g.
    "Candidature reçue le 1 septembre 2026".
  - "Statut": its status, as a dropdown that changes it as soon as another status is picked, without confirming.
  - "déplacer", which opens the panel that moves it to another session (see
    [Moving a set to another session](#moving-a-set-to-another-session)).
  - "modifier", which opens its form (see [A set's form](#a-sets-form)).
  - "×", which deletes it for good, after confirming.

  Changing a set's status, adding one, moving one to another session or deleting one can change the session's status
  (see [Status](../../server/sessions.md#status)).

  When a status can't be changed, a set's new place can't be saved, or a set can't be deleted, the section says why
  above the sets, naming the set. A set whose status couldn't be changed keeps it, and one whose place couldn't be saved
  goes back to where it was.
  "ajouter un set" opens the form of a new set.

  While the session is cancelled, "ajouter un set" can't be used, and says « La session est annulée : on ne peut pas lui
  ajouter de set. ». Its sets' statuses are written out rather than dropdowns, and, when it has sets, the section says
  why above them: « La session est annulée : on ne peut pas rétablir ses sets. » (see
  [Controls that can't be used](layout.md#controls-that-cant-be-used)).

  When the sets' durations add up to more than the session's, cancelled sets included and unknown durations counting
  for nothing (see [Sets' order](../../server/sessions.md#sets-order)), the section warns of it above the sets (see
  [Warnings](layout.md#warnings)), e.g. « ⚠ Les sets durent 4 h 58, plus que la session (1 h). ». The warning doesn't
  prevent anything, since a session and its sets are changed one at a time.
- "Supprimer": deletes the session, its flyer and its sets for good, after confirming, then shows the list as
  "← sessions" does. Its sets' artists, and its takeover's collective, stay, which the page says of those it has. When
  the session has an event on RA, the confirmation first says « L'événement sur RA ne sera pas modifié. » (see
  [Events on RA](../../server/sessions.md#events-on-ra)).

Only one form is open at a time on a session's page, the session's, the panel of its event on RA (see
[Creating its event on RA](#creating-its-event-on-ra)), a set's, or the panel that moves a set to another session (see
[Moving a set to another session](#moving-a-set-to-another-session)): opening one closes the other, losing what wasn't
saved. Deleting a set closes its form, or its panel, if it's open.

The page's address's `?application` (see [From an application](#from-an-application)) stays in it until the admin opens
a form or closes one, the one it opened included, whether it's saved or cancelled. It's then removed from the address,
in place, so that reloading the page, or coming back to it, doesn't open it again.

## Going through the list

Above a session's title, "← sessions" leads back to the list, and « ← précédente » and « suivante → » go through it
(see [Going through a list](layout.md#going-through-a-list)). When the list of sessions can't be loaded, the page says so
in place of « précédente » and « suivante ».

## Creating its event on RA

While a session has no event on Resident Advisor, "créer", after its "Événement RA", opens a panel under it, to create
the event on RA, with the bookmarklet or by hand, and save it as the session's:

- « Publier sur RA », which gets a token for the session from the server, then opens RA's form with it, for the
  bookmarklet that creates the event (see [Publier sur RA](publier-sur-ra.md)). Since browsers only let pages open a tab
  right when they're clicked, it opens the tab first, then sends it to RA's form once the token is there. Until then,
  the button is greyed out. When the token can't be had, it closes the tab, and the panel says why, « La publication
  sur RA n'a pas pu être préparée : … ». When the browser doesn't open the tab, it says « RA n'a pas pu s'ouvrir dans
  un nouvel onglet. », and when the admin closed it in the meantime, nothing. It can't be used while the session has no
  date, saying « La session n'a pas de date. », or is cancelled, saying « La session est annulée. » (see
  [Controls that can't be used](layout.md#controls-that-cant-be-used)). Outside production, a warning in red follows
  it: « Attention : l'événement sera vraiment créé sur RA, à partir d'une session de TEST. », with the environment's
  stamp (see [Environment](../architecture.md#environment)).
- A sentence says that « Publier sur RA » opens RA, where the bookmarklet, named as Intégrations names it (see
  [Publier sur RA, in Intégrations](integrations.md#publier-sur-ra)), shows the event, then creates it and saves it in
  the session, and to make sure to be logged in to the right RA account **before** clicking « Publier sur RA », since
  logging in to RA loses the token, with "avant" in bold. Another says that when the bookmarklet doesn't work, the event
  can be created on RA by hand (linking to RA's form, `https://ra.co/pro/event/create`) from the session's page, then
  its link pasted below.
- "Lien de l'événement RA": the event's link, or its number, as a session's `raEvent` takes it (see
  [Links](../../server/sessions.md#links)), with or without its `https://`. "enregistrer" saves it as the session's
  event on RA, which then shows in place of the panel, and "annuler" closes the panel. Saving only changes the session's
  event, and leaves its other fields as they are, even if they changed since the page loaded (see
  [Changes, in Conventions](../../server/README.md#conventions)). An empty field, or one that isn't an event's link,
  says so, and sends nothing.

Once the session has its event on RA, its "Événement RA" only links to it: "modifier" still changes it.

## The session form

"nouvelle session" adds a session, as planned, with its sets (see [A new session's sets](#a-new-sessions-sets)), at
`/admin/sessions/nouvelle`, then goes to its page. A new session starts without a type, which has to be picked. A
collective's page leads to it as its takeover, with "Takeover" and the collective picked (`?takeover=<id>`), and its
application, as when the collective is picked (see [Applications](#applications)), unless it isn't one of the collectives
loaded, e.g. when they can't be loaded, in which case nothing is picked. From top to bottom, the form has:

- "Quand": the start and the end, each a "date" and an "heure", in Québec time (see [Times](#times)), side by side
  where there's room, with « à » between them and no visible label (screen readers name them "Début" and "Fin"), then
  right under them the programmation's time slots (see below), then how long the
  session lasts, e.g. « Dure 4 h. », once they're valid. The end's date keeps its distance in days from the start's:
  when the start's date changes to another day, the end's moves by as many days, from the last day the start had, even
  if its date was cleared in between, e.g. while it's typed. When the start's date changes while the end has none, the
  end takes it. Changing the end's date only changes that distance. Or, with "date à déterminer" checked, only
  "Durée". Checking it fills the duration in from the times, when they're valid. Once the start has both its date and
  its time, whichever is entered last, and the clocks show that time, an empty end time is filled in, with its date, as
  long after the start as the duration the form has, if it has one: the one "Durée" had, e.g. after un-checking "date à
  déterminer", or else the session's as the form opened. The form doesn't check that the session's sets still add up
  to no more than the session once it's shorter: the session's page then warns of it (see
  [A session's page](#a-sessions-page)). The time slots, under the start and the end, or under "Durée", are the ones
  artists pick from on Appliquer (see [Appliquer](../appliquer.md)), e.g. "13 h – 17 h", offered as small buttons with
  no visible label (screen readers name them « Plages horaires »): picking one fills in the start's and the end's times
  with its own, and the end's date becomes the start's. The fields can still be changed, e.g. for 19 h – 23 h. A slot
  shows as picked while the start's and the end's times are its own and the end's date is the start's. With "date à
  déterminer" checked, picking a slot sets "Durée" to its length instead, and none shows as picked.
  While the session is announced, checking "date à déterminer" shows an error
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
  the server checks it (see [Flyers](../../server/sessions.md#flyers)). A session's page saves it after the session's
  fields, like an artist's photo, saying « La session a été enregistrée, mais pas le flyer : … » when only the flyer
  can't be saved.
- "Événement RA": picked from every one of Parking Radio's events, past ones included, read from RA (see
  [RA events](../../server/ra-events.md)), or "Aucun événement RA", which leaves it out. Each event is shown by its
  title and the day it starts on in Québec, e.g. "GUEST MIXES, sam. 14 nov. 2026", with its number on RA, e.g.
  "n° 6683745", the upcoming ones first, the soonest first, then the past ones, the most recent first. The field
  searches them by their title and their day, written out (e.g. "samedi 14 novembre 2026", which "14 nov" finds), as the
  lists are searched (see [Searching lists](layout.md#searching-lists)), and, when only digits are typed, by their
  number too, or part of it, exactly (e.g. "2026" finds the events of 2026, and those whose number has "2026" in it),
  since Parking Radio's numbers are close to each other. A link to an event's page on RA, as a session's `raEvent` takes
  it (see [Links](../../server/sessions.md#links)), with or without its `https://`, finds that event, or nothing when it
  isn't offered. "Aucun événement RA" is found by what it shows, and the session's own event, when it isn't among those
  read (see below), by "Événement RA" and by its number, like the others. Once an event is picked, the form links to its
  page on RA, showing its address, like the session's page. The session's own event, when it isn't among those read from
  RA, e.g. another promoter's (see [Links](../../server/sessions.md#links)), is offered too, as
  "Événement RA n° 6683745", so that the session keeps it unless another one is picked. The form doesn't wait for RA:
  until the events are read, or when they can't be, only the session's own event and "Aucun événement RA" can be picked,
  and the form says when they couldn't be.

When the collectives can't be loaded, the form says so: the session's collective stays, but another one can't be picked.

### A new session's sets

After its fields, a new session's form has its sets, which are only sent with it. They're added, changed and listed as
on a session's page (see [A set's form](#a-sets-form)), except that:

- Their rows have no status, nor "déplacer", and they're in the order they're added in, which dragging them changes.
  "×" takes a set out of the list, without confirming. Their links open in a new tab. Once the session's times are
  valid, the list says when the sets add up to more than the session, with the same warning as a session's page.
- While the session's times aren't valid, its duration isn't known: a new set then lasts an hour by default. A new
  set's form keeps the duration it opened with, even once the session's times change.
- A takeover's collective, whose artists its sets' forms list first, is the one the session's form has picked: an open
  set's form follows it as the collective or the type changes.
- "ajouter la session" can't be used while a set's form is open, saying « Ajoutez d'abord le set, ou annulez-le. »,
  or « Enregistrez d'abord le set, ou annulez-le. » for a listed set's, and the sets can't be changed while it's sent.

## A set's form

A set's form opens under the sets, as a new one's ("ajouter le set") or a set's ("enregistrer"), and "annuler" closes
it. A set's form also says who added it and when, who last changed it and who last changed its status, and when. From
top to bottom, the form has:

- "Artistes": the performers, in order, at least one, which can be reordered and removed like a collective's artists
  (see [Adding a collective](artistes.md#adding-a-collective)), each picked from the artists of
  [Artistes](artistes.md) other than the set's performers. In a takeover's set, its collective's artists come first, in
  the collective's order (see [Members](../../server/collectives.md#members)), each marked with the collective's name,
  then the others, e.g. for a guest (see [Types and names](../../server/sessions.md#types-and-names)). While a name is
  typed, the collective's artists it finds still come first. Performers can't be created by typing a name: they're
  added in Artistes first.
- "Candidature": the application the set comes from, picked from its performers' applications, or "Aucune
  candidature" (see [Applications](#applications)).
- "Durée": how long the set lasts, in hours and minutes (see [Times](../../server/sessions.md#times)), or empty while it
  isn't known. It doesn't check that the sets still add up to no more than the session: the list of sets warns of it
  (see [A session's page](#a-sessions-page)). A new set, which goes after the session's other sets, lasts an hour by
  default, or what's left of the session after its sets, cancelled ones included, if that's less. When the session's
  sets fill it, "Durée" starts empty.
- "Prestation": what the performers do, picked from the same list as the application form's (see
  [Candidatures](candidatures.md)), and "Autre", in a few words.
- "Genres": the set's genres, in order, e.g. "house, techno", or "-", and "modifier", which unfolds the tags to click,
  like an artist's (see [Adding an artist](artistes.md#adding-an-artist)), and gives them the focus. Screen readers
  name it "modifier les genres". Once unfolded, the field stays so, without "modifier", until the form closes. Each time
  the performers change, an artist being added, taken out or moved, the set's genres become its performers': their
  first genres, in the order of [a collective's genres](artistes.md#a-collectives-genres), up to 3, or none when they
  have none, replacing those the set had, even genres picked by hand. Genres that differ from the performers' (see
  [Sets](../../server/sessions.md#sets)) are picked once the performers are. Opening a set's form leaves them as they are.
- "SoundCloud" and "YouTube": links to the set's track and video (see [Links](../../server/sessions.md#links)).

When the artists can't be loaded, the form says so: the set's performers stay, but others can't be picked, and changing
them leaves the set's genres as they are, since their genres aren't known. On a takeover's page, its collective is
loaded along with them: when it can't be, the form says so, and lists the artists as in other sets.

## Moving a set to another session

A set's "déplacer" opens a panel under the sets, titled after the set, that moves it to another session (see
[Sets' order](../../server/sessions.md#sets-order)). Its field, "Session", which gets the focus, offers every other
session, loaded when the panel opens: first the planned ones, in the order of the list's default view, then the others,
done or cancelled, in the order of its "toutes" view (see [The list](#the-list)). Each one is named as sessions are among
others (see [Names](#names)), with its times in short, and its status unless it's planned. The field searches them as the
list does, and the panel says when they can't be loaded.

"déplacer" moves the set there, after its sets. It can't be used until a session is picked, nor while the session picked
is cancelled and the set isn't, saying why (see [Controls that can't be used](layout.md#controls-that-cant-be-used)):
only cancelled sets can be moved into a cancelled session, and moving a set never changes its status (see
[Status](../../server/sessions.md#status)). "annuler" closes the panel, and gives the focus back to the set's
"déplacer".

Once the set is moved, the page stays on the session it left, as the server then has it, without the set, and its status
can have changed. The focus goes to the next set's "déplacer", or else the previous one's, or else the heading of the
sets. Above the sets, a notice says where the set went, linking to that session, until a form opens, or another set is
changed. That session's page says when its sets then add up to more than it.

When the set can't be moved, the panel stays open and says why, naming what's in the way as the other errors do (see
[Errors](#errors)).

## Applications

A set or a session can come from an application (see [Applications](../../server/sessions.md#applications)). Its form
picks that application in "Candidature", which offers "Aucune candidature" first, then:

- in a set's form, its performers' applications, artist by artist, in the order of the performers;
- in a takeover's form, its collective's applications.

Each artist's or collective's applications are listed newest first, by when they were received. In a set's form, an
option names the artist and when the application was received, e.g. "Aurore, reçue le 15 août 2026". In a takeover's form, it only
says when, e.g. "Reçue le 1 septembre 2026". Each option then shows the application's status and the first few days the
artist would like to play, written as [Candidatures](candidatures.md) lists them, e.g. "retenue · 14 nov. 2026, 21 nov.
2026". A rejected application is listed too, as "refusée", but greyed out, and can't be picked, unless the set or the
session is cancelled, since one that's planned or done can't have one, and a new one is planned (see
[Applications, in Sessions](../../server/sessions.md#applications)).

When there's nothing to pick, the field says why: "Choisissez d'abord les artistes." or "Choisissez d'abord le
collectif." when none are picked yet, or else "Aucune candidature de cet artiste.", "Aucune candidature de ces
artistes." or "Aucune candidature de ce collectif.".

Those are the only options: the set's or the session's own application is among them only while it's its performers' or
its collective's, e.g. not once its artist is taken out of the set.

When an artist is added to the performers or taken out of them, or the takeover's collective is picked, the form looks at
its application:

- One that's still theirs stays.
- In a planned set's or session's form, a new one's included, one that isn't theirs anymore, or none, becomes their
  application when they have exactly one that's new or accepted (see
  [Status, in Applications](../../server/applications.md#status)), or else none. A planned application isn't picked,
  since it's already a planned set's or session's, but it can be picked by hand.
- In a done or cancelled set's or session's form, one that isn't theirs anymore is taken away, and none is picked, since
  that would make the application done, or accepted.

Reordering the performers changes nothing, and neither does opening the form of a set or a session that's already there,
since it can be meant to have no application. So the form's application is always its performers' or its collective's,
as the server needs (see [Applications, in Sessions](../../server/sessions.md#applications)). A session saved as
another type than a takeover has none, since it has no collective (see [The session form](#the-session-form)).

The applications are loaded each time a form opens, along with the artists or the collectives. When they can't be
loaded, the form says so above it, and only "Aucune candidature" and the set's or the session's own application, named
by when it was received, can be picked. The form then can't tell whose an application is: changing the performers or
the collective leaves it as it is, and the server's check is the one that counts (see [Errors](#errors)).

## From an application

An application's page leads to a session's page, or to "nouvelle session", with the application, `?application=<id>`
(see [Candidatures](candidatures.md)), whose forms then start from it:

- On a session's page, unless the session is cancelled, a new set's form opens, filled in from the application: its
  artist as the only performer, and the genres a set takes from them (see [A set's form](#a-sets-form)), its performance
  types and "autre", and the application itself. The page scrolls to the form, whose heading gets the focus.
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

- `GET /api/admin/sessions`, for the list, and on a session's page, for « précédente » and « suivante », and
  `PUT /api/admin/sessions/:id/status` and `PUT /api/admin/sessions/:id/announced`, to change a session's status, and to
  announce it or un-announce it, from the list.
- `GET /api/admin/sessions/:id`, `PATCH /api/admin/sessions/:id`, `PUT /api/admin/sessions/:id/flyer`,
  `DELETE /api/admin/sessions/:id/flyer`, `PUT /api/admin/sessions/:id/status`, `PUT /api/admin/sessions/:id/announced`
  and `DELETE /api/admin/sessions/:id`, for a session's page.
- `GET /api/admin/sessions/:id/flyer?width=1280`, for its flyer, on its page and in its form, which links to
  `GET /api/admin/sessions/:id/flyer`, the flyer as it was sent (see [Flyers](../../server/sessions.md#flyers)).
- `POST /api/admin/sessions/:id/ra-publication`, for « Publier sur RA », in the panel that creates its event on RA, and
  `PATCH /api/admin/sessions/:id`, to save the event as the session's too.
- `POST /api/admin/sessions`, for "nouvelle session".
- `POST /api/admin/sessions/:id/sets`, `PATCH /api/admin/sets/:id`, `PUT /api/admin/sets/:id/status`,
  `PUT /api/admin/sets/:id/position`, `PUT /api/admin/sets/:id/session` and `DELETE /api/admin/sets/:id`, for its sets,
  and `GET /api/admin/sessions`, in the panel that moves a set to another session, each time it opens.
- `GET /api/admin/collectives`, in the session form, to pick a takeover's collective and list its artists first in a new
  session's sets, and `GET /api/admin/artists`, in a set's form, to pick the performers and take their genres, each
  time the form opens.
- `GET /api/admin/collectives/:id`, in a set's form on a takeover's page, to list its collective's artists first, each
  time the form opens.
- `GET /api/admin/applications`, in both forms, to pick the application they come from, each time the form opens, and
  on "nouvelle session", along with `GET /api/admin/artists`, to find the application of `?application`, and its
  artist.
- `GET /api/ra-events`, in the session form, to pick the event on RA, each time it opens, from the year 2000 on, to
  get every one (see [Time ranges](../../server/ra-events.md#time-ranges)).
