import { useEffect, useState } from 'react'
import { getJson } from './api'

export type Loaded<T> = { kind: 'loading' } | { kind: 'loaded'; value: T } | { kind: 'error'; message: string }

// GETs `url`, and again whenever `version` changes.
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
