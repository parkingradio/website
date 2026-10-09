import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConfigResponse } from 'shared/config'
import { ConfigContext } from './config-context'
import type { ConfigState } from './config-context'

/** Fetches the runtime configuration and makes it available through `useAssetUrl` and `useFeature`. */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfigState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/config')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: ConfigResponse) => {
        if (!cancelled) setState({ kind: 'loaded', config: body })
      })
      .catch(() => {
        console.error('Failed to load /api/config: asset URLs will not resolve, and every feature is off')
        if (!cancelled) setState({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return <ConfigContext value={state}>{children}</ConfigContext>
}
