import { useEffect, useState } from 'react'

const MINUTE_MS = 60 * 1000

// A counter that's bumped each time the browser's tab is shown again, at most once a minute, e.g. to read something
// again.
export function useTabShownCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let last = Date.now()
    const onChange = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < MINUTE_MS) return
      last = Date.now()
      setCount((count) => count + 1)
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return count
}
