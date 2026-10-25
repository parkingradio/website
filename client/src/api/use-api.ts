import { useEffect, useState } from 'react'
import { api } from './client'
import type { ParamsOption } from 'openapi-fetch'
import type { ApiError, Data, Init, InitParam, PathsWith } from './client'
import type { paths } from './schema'

export type Loaded<T> = { kind: 'loading' } | { kind: 'loaded'; value: T } | { kind: 'error'; message: string }

type Options<Path extends PathsWith<'get'>> = ParamsOption<paths[Path]['get']> & {
  // GETs it again whenever this changes.
  version?: number
}

// GETs `path`, with the parameters it needs if it has any, e.g. `useApi('/api/admin/features')`, and again whenever the
// path, its parameters or `version` change.
export function useApi<Path extends PathsWith<'get'>>(
  path: Path,
  ...[options]: InitParam<Options<Path>>
): Loaded<Data<'get', Path> & { ok: true }> {
  const [loaded, setLoaded] = useState<Loaded<Data<'get', Path> & { ok: true }>>({ kind: 'loading' })
  // Compared by value, so that they can be written inline.
  const params = JSON.stringify(options?.params ?? {})
  const version = options?.version ?? 0

  useEffect(() => {
    let cancelled = false
    const init = [{ params: JSON.parse(params) }] as InitParam<Init<'get', Path>>
    api.GET(path, ...init).then((result) => {
      if (cancelled) return
      // TypeScript can't tell success from failure by `ok` in a type that depends on `Path`.
      const settled = result as { ok: true } | ApiError
      if (settled.ok) setLoaded({ kind: 'loaded', value: result as Data<'get', Path> & { ok: true } })
      else setLoaded({ kind: 'error', message: settled.error })
    })
    return () => {
      cancelled = true
    }
  }, [path, params, version])

  return loaded
}
