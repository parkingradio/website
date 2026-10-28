# Features

Feature flags are switches that admins turn on and off, to change what the site does without deploying it again.
They're meant for going back to the old version of something if the new one has a problem.

## Flags

Every flag is off until an admin turns it on, so that a flag can be deployed without changing anything until then.
Pages read the flags in the `features` field of [`GET /api/config`](README.md#get-apiconfig), and behave as if a flag
were off when they can't know whether it's on (see [Feature flags](../client/architecture.md#feature-flags)). For that
reason, "off" always has to be the safe option: the old version, or the one that relies the least on our own server.

The flags, in the order `GET /api/admin/features` returns them, are (`FEATURES` in `server/src/features/store.ts`):

| Id | What it switches on |
|---|---|
| `nouveau-lecteur` | The shared player (see [Player](../client/player.md)) |

Retiring a flag takes removing it from this list and from `FEATURES`, and from the admin pages (see
[Configuration](../client/admin/configuration.md#features)). The server ignores what it saved for flags that aren't
listed. A retired flag's id isn't reused, since what was saved for it would apply to the new flag.

## `GET /api/admin/features` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `features` | list of flags | Every flag, in the order of the list above. See below |

Each flag:

| Field | Type | |
|---|---|---|
| `id` | string | E.g. `"some-flag"` |
| `enabled` | boolean | Whether it's on |
| `updatedBy`, `updatedAt` | string or null | Who last turned it on or off (an admin's email), and when |

## `PUT /api/admin/features/:id` (admin)

| Request field | Type | |
|---|---|---|
| `enabled` | boolean | Whether to turn it on or off |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `feature` | flag | The flag, like in `GET /api/admin/features` |

Turns the flag on or off. Fails with 400 if `enabled` isn't a boolean, or 404 if there's no such flag, including one
that was retired.
