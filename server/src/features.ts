import { FEATURES } from 'shared/features'
import type { FeatureId } from 'shared/features'
import type { Queryable } from './db.js'
import { featureFlags } from './schema.js'

// The feature flags admins turned on or off (see shared/src/features.ts).

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
