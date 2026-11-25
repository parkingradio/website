# Admins

At `/admin/admins`: manages who can access the admin pages (see [Admins](../../server/admins.md)).

- "Inviter un admin": emails an invite to a given address. It checks the address as the server does first (see
  [`POST /api/admin/invite`](../../server/admins.md#post-apiadmininvite-admin)): when it isn't an email address, even
  when it's blank, nothing is sent, and "Adresse e-mail invalide." shows under the field, in place of what the previous
  invite said, until the field changes.
- "Admins existants": lists the admins by email, with "(vous)" next to the admin's own, their status ("actif",
  "invitation envoyée" with when it expires, or "invitation expirée"), and when they were added and by whom. "révoquer"
  revokes another admin after confirming, which ends their sessions and connections, and makes the links to their
  calendars stop working (see [Admins' calendars](../../server/admin-calendars.md#the-token)), or cancels their invite if
  they haven't accepted it. Those who haven't can be invited again with "renvoyer".

## Accepting an invite

The invite links to `/accept-invite`, where the new admin chooses their password (see
[`POST /api/auth/accept-invite`](../../server/admins.md#post-apiauthaccept-invite) for what it has to be), typing it
twice. Saving it logs out whoever was logged in in that browser, and the page then leads to the login form at `/admin`,
which says that it was saved. When someone is logged in, the page says so above the form: "Ce navigateur est connecté en
tant que <email>. Enregistrer ce mot de passe le déconnectera."; while it can't tell, it says nothing. The link `tools/create-admin` gives also leads
to `/accept-invite` (see [Roles](../../server/admins.md#roles)). The page is outside `/admin`, and doesn't require being
logged in.

## Endpoints

- `GET /api/admin/admins`, for the list.
- `POST /api/admin/invite`, for "Inviter un admin" and "renvoyer".
- `DELETE /api/admin/admins/:id`, for "révoquer".
- `GET /api/admin/me`, on `/accept-invite`, to say who's logged in.
- `POST /api/auth/accept-invite`, from `/accept-invite`.
