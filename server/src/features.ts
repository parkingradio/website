import { z } from 'zod'
import type { Queryable } from './db.js'
import { featureFlags } from './schema.js'

// Feature flags: switches that admins turn on and off, to change what the site does without deploying it again (see
// docs/design/server/features.md). Every flag is off until an admin turns it on, and "off" has to be the safe option.

// The flags, in the order the admin pages show them. Adding a flag takes adding its id here, then its name on the admin
// pages (FEATURE_LABELS in the client), which gets the ids from openapi.json, once it's regenerated with
// `npm run generate:api`. Removing one from here retires it: the server ignores what it saved for flags that aren't
// listed.
export const FEATURES = ['nouveau-formulaire-candidature', 'nouveau-lecteur'] as const

export const FeatureId = z.enum(FEATURES).meta({ id: 'FeatureId' })
export type FeatureId = z.infer<typeof FeatureId>

// A flag, as admins turned it on or off.
export type StoredFeature = {
  id: FeatureId
  enabled: boolean
  // The email of the admin who last turned the flag on or off, and when. Null until then.
  updatedBy: string | null
  updatedAt: Date | null
}

export class NoSuchFeature extends Error {}

export type FeaturesStore = {
  // Every flag, in the order of FEATURES.
  load(): Promise<StoredFeature[]>
  // Turns a flag on or off, and returns it. Throws NoSuchFeature if `id` isn't one of the flags, e.g. a retired one.
  save(id: string, enabled: boolean, updatedBy: string): Promise<StoredFeature>
}

// Each of the flags in `ids`, in that order, as saved in `rows`. A flag without a row is off, and rows for flags that
// aren't in `ids` were retired, so they're left out.
export function currentFeatures(ids: readonly FeatureId[], rows: { id: string; enabled: boolean; updatedBy: string; updatedAt: Date }[]): StoredFeature[] {
  return ids.map((id) => {
    const row = rows.find((row) => row.id === id)
    return row ? { ...row, id } : { id, enabled: false, updatedBy: null, updatedAt: null }
  })
}

// `ids` are the flags, i.e. FEATURES, which tests replace with their own.
export function featuresStore(db: Queryable, ids: readonly FeatureId[] = FEATURES): FeaturesStore {
  return {
    async load() {
      return currentFeatures(ids, await db.select().from(featureFlags))
    },

    async save(sent, enabled, updatedBy) {
      const id = ids.find((id) => id === sent)
      if (id === undefined) throw new NoSuchFeature()
      const feature = { id, enabled, updatedBy, updatedAt: new Date() }
      await db.insert(featureFlags).values(feature).onConflictDoUpdate({ target: featureFlags.id, set: feature })
      return feature
    },
  }
}
