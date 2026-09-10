import { createContext, use } from 'react'

// Environment-specific values fetched from the server at runtime. ConfigProvider in config.tsx
// does the fetching; this lives in its own file because a module exporting both a component and
// a hook breaks Fast Refresh.
export type AppConfig = { assetsDomain: string }

export const ConfigContext = createContext<AppConfig | null>(null)

/**
 * Returns a function building the public URL of a static asset from its key in the assets bucket.
 * Because the configuration arrives over the network, the URL is undefined until it has been
 * fetched, and consumers render without one until then.
 */
export function useAssetUrl(): (key: string) => string | undefined {
  const config = use(ConfigContext)
  return (key: string) => (config ? `https://${config.assetsDomain}/${key}` : undefined)
}
