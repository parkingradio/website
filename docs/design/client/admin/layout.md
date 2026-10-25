# Admin

This part of the site provides the tools Parking Radio's team uses to run the project. It lives under
`/admin`, which isn't linked from the navigation bar.

Every admin page requires being logged in (see [Admins](../../server/admins.md)). Logged out, a page shows a login
form in its place, and once logged in it shows the page that was asked for.

The admin pages keep the site's navigation bar. Under it, a menu lists the sections, in this order, followed by the
logged-in admin's email and a "se déconnecter" button:

- [Calendrier](calendrier.md)
- [Rotation radio](rotation.md)
- [Candidatures](candidatures.md)
- [Artistes](artistes.md)
- [Admins](admins.md)
- [Configuration](configuration.md)

The section itself is shown to the right of the menu. On narrow screens like phones, the menu becomes a row above the
section instead. `/admin` shows the first section, Calendrier.

The admin pages show "-" in place of what an admin left out of an artist's profile (see
[Profiles](../../server/artists.md#profiles)), or only the city or the country, when the other one is.

## Searching lists

The lists of artists and applications (see [Artistes](artistes.md) and [Candidatures](candidatures.md)) find the
entries that have every word searched for, in any of the fields searched, whatever their case and accents, and allowing
for a typo in words of 5 letters or more. The search and the order are kept in the page's address, along with the
applications' status, so that going back to a list from one of its entries with the browser's back button finds it as
it was.

## Endpoints

- `GET /api/admin/me`, to know whether there's a session, and the admin's email.
- `POST /api/auth/login`, from the login form.
- `POST /api/auth/logout`, from "se déconnecter".
