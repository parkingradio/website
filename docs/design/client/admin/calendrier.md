# Calendrier

At `/admin/calendrier`: what takes the studio, i.e. sessions, occupations and quiet time, and what needs settling (see
[Calendar](../../server/calendar.md)). Days and times are in Québec time (see [Admin](layout.md)), and weeks start on
Sunday. From top to bottom, the page has "À régler", the toolbar, the month, the chosen day and "Sources".

"Today" is the day it is in Québec, by the browser's clock.

## What's shown

There are three kinds of things, plus the studio's free time and conflicts. Each one has a color and, besides the color,
words that say what it is:

- Sessions: light blue, with a dark blue bar on their left, and their title. Sessions that are done or cancelled take the
  [status colors](layout.md#status-colors), with "jouée" or "annulée" written. Past planned sessions keep their color,
  so that one that wasn't marked "jouée" stands out.
- Occupations: light blue too, with a dashed border, and their title, or "sans titre" without one.
- Quiet time: a hatched violet band, with "silence". It never has a title: the page only names it "silence", and by its
  feed's name.
- Free time: green, with "disponible" or "dispo …" (see [Free time](#free-time)).
- Conflicts: a red border, with "conflit".

Occupations and quiet time can't be changed on the site: where the page names one, it names the calendar it's changed
in, by its feed's name. A legend, under the toolbar, gives each kind with its color.

A thing's times are written in two ways:

- **Its part of a day**, in the month: of the time the thing takes, the part from 00:00 on the day to 00:00 on the next.
  When that's the whole day, "toute la journée", whole-day or not. Else, when the thing started on an earlier day,
  "jusqu'à 1 h". Else, when it ends within the day, or at 00:00 on the next, "21 h – 23 h". Else, when it lasts less
  than a day and ends the next day at an earlier time than it starts, "21 h – 1 h", like a session's times in short
  (see [Times, in Sessions](sessions.md#times)), and "jusqu'à 1 h" on the next day. Else "dès 18 h".
- **In full**, on a day, e.g. the chosen day: when it takes whole days, from 00:00 to 00:00, whole-day or not,
  "toute la journée" for one day, or "du ven. 13 nov. au dim. 15 nov." from its first day to its last. Else, when it
  starts on that day, as a session's times in short: "21 h – 23 h", "21 h – 1 h", or "18 h – dim. 15 nov., 2 h". Else
  the same, after the day it starts: "ven. 13 nov., 21 h – 1 h".

## The address

- `month=YYYY-MM`: the month shown, from 2000-01 to 2999-12, which the server takes. Without it, or with a value the
  page doesn't know, it's today's month.
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
or out of date. While there are no feeds at all, it says that conflicts with occupations and quiet time can't be found,
and links to Configuration.

Opened, it lists:

- The conflicts, in the server's order, after « Le studio n'accueille qu'une chose à la fois : déplacez, raccourcissez
  ou annulez l'une des deux. ». Each one has the day it starts, as a button that shows that day, chosen, in the month,
  with the focus on it, and the time its two things overlap, in full on that day. Then the two things, each with its
  kind: a session's title links to its page, and an occupation, by its title, or quiet time, says « à changer dans le
  calendrier « Calendrier de l'équipe » », by its feed's name.
- The sessions without a date, the most recently added first, under "Sans date". Each one has its title, linking to its
  page, its sets' performers, set by set, the sets separated by "·", and its duration.

Conflicts are those of the next 365 days (see [Conflicts](../../server/calendar.md#conflicts)): in the month, things
show "conflit" only in those days.

## The toolbar

"←" and "→" ("mois précédent" and "mois suivant" for screen readers), the month, e.g. "novembre 2026", which screen
readers announce when it changes, "aujourd'hui", which shows today's month and chooses today, and "nouvelle session",
which opens the session form (see [Sessions](sessions.md#the-session-form)). "←" can't be used on 2000-01, saying « Le
calendrier commence en 2000. », nor "→" on 2999-12, saying « Le calendrier s'arrête en 2999. » (see
[Controls that can't be used](layout.md#controls-that-cant-be-used)).

## The month

A table with the days of the week, "dim" to "sam", then the weeks that have the month's days, 4 to 6 of them. The days
of the months before and after are faded out, with what's on them. Today's number is in a black square.

Each day lists what takes some of it, its quiet time first, as a band, then its sessions and occupations, in order of
their start, each with its part of the day (see [What's shown](#whats-shown)). A session also has its sets' performers,
cut short when they don't fit. A thing that's in a conflict has "conflit" on the days the time it overlaps the other
thing takes some of. Screen readers read each thing's kind before it, e.g. « occupation : RÉPARATION ».

Clicking a day chooses it, outlined in black, and clicking it again unchooses it. Clicking a session opens its page,
without choosing its day.

With the keyboard, the month is one stop: Tab goes to the chosen day, or else to today, when it's in the month's grid,
or else to the month's first day. The arrows go to the day before or after, or to the same day of the week before or
after, and stop at the grid's edges. Enter or Space chooses the day, or unchooses it. Screen readers name each day,
e.g. "jeudi 19 novembre 2026", say which one is today, and which one is chosen. The sessions' links in the month are
left out of the keyboard's way, since the chosen day has them.

### Free time

Free time is shown on the days of the month shown, from today to the 365th day, the days where conflicts are found, on
which no session that isn't cancelled starts, and no occupation. Its stretches are the day's time, from 00:00 to 00:00,
outside what takes some of it: quiet time, and things that started on an earlier day. A day with nothing on it at all
is green, and says "disponible". Otherwise, each stretch has a green tag: "dispo jusqu'à 15 h", "dispo dès 11 h" or
"dispo 11 h – 15 h". Today's count from 00:00 too, even once they're over.

## The chosen day

Under the month, the chosen day, with the day as its heading, e.g. "jeudi 19 novembre 2026", and "aujourd'hui" for
today, and a "×" ("fermer le jour" for screen readers) that unchooses it, which puts the focus back on the day in the
month. It has a row for each thing that takes some of the day, in the month's order, with:

- its kind: "session", "occupation" or "silence";
- its times, in full on that day (see [What's shown](#whats-shown));
- for a session, its title, linking to its page, its sets' performers, and its status; for an occupation, its title, and
  the calendar it's changed in, by its feed's name; for quiet time, that calendar;
- for each of its conflicts whose overlap takes some of the day, "conflit avec" the other thing, e.g. « conflit avec la
  session HAUTE RIVE TAKEOVER ».

Then, when the day has free time, a "disponible" row, with "toute la journée", or its stretches, e.g. "jusqu'à 15 h,
dès 20 h". On a day without anything, « Rien ce jour-là. ». From today on, "nouvelle session ce jour →" opens the session form on that day (see
[The session form](sessions.md#the-session-form)).

## Sources

Where each kind of thing comes from:

- Sessions: from the site, linking to [Sessions](sessions.md).
- Occupations and quiet time: each of their feeds, by name, with when it was last read, or that it hasn't been read yet,
  and why its last read failed, as [Configuration](configuration.md#calendriers-externes) says it. A kind without feeds
  says so, and that they're added in Configuration, "Calendriers externes", linking to Configuration.

## Loading and errors

When the calendar can't be read, the page says why at its top, « Le calendrier n'a pas pu être chargé : … », until it's
read again. "À régler" and "Sources" show the last calendar read, whatever its days, and nothing before the first. The
month and the chosen day only show things, and free time, from a calendar read for the month's days: while another
month loads, or when it couldn't be read, its days show only their numbers, and the chosen day only its heading and
"nouvelle session ce jour →".

## Endpoints

- `GET /api/admin/calendar`, from the first day of the month's grid to its last, or from 2000-01-01, or to 2999-12-31,
  when the grid goes beyond them. It's read when the page opens, when the month changes, and when the browser's tab is
  shown again, at most once a minute.
