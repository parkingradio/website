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
- [Artistes](artistes.md)
- [Admins](admins.md)
- [Configuration](configuration.md)

When logging out fails, the admin stays logged in, and the menu says so under "se déconnecter". The section itself is
shown to the right of the menu. On narrow screens like phones, the menu becomes a row above the section instead.
`/admin` shows the first section, Calendrier. `/login`, where logging in used to be, leads to `/admin`.

The admin pages show "-" in place of what an admin left out of an artist's or a collective's profile (see
[Profiles](../../server/artists.md#profiles) and [Profiles](../../server/collectives.md#profiles)), or only the city or
the country, when the other one is, and in place of a collective's genres when its artists have none.

## Searching lists

The lists of artists and collectives, and of applications (see [Artistes](artistes.md) and
[Candidatures](candidatures.md)), find the entries that have every word searched for, in any of the fields searched,
whatever their case and accents, and allowing for about one typo every 5 letters. The search and the order are kept in
the page's address, along with the applications' status, so that going back to a list from one of its entries with the
browser's back button finds it as it was.

## Endpoints

- `GET /api/admin/me`, to know whether there's a session, and the admin's email.
- `POST /api/auth/login`, from the login form.
- `POST /api/auth/logout`, from "se déconnecter".
