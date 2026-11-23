import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { quebecDayAndTime } from '../../quebec-time'
import { Button } from './button'
import { useReportConflicts, useTabShownCount } from './conflict-count'
import { useQueryParams } from './list'
import { newSessionPath } from './session-errors'
import { ChosenDay } from './calendrier/day'
import { Issues } from './calendrier/issues'
import { Month } from './calendrier/month'
import { FIRST_MONTH, LAST_MONTH, addMonths, calendarDays, gridDays, gridRange, monthOf, readDay, readMonth } from './calendrier/model'
import type { Calendar } from './calendrier/model'
import { Sources } from './calendrier/sources'
import './calendrier/calendrier.css'

// The studio's calendar: what takes it, month by month, and what needs settling (see
// docs/design/client/admin/calendrier.md).

// E.g. "novembre 2026".
const monthFormat = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// The calendar last read, and the days it was read for, and why the last request failed, if it did.
type Reads = { last: { from: string; to: string; calendar: Calendar } | null; error: string | null }

// Reads the calendar of the days from `from` to `to`, again whenever they change, and when the tab is shown again, at
// most once a minute, and tells the menu's badge how many conflicts there are. Only the last request's answer counts.
function useCalendar(from: string, to: string): Reads {
  const [reads, setReads] = useState<Reads>({ last: null, error: null })
  const shown = useTabShownCount()
  const report = useReportConflicts()

  useEffect(() => {
    let cancelled = false
    api.GET('/api/admin/calendar', { params: { query: { from, to } } }).then((result) => {
      if (cancelled) return
      if (!result.ok) return setReads((reads) => ({ ...reads, error: result.error }))
      setReads({ last: { from, to, calendar: result }, error: null })
      report(result.conflicts.length)
    })
    return () => {
      cancelled = true
    }
  }, [from, to, shown, report])

  return reads
}

export function Calendrier() {
  const [params, change] = useQueryParams()
  const today = quebecDayAndTime(new Date()).day
  const day = readDay(params.get('day'))
  const month = readMonth(params.get('month')) ?? monthOf(day ?? today)
  const chosen = day !== null && gridDays(month).includes(day) ? day : null
  const issuesOpen = params.get('issues') === 'open'
  const { from, to } = gridRange(month)
  const { last, error } = useCalendar(from, to)
  // Only a calendar read for the month's days is shown in it.
  const current = last && last.from === from && last.to === to ? last.calendar : null
  const days = useMemo(() => current && calendarDays(current, month, today), [current, month, today])
  const monthNameId = useId()

  // The day in the month that gets the focus once the page shows it, e.g. once the chosen day is closed.
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next) document.querySelector<HTMLButtonElement>(`.calendar-month [data-day="${next}"]`)?.focus()
  })

  // Changing the month adds a step to the history, but choosing a day in it doesn't.
  const showMonth = (shown: string) => change({ month: shown, day: null })
  const showDay = (shown: string) => change({ month: monthOf(shown), day: shown }, { replace: monthOf(shown) === month })
  // With the month, since a day of the month before or after would otherwise show its own.
  const choose = (shown: string | null) => change({ month, day: shown }, { replace: true })

  return (
    <>
      <h1>Calendrier</h1>
      {error !== null && (
        <p className="admin-error" role="alert">
          Le calendrier n'a pas pu être chargé&nbsp;: {error}
        </p>
      )}
      {last && (
        <Issues
          calendar={last.calendar}
          open={issuesOpen}
          onToggle={() => change({ issues: issuesOpen ? null : 'open' }, { replace: true })}
          onShowDay={(shown) => {
            focusNext.current = shown
            showDay(shown)
          }}
        />
      )}
      <div className="admin-toolbar calendar-toolbar">
        <Button
          aria-label="mois précédent"
          unavailable={month === FIRST_MONTH ? 'Le calendrier commence en 2000.' : null}
          onClick={() => showMonth(addMonths(month, -1))}
        >
          ←
        </Button>
        <h2 id={monthNameId} className="calendar-heading calendar-month-name" aria-live="polite">
          {monthFormat.format(new Date(`${month}-01`))}
        </h2>
        <Button
          aria-label="mois suivant"
          unavailable={month === LAST_MONTH ? "Le calendrier s'arrête en 2999." : null}
          onClick={() => showMonth(addMonths(month, 1))}
        >
          →
        </Button>
        <button type="button" onClick={() => showDay(today)}>
          aujourd'hui
        </button>
        <Link to={newSessionPath()} className="admin-button">
          nouvelle session
        </Link>
      </div>
      <Legend />
      <Month key={month} month={month} nameId={monthNameId} today={today} chosen={chosen} days={days} onChoose={(shown) => choose(shown === chosen ? null : shown)} />
      {chosen && (
        <ChosenDay
          day={chosen}
          today={today}
          shown={days?.get(chosen) ?? null}
          feeds={current?.feeds ?? []}
          onClose={() => {
            focusNext.current = chosen
            choose(null)
          }}
        />
      )}
      {last && <Sources feeds={last.calendar.feeds} />}
    </>
  )
}

// What each color is.
function Legend() {
  return (
    <ul className="calendar-legend" aria-label="Légende">
      <li>
        <span className="calendar-swatch calendar-session" /> session
      </li>
      <li>
        <span className="calendar-swatch calendar-occupation" /> occupation
      </li>
      <li>
        <span className="calendar-swatch calendar-quiet-time" /> silence
      </li>
      <li>
        <span className="calendar-swatch calendar-free" /> disponible
      </li>
      <li>
        <span className="calendar-swatch calendar-conflict" /> conflit
      </li>
    </ul>
  )
}
