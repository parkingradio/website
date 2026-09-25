import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConfigResponse } from 'shared/config'
import { ConfigContext } from './config-context'
import type { AppConfig } from './config-context'

/** Fetches the runtime configuration and makes it available through `useAssetUrl`. */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/config')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: ConfigResponse) => {
        if (!cancelled) setConfig({ assetsDomain: body.assetsDomain })
      })
      .catch(() => console.error('Failed to load /api/config: asset URLs will not resolve'))
    return () => {
      cancelled = true
    }
  }, [])

  return <ConfigContext value={config}>{children}</ConfigContext>
}
