import { createContext, use } from 'react'
import type { ConfigResponse } from 'shared/config'
import type { FeatureId } from 'shared/features'

// Environment-specific values fetched from the server at runtime, and which features are on. ConfigProvider in
// config.tsx does the fetching; this lives in its own file because a module exporting both a component and a hook
// breaks Fast Refresh.
export type AppConfig = Pick<ConfigResponse, 'assetsDomain' | 'features'>

export type ConfigState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; config: AppConfig }

export const ConfigContext = createContext<ConfigState>({ kind: 'loading' })

/**
 * Returns a function building the public URL of a static asset from its key in the assets bucket.
 * Because the configuration arrives over the network, the URL is undefined until it has been
 * fetched, and consumers render without one until then.
 */
export function useAssetUrl(): (key: string) => string | undefined {
  const state = use(ConfigContext)
  return (key: string) => (state.kind === 'loaded' ? `https://${state.config.assetsDomain}/${key}` : undefined)
}

/**
 * Returns whether a feature flag is on (see shared/src/features.ts), or undefined until that's known. A page that
 * depends on a flag shows nothing until then, rather than one version of itself before switching to the other. When
 * the configuration can't be fetched, every flag is off, since off is the safe option.
 */
export function useFeature(id: FeatureId): boolean | undefined {
  const state = use(ConfigContext)
  if (state.kind === 'loading') return undefined
  return state.kind === 'loaded' && state.config.features[id] === true
}
