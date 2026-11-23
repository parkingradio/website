import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useTabShownCount } from '../../api/use-tab-shown'
import { quebecDayAndTime } from '../../quebec-time'

// The number of conflicts that the menu's badge on "calendrier" shows (see docs/design/client/admin/layout.md).

// What Calendrier tells the badge the number of conflicts is, each time it reads the calendar. Nothing outside the
// layout, e.g. in tests of the page alone.
const ReportConflicts = createContext<(count: number) => void>(() => {})
export const ConflictCountReporter = ReportConflicts.Provider
export const useReportConflicts = () => useContext(ReportConflicts)

// Whether the admin page at `pathname` is Calendrier, or leads to it, i.e. /admin.
const onCalendar = (pathname: string) => ['/admin', '/admin/calendrier'].includes(pathname.replace(/\/+$/, ''))

// The number of conflicts, or null until it's been read, read for today alone when the admin page at `pathname` opens,
// and when the tab is shown again, except on Calendrier, which reports it with what it returns. When it can't be read,
// it stays as it was.
export function useConflictCount(pathname: string): [number | null, (count: number) => void] {
  const [count, setCount] = useState<number | null>(null)
  const tabShown = useTabShownCount()
  const skipped = onCalendar(pathname)

  useEffect(() => {
    if (skipped) return
    let cancelled = false
    const today = quebecDayAndTime(new Date()).day
    api.GET('/api/admin/calendar', { params: { query: { from: today, to: today } } }).then((result) => {
      if (!cancelled && result.ok) setCount(result.conflicts.length)
    })
    return () => {
      cancelled = true
    }
  }, [pathname, skipped, tabShown])

  return [count, setCount]
}
