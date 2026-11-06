import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api/client'
import { ConfigContext } from './config-context'
import type { ConfigState } from './config-context'

/**
 * Fetches the runtime configuration and makes it available through `useAssetUrl`, `useFeature`, `useTurnstileSiteKey`
 * and `useEnvironmentStamp`.
 */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfigState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    api.GET('/api/config').then((result) => {
      if (!result.ok) console.error('Failed to load /api/config: asset URLs will not resolve, every feature is off, the "Appliquer" form cannot be sent, and pages do not show their environment')
      if (!cancelled) setState(result.ok ? { kind: 'loaded', config: result } : { kind: 'failed' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return <ConfigContext value={state}>{children}</ConfigContext>
}
