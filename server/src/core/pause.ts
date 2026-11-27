// Waits `ms`, or until `signal` aborts, without keeping the process alive, e.g. between the reads of a background task.
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    timer.unref?.()
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}
