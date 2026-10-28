import { createContext, use } from 'react'
import type { Schema } from './api/client'

// Environment-specific values fetched from the server at runtime, and which features are on. ConfigProvider in
// config.tsx does the fetching; this lives in its own file because a module exporting both a component and a hook
// breaks Fast Refresh.
export type AppConfig = Schema<'Config'>

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
 * Returns whether a feature flag is on (see docs/design/server/features.md), or undefined until that's known. A page that
 * depends on a flag shows nothing until then, rather than one version of itself before switching to the other. When
 * the configuration can't be fetched, every flag is off, since off is the safe option.
 */
export function useFeature(id: Schema<'FeatureId'>): boolean | undefined {
  const state = use(ConfigContext)
  if (state.kind === 'loading') return undefined
  return state.kind === 'loaded' && state.config.features[id] === true
}

/**
 * Cloudflare Turnstile's site key, for the "Appliquer" form: undefined until the configuration is fetched, or if it
 * can't be.
 */
export function useTurnstileSiteKey(): string | undefined {
  const state = use(ConfigContext)
  return state.kind === 'loaded' ? state.config.turnstileSiteKey : undefined
}
