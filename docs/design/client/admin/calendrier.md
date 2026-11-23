# Calendrier

At `/admin/calendrier`: what takes the studio, i.e. sessions and occupations, and what needs settling (see
[Calendar](../../server/calendar.md)). Days and times are in Québec time (see [Admin](layout.md)), and weeks start on
Sunday. From top to bottom, the page has "À régler", the toolbar, a legend, the month, the chosen day and "Sources".

"Today" is the day it is in Québec, by the browser's clock.

## What's shown

Sessions, occupations, free time and conflicts each have their own color, which the legend gives, and besides the color,
something else that tells them apart:

- Sessions have a bar on their left, and their title. Sessions that are done or cancelled take the
  [status colors](layout.md#status-colors), with "jouée" or "annulée" written. Past planned sessions keep their color, so
  that one that wasn't marked "jouée" stands out.
- Occupations have a dashed border. An occupation is named by its title, then the name of its feed, its calendar, e.g.
  « RÉPARATION », « Calendrier de l'équipe », or by its calendar's name alone, as it's written, when it has no title or
  its feed's titles are private, e.g. « Séjours ». Its title is cut short in the month, after two lines. Screen readers
  read « , calendrier » between the two.
- Free time says "disponible" or "dispo …" (see [Free time](#free-time)).
- Conflicts have a red outline, which doesn't hide a session's bar or an occupation's dashed border, and "conflit".

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
  today's month.
- `day=YYYY-MM-DD`: the chosen day. Without `month`, the month shown is the day's. A day that isn't in the month's grid,
  or isn't a day, is ignored.
- `issues=open`: "À régler" is open.

Changing the month adds a step to the browser's history, and unchooses the day, unless it chooses one too, e.g.
"aujourd'hui". Choosing a day, or opening or closing "À régler", doesn't add one. So going back from a session's page
finds the page as it was.

## À régler

A box under the title, about what needs settling (see [The calendar](../../server/calendar.md#the-calendar)). It gives
how many conflicts and sessions without a date there are, e.g. "2 conflits", in red, and "1 sans date", on a button that
opens the box and closes it, or "Rien à régler." while there are none. It's closed by default.

Above that button, the box warns about each feed whose last read failed, or that hasn't been read yet (see
[Warnings](layout.md#warnings)), naming it, and saying why the read failed, if it did, and that conflicts can be missing
or out of date. While there are no feeds at all, it says that conflicts with occupations can't be found, and links to
Configuration.

Opened, it lists:

- The conflicts, in the server's order, after « Le studio n'accueille qu'une chose à la fois : déplacez, raccourcissez
  ou annulez l'une des deux. Les occupations se changent dans leur calendrier. ». Each one has the day it starts, as a
  button that shows that day, chosen, in the month, with the focus on it, and the time its two things overlap, in full on
  that day. Then the two things, each with its kind: a session by its title, which links to its page, and an occupation
  by its name.
- The sessions without a date, the most recently added first, under "Sans date". Each one has its title, linking to its
  page, its sets' performers, set by set, the sets separated by "·", and its duration.

## The toolbar

"←" and "→" ("mois précédent" and "mois suivant" for screen readers), which can't go beyond the months the server takes,
the month, e.g. "novembre 2026", which screen readers announce when it changes, "aujourd'hui", which shows today's month
and chooses today, and "nouvelle session", which opens the session form (see [Sessions](sessions.md#the-session-form)).

## The month

A table with the days of the week, "dim" to "sam", then the weeks that have the month's days. The days of the months
before and after are faded out, with what's on them. Today stands out.

Each day lists what takes some of it, in order of start, then end, each with its part of the day and its name (see
[What's shown](#whats-shown)). A session also has its sets' performers, cut short when they don't fit. A thing that's in
a conflict has "conflit" on the days the time it overlaps the other thing takes some of. Screen readers read each thing's
kind before it, e.g. « occupation : RÉPARATION, calendrier Calendrier de l'équipe ».

Clicking a day chooses it, and clicking it again unchooses it. Clicking a session opens its page, without choosing its
day.

With the keyboard, the month is one stop: Tab goes to the chosen day, or else to today, when it's in the month's grid,
or else to the month's first day. The arrows move between days, within the grid, and Enter or Space chooses the day, or
unchooses it. Screen readers name the table by its month, and each day by its date, e.g. "jeudi 19 novembre 2026", say
which one is today, and which one is chosen, and read what's on it. The sessions' links in the month are left out of the
keyboard's way, since the chosen day has them.

### Free time

A day has free time when it's in the 365 days from today, those conflicts are found in, and no session that isn't
cancelled starts on it. Its free time is the parts of the day, from 00:00 to 00:00, that nothing takes, cancelled
sessions aside. Today's stretches count from 00:00 too, even those that are over.

The month shows the free time of its own days, not that of the months before and after. A day that nothing takes is
green, and says "disponible". Otherwise, each stretch has a green tag: "dispo jusqu'à 15 h", "dispo dès 11 h" or "dispo
11 h – 15 h".

## The chosen day

Under the month, the chosen day, with the day as its heading, e.g. "jeudi 19 novembre 2026", and "aujourd'hui" for
today, and a "×" ("fermer le jour" for screen readers) that unchooses it, which puts the focus back on the day in the
month. It has a row for each thing that takes some of the day, in the month's order, with:

- its kind: "session" or "occupation";
- its times, in full on that day (see [What's shown](#whats-shown));
- for a session, its title, linking to its page, its sets' performers, and its status; for an occupation, its name;
- for each other thing it's in conflict with, during some of the day, "conflit avec" that thing, e.g. « conflit avec la
  session HAUTE RIVE TAKEOVER », « conflit avec l'occupation RÉPARATION (Calendrier de l'équipe) ».

Then, when the day has free time, a "disponible" row, with "toute la journée", or its stretches, e.g. "jusqu'à 15 h,
dès 20 h". On a day without anything, « Rien ce jour-là. ». From today on, "nouvelle session ce jour →" opens the
session form on that day (see [The session form](sessions.md#the-session-form)).

## Sources

Where each kind of thing comes from:

- Sessions: from the site, linking to [Sessions](sessions.md).
- Occupations: each feed, by name, with "titres masqués" when its titles are private, when it was last read, or that it
  hasn't been read yet, and why its last read failed, as [Configuration](configuration.md#calendriers-externes) says it.
  Without feeds, it says so, and that they're added in Configuration, "Calendriers externes", linking to Configuration.

## Loading and errors

When the calendar can't be read, the page says why at its top, until it's read again. "À régler" and "Sources" show the
last calendar read, whatever its days, and nothing before the first. The month and the chosen day only show what a
calendar read for the month's days has: until then, its days show only their numbers, and the chosen day only its
heading and "nouvelle session ce jour →".

## Endpoints

- `GET /api/admin/calendar`, for the days of the month's grid, within those the server takes. It's read when the page
  opens, when the month changes, and when the browser's tab is shown again.
