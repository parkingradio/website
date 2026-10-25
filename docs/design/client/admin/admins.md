# Admins

At `/admin/admins`: manages who can access the admin pages (see [Admins](../../server/admins.md)).

- "Inviter un admin": emails an invite to a given address.
- "Admins existants": lists the admins by email, with "(vous)" next to the admin's own, their status ("actif",
  "invitation envoyée" with when it expires, or "invitation expirée"), and when they were added and by whom. "révoquer"
  revokes another admin after confirming, which ends their sessions, or cancels their invite if they haven't accepted
  it. Those who haven't can be invited again with "renvoyer".

## Accepting an invite

The invite links to `/accept-invite`, where the new admin chooses their password, after which they can log in. So does
the link `tools/create-admin` gives (see [Roles](../../server/admins.md#roles)). The page is outside `/admin`, and
doesn't require being logged in.

## Endpoints

- `GET /api/admin/admins`, for the list.
- `POST /api/admin/invite`, for "Inviter un admin" and "renvoyer".
- `DELETE /api/admin/admins/:id`, for "révoquer".
- `POST /api/auth/accept-invite`, from `/accept-invite`.
