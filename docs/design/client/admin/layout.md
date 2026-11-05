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
- [Admins](admins.md)
- [Configuration](configuration.md)

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
[Candidatures](candidatures.md) and [Sessions](sessions.md)), find the entries that have every word searched for, in any
of the fields searched, whatever their case and accents, with "œ" and "æ" the same as "oe" and "ae", and allowing for
about one typo every 5 letters. A day of the month next to a month, before or after it (e.g. "26 déc" or "déc 26"), with
or without the year after them, is searched as a date, which counts as one word: it finds only the entries with that day
written out in one field (e.g. "samedi 26 décembre 2026"), not those that merely have "26" and "déc" somewhere. The
month is in French, written out or by its first three letters or more, as long as no other month starts with them (e.g.
"sept" or "juil", but not "jui"). The day can be written "1er" or "01". Words are read from left to right, so "3 déc 26"
is the date "3 déc", then the word "26". The search and the order are kept in the page's address, along with the status
of applications or sessions, so that going back to a list from one of its entries with the browser's back button finds
it as it was. The address's parameters are `search` (what's searched for), `sort` (the column the list is sorted by, as
each page names it), `order` (`asc` or `desc`, which only counts along with `sort`) and `status` (as the server names
it, e.g. `accepted`). Without `order`, "Reçue le" and "Date" sort the latest first, and every other column sorts in
ascending order. A value the page doesn't know is ignored, as if the parameter weren't there.

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
without a tooltip.

## Endpoints

- `GET /api/admin/me`, to know whether there's a session, and the admin's email.
- `POST /api/auth/login`, from the login form.
- `POST /api/auth/logout`, from "se déconnecter".
