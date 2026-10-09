// Feature flags: switches that admins turn on and off on the admin pages, to change what the site does without deploying
// it again. E.g. if a new page has a problem, turning its flag off brings back the old one.
//
// Every flag is off until an admin turns it on. Pages behave as if a flag were off when they can't know it, e.g. when
// `GET /api/config` fails, so "off" has to be the safe option: the old behaviour, or the one that relies the least on
// this server.

// The flags, in the order the admin pages show them. Adding a flag only takes adding its id here, and its name on the
// admin pages. Removing one from here retires it: the server ignores what it saved for flags that aren't listed.
export const FEATURES = [] as const

export type FeatureId = (typeof FEATURES)[number]

// In the response of `GET /api/config` (see config.ts): whether each flag is on, by id. A flag that isn't there is off.
export type Features = Record<FeatureId, boolean>

// A flag, as the admin pages show it.
export type Feature = {
  id: FeatureId
  enabled: boolean
  // Who last turned the flag on or off (an admin's email), and when (ISO 8601). Null until then.
  updatedBy: string | null
  updatedAt: string | null
}

// All the endpoints below require an admin session, and fail with 401 without one.

// `GET /api/admin/features`: every flag, in the order of FEATURES.
export type FeaturesResponse = { ok: true; features: Feature[] }

// `PUT /api/admin/features/:id`: turns a flag on or off, and returns it. Visitors get the change as soon as they load a
// page of the site. Fails with 400 if `enabled` isn't a boolean, or 404 if there's no such flag.
export type FeatureRequest = { enabled: boolean }
export type FeatureResponse = { ok: true; feature: Feature }
