# Calendrier

At `/admin/calendrier`: what takes the studio, i.e. sessions and occupations, and what needs settling (see
[Calendar](../../server/calendar.md)). Days and times are in Québec time (see [Admin](layout.md)). From top to bottom,
the page has "À régler", the toolbar, a legend, the month and the chosen day.

"Today" is the day it is in Québec, by the browser's clock.

## What's shown

Sessions, occupations, free time and conflicts each have their own color, which the legend gives, and besides the color,
something else that tells them apart:

- Sessions have a bar on their left, and their title. Sessions that are done or cancelled take the
  [status colors](layout.md#status-colors), with "jouée" or "annulée" written. Past planned sessions keep their color, so
  that one that wasn't marked "jouée" stands out.
- Occupations have a dashed border. An occupation is named by its title, then the name of its feed, its calendar, e.g.
  « RÉPARATION », « Calendrier de l'équipe », or by its calendar's name alone, as it's written, when it has no title or
  its feed's titles are private, e.g. « Séjours ». Its title is cut short in the month, after two lines.
- Free time says "disponible" or "dispo …" (see [Free time](#free-time)).
- Conflicts have a red frame, which doesn't hide a session's bar or an occupation's dashed border, and "conflit".

Occupations can't be changed on the site, only in their calendars, which their names give.

A thing's times are written in two ways:

- **Its part of a day**, in the month: "toute la journée", "21 h – 23 h", "dès 18 h", or "jusqu'à 1 h" on a day after
  the one it starts on.
- **In full**, on a day, e.g. the chosen day: "21 h – 23 h", "18 h – dim. 15 nov., 2 h", or "ven. 13 nov., 21 h – 1 h"
  on a day after the one it starts on.

Something that takes whole days, from 00:00 to 00:00, is written as such, whether it's whole-day or not: "toute la
journée", or in full "du ven. 13 nov. au dim. 15 nov.". Something that ends the next day at an earlier time than it
starts is written like a session's times in short (see [Times, in Sessions](sessions.md#times)), "21 h – 1 h", then
"jusqu'à 1 h" on the next day.

## The address

- `month=YYYY-MM`: the month shown, among those the server takes. Without it, or with a value the page doesn't know, it's
  the chosen day's month, or else today's.
- `day=YYYY-MM-DD`: the chosen day. A day that isn't in the month's grid, or isn't a day, is ignored.
- `issues=open`: "À régler" is open.

Changing the month adds a step to the browser's history, and unchooses the day, unless it chooses one too, e.g.
"aujourd'hui". Choosing a day, or opening or closing "À régler", doesn't add one. So going back from a session's page
finds the page as it was.

## À régler

One box under the title, about what needs settling (see [The calendar](../../server/calendar.md#the-calendar)). Its
first row has "À régler", then how many conflicts and sessions without a date there are, each in a tag, e.g. "2
conflits", in red, and "1 sans date", and a chevron: the row is a button that opens the box and closes it. While there's
nothing to settle, the row says "rien" instead, and can't be used (see
[Controls that can't be used](layout.md#controls-that-cant-be-used)). It's closed by default.

Under that row, the box warns about each feed whose last read failed, or that hasn't been read yet (see
[Warnings](layout.md#warnings)), naming it, and saying why the read failed, if it did, linking to Configuration, and that
conflicts can be missing or out of date. While there are no feeds at all, it says that conflicts with occupations can't
be found, and links to Configuration.

Opened, it has a group for each kind of thing to settle, each under a divider, with its tag, a heading and a sentence
about them, then a row for each one: when it is, what it is, and what to do, on the right, which screen readers read
with what it's about, e.g. « voir le jour, sam. 21 nov. 2026 ».

- The conflicts: "conflits", "chevauchements à résoudre", « Le studio n'accueille qu'une chose à la fois : déplacez,
  raccourcissez ou annulez l'une des deux. Les occupations se changent dans leur calendrier. », then each one, in the
  server's order. Its row has the day it starts, the time its two things overlap, in full on that day, and the two
  things, each with its kind: a session by its title, which links to its page, and an occupation by its name. "voir le
  jour →" shows that day, chosen, in the month, with the focus on it.
- The sessions without a date: "sans date", "sessions à placer", « Donnez-leur une date pour les voir dans le mois, et
  dans les conflits. », then each one, the most recently added first. Its row has "à déterminer" as when it is, its
  title, linking to its page, its sets' performers, set by set, the sets separated by "·", then its duration, and "lui
  donner une date →", which opens its page too.

## The toolbar

"←" and "→" ("mois précédent" and "mois suivant" for screen readers), which can't go beyond the months the server takes,
the month, e.g. "novembre 2026", which screen readers announce when it changes, "aujourd'hui", which shows today's month
and chooses today, and "nouvelle session", which opens the session form (see [Sessions](sessions.md#the-session-form)).

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

With the keyboard, the month is one stop: Tab goes to the chosen day, or else to today, when it's in the month's grid,
or else to the month's first day. The arrows move between days, within the grid, and Enter or Space chooses the day, or
unchooses it. Screen readers name the table by its month, and each day by its date, e.g. "jeudi 19 novembre 2026", say
which one is today, and which one is chosen, and read what's on it. The sessions' links in the month are left out of the
keyboard's way, since the chosen day has them.

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
month. It has a row for each thing that takes some of the day, and each stretch of its free time, in the month's order.
A thing's row has:

- its kind: "session" or "occupation";
- its times, in full on that day (see [What's shown](#whats-shown));
- for a session, its title, linking to its page, its sets' performers, and its status; for an occupation, its name;
- for each other thing it's in conflict with, during some of the day, "conflit avec" that thing, e.g. « conflit avec la
  session HAUTE RIVE TAKEOVER », « conflit avec l'occupation RÉPARATION (Calendrier de l'équipe) ».

A stretch's row has "disponible", and the stretch, "toute la journée", or e.g. "jusqu'à 15 h". On a day without
anything, « Rien ce jour-là. ». From today on, "nouvelle session ce jour →" opens the session form on that day (see [The
session form](sessions.md#the-session-form)).

## Loading and errors

When the calendar can't be read, the page says why at its top, until it's read again. "À régler" shows the last calendar
read, whatever its days, and nothing before the first. The month and the chosen day only show what a calendar read for
the month's days has: until then, its days show only their numbers, and the chosen day only its heading and "nouvelle
session ce jour →".

## Endpoints

- `GET /api/admin/calendar`, for the days of the month's grid, within those the server takes. It's read when the page
  opens, when the month changes, and when the browser's tab is shown again, at most once a minute.
