/**
 * Wraps `load` so that its outcome, successful or not, is reused until the time `expiresAt` returns for it,
 * in milliseconds since the epoch. Calls made while `load` is in flight share it rather than starting their
 * own. `forget(result)` drops the outcome if it's still `result`, so that the next call loads anew. Callers
 * that find out about a bad outcome at the same time thus only cause one new load. `initial`, if given, is
 * used as if it had just been loaded.
 */
export function cached<T>(
  load: () => Promise<T>,
  expiresAt: (outcome: PromiseSettledResult<T>, startedAt: number) => number,
  initial?: { value: T },
): { (): Promise<T>; forget(result: Promise<T>): void } {
  let entry: { result: Promise<T>; expiresAt: number } | null = initial
    ? { result: Promise.resolve(initial.value), expiresAt: expiresAt({ status: 'fulfilled', value: initial.value }, Date.now()) }
    : null

  function get(): Promise<T> {
    if (entry && Date.now() < entry.expiresAt) return entry.result
    const startedAt = Date.now()
    const current = { result: load(), expiresAt: Infinity }
    current.result.then(
      (value) => {
        current.expiresAt = expiresAt({ status: 'fulfilled', value }, startedAt)
      },
      (reason: unknown) => {
        current.expiresAt = expiresAt({ status: 'rejected', reason }, startedAt)
      },
    )
    entry = current
    return current.result
  }

  return Object.assign(get, {
    forget(result: Promise<T>) {
      if (entry?.result === result) entry = null
    },
  })
}
