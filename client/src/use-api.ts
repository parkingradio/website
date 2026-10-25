import { useEffect, useState } from 'react'
import { getJson } from './api'
import type { Loaded } from './api/use-api'

export type { Loaded }

// GETs `url`, and again whenever `version` changes. Only for the endpoints that aren't in openapi.json yet: the others go
// through the typed `useApi` of api/use-api.ts.
export function useApi<T>(url: string, version = 0): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    getJson<T>(url).then((result) => {
      if (cancelled) return
      setLoaded(result.ok ? { kind: 'loaded', value: result } : { kind: 'error', message: result.error })
    })
    return () => {
      cancelled = true
    }
  }, [url, version])

  return loaded
}
