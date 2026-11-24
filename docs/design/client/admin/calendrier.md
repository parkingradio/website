# Calendrier

At `/admin/calendrier`: what takes the studio, i.e. sessions and occupations, and what needs settling (see
[Calendar](../../server/calendar.md)). Days and times are in Québec time (see [Admin](layout.md)). From top to bottom,
the page has "À régler", the toolbar, then a legend, the month and the chosen day, or the list (see
[The list](#the-list)).

"Today" is the day it is in Québec, by the browser's clock.

## What's shown

Sessions, occupations, free time and conflicts each have their own color, which the legend gives, and besides the color,
something else that tells them apart:

- Sessions have a bar on their left, and their title. Sessions that are done or cancelled take the
  [status colors](layout.md#status-colors), with "jouée" or "annulée" written. Past planned sessions keep their color, so
  that one that wasn't marked "jouée" stands out.
- Occupations have a dashed border. An occupation is named by its title, then the name of its feed, its calendar, e.g.
  « RÉPARATION », « Calendrier de l'équipe », or « Airbnb », « Séjours », or by its calendar's name alone, as it's
  written, when it has no title (`""`), e.g. « Calendrier de l'équipe ». Its title is cut short in the month, after two
  lines.
- Free time says "disponible" or "dispo …" (see [Free time](#free-time)).
- Conflicts have a red frame, which doesn't hide a session's bar or an occupation's dashed border, and "conflit".

On narrow screens like phones, the month shows them as marks instead (see [On phones](#on-phones)).

Occupations can't be changed on the site, only in their calendars, which their names give.

A thing's times are written in three ways:

- **Its part of a day**, in the month: "toute la journée", "21 h – 23 h", "dès 18 h", or "jusqu'à 1 h" on a day it
  takes from its start.
- **In full**, on a day, e.g. the chosen day: "21 h – 23 h", "18 h – dim. 15 nov., 2 h", or "ven. 13 nov., 21 h – 1 h"
  on a day after the one it starts on.
- **In brief**, on a day, in the list and in "À régler", where they're as short as they can be: "21 h – 23 h", or "21 h
  – 1 h" when it ends the next day at an earlier time than it starts; its start, then the last day it takes, when that's
  a later one, e.g. "15 h → mar. 24"; and on a day it takes from its start, "→ 11 h" when it ends on that day, "journée"
  when it takes all of it, or else the last day it takes, e.g. "→ jeu. 3". A later day has its weekday and its number,
  which are another day's only four weeks or more after, and its month too, then, e.g. "→ sam. 2 janv.".

Something that takes whole days, from 00:00 to 00:00, is written as such, whether it's whole-day or not: "toute la
journée", or in full "du ven. 13 nov. au dim. 15 nov.". Otherwise, something that starts at 00:00 is written from the
start of its day: "jusqu'à 11 h", or in full "jusqu'au dim. 29 nov., 11 h" when it ends on a later day, or "du sam. 28
nov. jusqu'au lun. 30 nov., 11 h" on a day after the one it starts on, and in brief "→ 11 h" or "→ dim. 29". Something
that ends the next day at an earlier time than it starts is written like a session's times in short (see [Times, in
Sessions](sessions.md#times)), "21 h – 1 h", then "jusqu'à 1 h" on the next day.

## The address

- `month=YYYY-MM`: the month shown, among those the server takes. Without it, or with a value the page doesn't know, it's
  the chosen day's month, or else today's.
- `day=YYYY-MM-DD`: the chosen day. A day that isn't in the month's grid, or isn't a day, is ignored.
- `issues=open`: "À régler" is open.
- `view=list`: the list is shown, in place of the month and the chosen day. Without it, or with a value the page doesn't
  know, the month is. `month` and `day` stay while the list is shown, so that the month is as it was when it's shown
  again.

Changing the view or the month adds a step to the browser's history, and changing the month unchooses the day, unless it
chooses one too, e.g. "aujourd'hui". Choosing a day in the month, or opening or closing "À régler", doesn't add one, but
showing a day from the list does. So going back from a session's page finds the page as it was, with the form for a new
session closed (see [A new session](#a-new-session)), and going back from a day shown from the list finds the list as it
was.

## À régler

One box under the title, about what needs settling (see [The calendar](../../server/calendar.md#the-calendar)). Its
first row has "À régler", then, for each kind there are some of, how many in a tag, e.g. "2 conflits", in red, and "1
sans date", and a chevron: the row is a button that opens the box and closes it. While there's nothing to settle, the
row says "rien" instead, which says why it does nothing: it's greyed out, and screen readers announce it as unavailable.
It's closed by default.

Under that row, the box warns (see [Warnings](layout.md#warnings)) about each feed whose last read failed, naming it,
saying why, and that conflicts can be missing or out of date, and linking to Configuration, and about each feed that
hasn't been read yet, naming it, and saying that conflicts can be missing.

Opened, it has a group for each kind of thing to settle, each under a divider, with its tag and a heading, then a row
for each one, on one line: when it is, then what it is. The whole row is what's done about it, by clicking it, or with
the keyboard, as one control, which its text names, and which shows when it's hovered or has the focus. Its text has no
links of its own.

- The conflicts: "conflits", "chevauchements à résoudre", then each one, in the server's order. Its row has the day it
  starts, without its year unless it's another year than today's, then the time its two things overlap, in brief on that
  day (see [What's shown](#whats-shown)), then "·" and the two things' names, joined by "et": a session's title, and an
  occupation's, or its calendar's name when it has none, e.g. « sam. 21 nov. 21 h – 1 h · Airbnb et HAUTE RIVE TAKEOVER
  ». It shows that day, chosen, in the month, with the focus on it, whichever view is shown.
- The sessions without a date: "sans date", "sessions à placer", then each one, the most recently added first. Its row
  has "à déterminer" as when it is, then its title, "·", its sets' performers, set by set, the sets separated by "·",
  and its duration, e.g. « à déterminer LES SŒURS ONDES TAKEOVER · Ondine · Écume, 3 h ». It opens the session's page.

## The toolbar

With the month: "←" and "→" ("mois précédent" and "mois suivant" for screen readers), which can't go beyond the months
the server takes, the month, e.g. "novembre 2026", and "aujourd'hui", which shows today's month and chooses today. With
the list: "À venir" in their place. Screen readers announce the month, or "À venir", when it changes.

Then "mois" and "liste" ("Vue" for screen readers), which show the month and the list, the one shown being pressed, and
doing nothing. They're at the same place whichever view is shown.

## The month

A table with the days of the week, "dim" to "sam", then the weeks that have the month's days. The days of the months
before and after are faded out, with what's on them. Today stands out.

Each day lists what takes some of it, each with its part of the day and its name (see [What's shown](#whats-shown)), and
the stretches of its free time (see [Free time](#free-time)), in order of when each starts on the day, what started on
an earlier day first: things by start, then end, and before a stretch that starts when they do. A session also has its
sets' performers, cut short when they don't fit. A thing that's in a conflict has "conflit" on the days the time it
overlaps the other thing takes some of. Screen readers read each thing's kind before it, and « , calendrier » or
« , avec » between its title and its calendar or performers, e.g. « occupation : RÉPARATION, calendrier Calendrier de
l'équipe », « session : HAUTE RIVE TAKEOVER, avec Aurore, Brume ».

Clicking a day chooses it, and clicking it again unchooses it. Clicking a session opens its page, without choosing its
day.

From today on, each day of the grid has a "+" next to its number, always shown ("nouvelle session le jeudi 19 novembre
2026" for screen readers), which chooses the day, without unchoosing it, and opens the form for a new session on it (see
[A new session](#a-new-session)).

With the keyboard, the month is one stop: Tab goes to the chosen day, or else to today, when it's in the month's grid,
or else to the month's first day. The arrows move between days, within the grid, and Enter or Space chooses the day, or
unchooses it. Tab from a day goes to its "+", if it has one, which the arrows move from as from its day, but never to.
Screen readers name the table by its month, and each day by its date, e.g. "jeudi 19 novembre 2026", say which one is
today, and which one is chosen, and read what's on it. The sessions' links in the month are left out of the keyboard's
way, since the chosen day has them.

### On phones

On narrow screens like phones, each day of the month shows its number, its "+", and marks in place of the words of
what's on it: a small square for each thing, in the month's order, which looks like the thing does on wider screens, as
the legend shows (a session's bar, an occupation's dashed border), with a red frame when the thing has "conflit" on the
day; a session that's done is filled grey, and one that's cancelled hollow, which the legend shows too, as "jouée" and
"annulée". Then a green circle when the day has free time, and a red "!" when something on it has "conflit". Screen
readers still read the day's words, as its description, and the chosen day writes them. Tapping a day chooses it, or
unchooses it, the month having no links to sessions there.


### Free time

A day has free time when it's in the 365 days that conflicts are found in (see
[Conflicts](../../server/calendar.md#conflicts)), and no session that isn't cancelled starts on it. Its free time is the
parts of the day, from 00:00 to 00:00, that nothing takes, cancelled sessions aside. Today's stretches count from 00:00
too, even those that are over.

The month shows the free time of its own days, not that of the months before and after. A day that nothing takes is
green, and says "disponible". Otherwise, each stretch has a green tag: "dispo jusqu'à 15 h", "dispo dès 11 h" or "dispo
11 h – 15 h".

## The chosen day

Under the month, the chosen day, with the day as its heading, e.g. "jeudi 19 novembre 2026", and "aujourd'hui" for
today, and a "×" ("fermer le jour" for screen readers) that unchooses it, which puts the focus back on the day in the
month. Choosing a day, in the month or from a row of "À régler" or of the list, brings the chosen day's heading into
view, when it isn't already, as far as the day in the month stays in view too. It has a row for each thing that takes
some of the day, and each stretch of its free time (see [Free time](#free-time)), even on a day of the month before or
after, in the month's order.

A thing's row has:

- its kind: "session" or "occupation";
- its times, in full on that day (see [What's shown](#whats-shown));
- for a session, its title, linking to its page, its sets' performers, and its status; for an occupation, its name;
- for each other thing it's in conflict with, during some of the day, "conflit avec" that thing, e.g. « conflit avec la
  session HAUTE RIVE TAKEOVER », « conflit avec l'occupation RÉPARATION (Calendrier de l'équipe) ».

A stretch's row has "disponible", and the stretch, "toute la journée", or e.g. "jusqu'à 15 h". On a day without
anything, « Rien ce jour-là. ».

### A new session

A day's "+" opens a short form for a new session on the chosen day, "Nouvelle session", under the day's things, and puts
the focus on its heading. It adds the session with only what's needed to add one, without sets, and with its other
fields empty (see [`POST /api/admin/sessions`](../../server/sessions.md#post-apiadminsessions-admin)): the rest is added
on its page, which its link on the chosen day leads to. Its fields are:

- "Début" and "Fin", each a time of day, in Québec time. The session starts on the chosen day, and ends on that day when
  the end's time is after the start's, or else the next day, e.g. "21 h – 1 h". An end at the start's time is refused,
  « La fin doit être après le début. ». A time the clocks skip is refused, and one they show twice is the first one, or
  for the end, the first one after the start, as in the session form (see [Times, in Sessions](sessions.md#times)).
  Once they're valid, the form says how long the session lasts, e.g. « Dure 4 h. », or « Dure 4 h, jusqu'au
  lendemain. ».
- "Type", as in the session form (see [The session form](sessions.md#the-session-form)).
- "Collectif", only for a takeover, as in the session form. When the collectives can't be loaded, the form says so, and
  none can be picked.
- "Nom", only for "Autre", which needs one (see [Types and names](../../server/sessions.md#types-and-names)).

It says what's wrong as the session form does (see [Errors, in Sessions](sessions.md#errors)), e.g. naming the session
the new one would overlap, and linking to it. "créer" adds the session, then closes the form, with the day still chosen
and the focus on it in the month, reads the calendar again, which then shows the session, and says « La session GUEST
MIXES a été ajoutée. » under the day's things, until the form opens again, or another day, or none, is chosen, or the
list is shown. "annuler" closes the form, which puts the focus back on the day's "+". Choosing another day, or none, or
showing the list, closes it too, and what was typed in it is lost.

## The list

What takes the studio over the 365 days that conflicts are found in (see
[Conflicts](../../server/calendar.md#conflicts)), from today, month by month: each month that has some of these days, by
its name, e.g. "novembre 2026", then a row for each thing, or « Rien. » when it has none. It ends with the day it stops
at, « La liste s'arrête au jeudi 18 novembre 2027. ». Free time isn't listed: the month shows it.

Each thing is listed once, on the first of these days it takes some of: the day it starts, or today for something that
started before. Things are in order of their start, then of their end. A thing's row is in columns, which start at the
same place on every row: the day, without its year, which its month gives; its kind, "session" or "occupation", in its
color and with its shape, framed in red when it's in a conflict; its times in brief on that day (see
[What's shown](#whats-shown)); then what it is, which goes under the rest on narrow screens like phones:

- for a session, its title, then its status, unless it's planned, in the [status colors](layout.md#status-colors), then
  "·" and its sets' performers, set by set, the sets separated by "·"; for an occupation, its title, then its calendar,
  or its calendar's name alone (see [What's shown](#whats-shown));
- for each other thing it's in conflict with, "·" and, in red, "conflit avec" that thing's name, as in "À régler", and,
  when their overlap doesn't take some of the row's day, the day it starts, without its year unless it's another year
  than the row's day's.

E.g. « mar. 1 déc. | occupation | 15 h – 11 h | Airbnb Séjours · conflit avec SYNTH MEETUPS · conflit avec Calendrier
de l'équipe (mer. 2 déc.) ».

As in "À régler", the whole row is one control, whose text has no links of its own: it shows the row's day, chosen, in
the month, with the focus on it, where the chosen day links to a session's page. Screen readers name the list by the
toolbar's heading, "À venir".

## Loading and errors

When the calendar can't be read, the page says why at its top, until it's read again. "À régler" shows the last calendar
read, whatever its days, and nothing before the first. The month and the chosen day only show what a calendar read for
the month's days has: until then, its days show only their numbers, and their "+", and the chosen day only its heading,
and the form for a new session, which doesn't wait for the calendar. Likewise, the list only shows what a calendar read
for its days has, and nothing until then. Going back to what was shown just before, e.g. from a day shown from the list
to the list, shows it as it last showed it, while it's read again.

## Endpoints

- `GET /api/admin/calendar`, for the days of the month's grid, within those the server takes, or for the list, from today
  to 364 days later. It's read when the page opens, when the view or the month changes, when a new session is added,
  and when the browser's tab is shown again, at most once a minute.
- `GET /api/admin/collectives`, to pick a takeover's collective, each time the form for a new session opens, and
  `POST /api/admin/sessions`, to add the session.
