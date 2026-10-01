import { useEffect, useState } from 'react'
import type { EventsResponse } from 'shared/events'

// Linked to when the events can't be loaded, so visitors can still find them.
export const RA_PROMOTER_URL = 'https://ra.co/promoters/183980'

/** Fetches Parking Radio's events. `data` is null while they're loading, and stays null if that fails. */
export function useEvents(): { data: EventsResponse | null; failed: boolean } {
  const [data, setData] = useState<EventsResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/events')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: EventsResponse) => {
        if (!cancelled) setData(body)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { data, failed }
}
