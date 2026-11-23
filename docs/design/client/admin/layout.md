# Admin

This part of the site provides the tools Parking Radio's team uses to run the project. It lives under
`/admin`, which isn't linked from the navigation bar.

Every admin page requires being logged in (see [Admins](../../server/admins.md)). Logged out, a page shows a login
form in its place, and once logged in it shows the page that was asked for. This includes a session that ends while a
page is open, e.g. when it expires or when the admin logs out in another tab (see
[Sessions](../../server/admins.md#sessions)): as soon as an admin request fails because there's no session (see
[Conventions](../../server/README.md#conventions)), the page gives way to the login form, losing what wasn't saved, with
a notice saying that the session ended. Logging in then shows the page again, loaded anew. When the pages can't tell
whether there's a session, e.g. because the server can't be reached, they say so in place of the page, rather than
showing the login form.

The admin pages keep the site's navigation bar. Under it, a menu lists the sections, in this order, followed by the
logged-in admin's email and a "se déconnecter" button:

- [Calendrier](calendrier.md)
- [Rotation radio](rotation.md)
- [Candidatures](candidatures.md)
- [Sessions](sessions.md)
- [Artistes](artistes.md)
- [Intégrations](integrations.md)
- [Admins](admins.md)
- [Configuration](configuration.md)

While there are conflicts (see [Conflicts](../../server/calendar.md#conflicts)), "calendrier" has a red badge with how
many there are, which screen readers read along with it, e.g. « calendrier, 2 conflits », and it opens Calendrier with
"À régler" open (`?issues=open`, see [Calendrier](calendrier.md#the-address)). The number is read again each time an
admin page opens, and when the browser's tab is shown again, at most once a minute; on Calendrier, it's the number
"À régler" shows. When it can't be read, the badge stays as it was, and there's none until it's been read once.

When logging out fails, the admin stays logged in, and the menu says so under "se déconnecter". The section itself is
shown to the right of the menu. On narrow screens like phones, the menu becomes a row above the section instead.
`/admin` shows the first section, Calendrier. `/login`, where logging in used to be, leads to `/admin`.

The admin pages show "-" in place of what an admin left out of an artist's or a collective's profile (see
[Profiles](../../server/artists.md#profiles) and [Profiles](../../server/collectives.md#profiles)), or only the city or
the country, when the other one is, and in place of a collective's genres when its artists have none.

The admin pages show dates and times in Québec time, whatever the browser's time zone, since that's where Parking Radio
is (see [Times, in Conventions](../../server/README.md#conventions)), and take them in Québec time too.

## Searching lists

The lists of artists and collectives, of applications and of sessions (see [Artistes](artistes.md),
[Candidatures](candidatures.md) and [Sessions](sessions.md)), find the entries that have every word searched for, on its
own or in a longer word (e.g. "mar" in "mardi"), in any of the fields searched, whatever their case and accents, with
"œ" and "æ" the same as "oe" and "ae", and allowing for about one typo every 5 letters.

A day of the month with a month or a weekday next to it, before or after it, or a weekday on one side and a month on the
other (e.g. "26 déc", "déc 26", "sam 26" or "sam. 26 déc."), with or without the year after them, is searched as a date,
which counts as one word: it finds only the entries with that day written out in one field (e.g.
"samedi 26 décembre 2026"), not those that merely have "26" and "déc" somewhere, or "samedi 26" without a month after it
("sam 26" finds "samedi 26 décembre 2026", whatever the month, but not "samedi 26 ou dimanche 27"). Months and weekdays
are in French, written out or by their first three letters or more, as long as no other month, or no other weekday,
starts with them (e.g. "sept", "juil" or "sam", but not "jui"). "mar" can be either: "mar 5" finds March 5th and
Tuesdays the 5th, but "mar 5 jan" only Tuesday, January 5th, and "jeu 5 mar" Thursday, March 5th. The day can be written
"1er" or "01". Words are read from left to right, so "déc 26 janv 3" is the dates "déc 26" and "janv 3", and "3 déc 26"
the date "3 déc", then the word "26".

The search and the order are kept in the page's address, along with the status of applications or sessions, and whether
sessions are announced, so that going back to a list from one of its entries with the browser's back button finds it as
it was. The address's parameters are `search` (what's searched for), `sort` (the column the list is sorted by, as each
page names it), `order` (`asc` or `desc`, which only counts along with `sort`), `status` (as the server names it, e.g.
`accepted`, or `all` for every status) and `announced` (see [Sessions](sessions.md#the-list)). A value the page doesn't
know is ignored, as if the parameter weren't there.

Without `status`, a list that has statuses shows its default view, which its page names; picking that status with its
button gives the same view. Without `sort`, a list is in the order its page gives, for the status shown when it has
statuses. `sort` without `order` sorts that way when it names the column that order is by, and in ascending order
otherwise.

## Status colors

Wherever the admin pages list applications, sessions or sets, or show them, e.g. in [Calendrier](calendrier.md), those
that are done, their rows or their blocks, are greyed out, text, links and background, and rejected applications and
cancelled sessions and sets are faded out the same way, in a color of their own, yellow, so that the two are told apart
at a glance. Each one also has its status written, so that it isn't told by color alone, except in Calendrier's month on
narrow screens like phones, whose sessions are marks, done ones grey and cancelled ones hollow: the chosen day writes
their status, and screen readers read it with the day (see [On phones, in Calendrier](calendrier.md#on-phones)).

Buttons that change a status, e.g. on a session's page, show the status the entry has in black, even when it can't be
picked (see [Controls that can't be used](#controls-that-cant-be-used)), e.g. an application's that its sets give it,
and the others only turn grey while hovered, rather than black like other buttons, so that the one just clicked doesn't
look picked when the entry doesn't get that status, e.g. when saving it fails.

## Warnings

A warning, about something that's probably a mistake but that doesn't prevent anything, e.g. a session's sets that add up
to more than it (see [Sessions](sessions.md#a-sessions-page)), is a sentence that starts with a "⚠", in brown, set apart
like the pages' other notices, so that it isn't told by color alone either.

## Tooltips

Some controls have a tooltip, under them, or above them when there's no room below, e.g. to say why they can't be used
(see [Controls that can't be used](#controls-that-cant-be-used)). It shows while the control is hovered with a mouse, or
has the keyboard's focus, and stays while the pointer moves onto it. On touch screens, tapping the control, with a finger
or a pen, shows it until the control is tapped again, or something else is, or the focus leaves it. Escape hides it, even
while the control is hovered or focused. Screen readers read it as the control's description. Only controls that do
nothing else when they're clicked have one.

## Controls that can't be used

A control that a rule keeps from being used, e.g. "ajouter un set" while a session is cancelled, stays where it is,
greyed out, and its tooltip says why (see [Tooltips](#tooltips)), rather than the page explaining the rule in a
sentence. It keeps the keyboard's focus, so that its tooltip can be read, and screen readers announce it as unavailable.
Clicking it does nothing. A control that can't be used for a moment, e.g. while a change is saved, is only greyed out,
without a tooltip. An option that a rule keeps from being picked in a list of options, e.g. a rejected application in a
planned set's form, is listed greyed out, and screen readers announce it as unavailable.

A dropdown that a rule keeps from being used in every row of a list, e.g. the statuses of a cancelled session's sets, is
replaced by its value, written out, and the list says why once, above it, rather than in a tooltip.

## Reordering

Some lists whose order counts, e.g. a set's performers, are reordered by dragging their items by a handle, a block of
dots at the start of each item: with a mouse, or on a touch screen once it's held for a moment. Only the handle starts a
drag, so that elsewhere the items' links and buttons work as usual, and swiping scrolls the page. The item moves to
where it's dropped, and the others make room for it, but the list's order only changes once it's dropped. Escape puts it
back. Dragging with a mouse or a finger doesn't scroll the page, since the lists are short.

The handle also works with the keyboard: Space or Enter picks the item up, the up and down arrows move it one place, and
Space, Enter or Tab drops it, while moving the focus elsewhere, e.g. by clicking, puts it back. The focus stays on the
handle. Screen readers name the handle after its item, e.g. "réordonner Aurore", describe how to use it with the
keyboard, and announce, in French, when the item is picked up, each place it's moved to, and where it's dropped, or that
it's put back, with its place, e.g. « Aurore est maintenant en position 2 sur 3. ».

While a list can't be changed for a moment, e.g. while it's sent, or while a move is saved, its handles are greyed out
(see [Controls that can't be used](#controls-that-cant-be-used)), but keep the focus.

## Endpoints

- `GET /api/admin/me`, to know whether there's a session, and the admin's email.
- `POST /api/auth/login`, from the login form.
- `POST /api/auth/logout`, from "se déconnecter".
- `GET /api/admin/calendar`, for the badge on "calendrier".
