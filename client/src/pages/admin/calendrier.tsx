import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { quebecDayAndTime } from '../../quebec-time'
import { Button } from './button'
import { useTabShownCount } from '../../api/use-tab-shown'
import { useReportConflicts } from './conflict-count'
import { useQueryParams } from './list'
import { ChosenDay } from './calendrier/day'
import { NewSessionForm } from './calendrier/new-session'
import { Issues } from './calendrier/issues'
import { Month } from './calendrier/month'
import { FIRST_MONTH, LAST_MONTH, addMonths, calendarDays, gridDays, gridRange, monthOf, readDay, readMonth } from './calendrier/model'
import type { Calendar } from './calendrier/model'
import './calendrier/calendrier.css'

// The studio's calendar: what takes it, month by month, and what needs settling (see
// docs/design/client/admin/calendrier.md).

// E.g. "novembre 2026".
const monthFormat = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// Reads the calendar of the days from `from` to `to`, again whenever they change, or `version` does, and when the tab is
// shown again, at most once a minute, and tells the menu's badge how many conflicts there are. Only the last request's
// answer counts. Returns the calendar last read, whatever its days, the one read for these days, once it is, and why the
// last request failed, if it did.
function useCalendar(from: string, to: string, version: number): { last: Calendar | null; shown: Calendar | null; error: string | null } {
  const [reads, setReads] = useState<{ read: { from: string; to: string; calendar: Calendar } | null; error: string | null }>({ read: null, error: null })
  const tabShown = useTabShownCount()
  const report = useReportConflicts()

  useEffect(() => {
    let cancelled = false
    api.GET('/api/admin/calendar', { params: { query: { from, to } } }).then((result) => {
      if (cancelled) return
      if (!result.ok) return setReads((reads) => ({ ...reads, error: result.error }))
      setReads({ read: { from, to, calendar: result }, error: null })
      report(result.conflicts.length)
    })
    return () => {
      cancelled = true
    }
  }, [from, to, version, tabShown, report])

  const { read, error } = reads
  return { last: read?.calendar ?? null, shown: read && read.from === from && read.to === to ? read.calendar : null, error }
}

export function Calendrier() {
  const [params, change] = useQueryParams()
  const today = quebecDayAndTime(new Date()).day
  const day = readDay(params.get('day'))
  const month = readMonth(params.get('month')) ?? monthOf(day ?? today)
  const grid = gridDays(month)
  const chosen = day !== null && grid.includes(day) ? day : null
  const issuesOpen = params.get('issues') === 'open'
  const { from, to } = gridRange(grid)
  // How many sessions were added, each of which reads the calendar again.
  const [addedCount, setAddedCount] = useState(0)
  const reads = useCalendar(from, to, addedCount)
  // Only a calendar read for the month's days is shown in it, with the grid of its own, which depends on the month alone,
  // unlike `grid`, which is made again on each render.
  const days = useMemo(() => reads.shown && calendarDays(reads.shown, gridDays(month)), [reads.shown, month])
  const monthNameId = useId()

  // The day the form for a new session was opened on, which shows while it's the chosen day, and the session last added,
  // and its day, which the chosen day says, until the form opens again. Choosing another day, or none, in any way, e.g.
  // going back in the history, closes the form, and leaves out what it added.
  const [adding, setAdding] = useState<string | null>(null)
  const [added, setAdded] = useState<{ day: string; title: string } | null>(null)
  const [lastChosen, setLastChosen] = useState(chosen)
  if (chosen !== lastChosen) {
    setLastChosen(chosen)
    if (adding !== chosen) setAdding(null)
    setAdded(null)
  }

  // How many times a "+" was used, each of which puts the focus on the form, even when it's open already.
  const [addings, setAddings] = useState(0)

  // What gets the focus once the page shows it, by its selector, e.g. the day in the month once the chosen day is
  // closed.
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next) document.querySelector<HTMLElement>(next)?.focus()
  })

  // Changing the month adds a step to the history, but choosing a day in it doesn't.
  const showMonth = (shown: string) => change({ month: shown, day: null })
  const showDay = (shown: string) => change({ month: monthOf(shown), day: shown }, { replace: monthOf(shown) === month })
  // With the month, since a day of the month before or after would otherwise show its own.
  const choose = (shown: string | null) => change({ month, day: shown }, { replace: true })

  return (
    <>
      <h1>Calendrier</h1>
      {reads.error !== null && (
        <p className="admin-error" role="alert">
          Le calendrier n'a pas pu être chargé&nbsp;: {reads.error}
        </p>
      )}
      {reads.last && (
        <Issues
          calendar={reads.last}
          open={issuesOpen}
          onToggle={() => change({ issues: issuesOpen ? null : 'open' }, { replace: true })}
          onShowDay={(shown) => {
            focusNext.current = `.calendar-month [data-day="${shown}"]`
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
      </div>
      <Legend />
      <Month
        key={month}
        month={month}
        grid={grid}
        nameId={monthNameId}
        today={today}
        chosen={chosen}
        days={days}
        onChoose={(shown) => choose(shown === chosen ? null : shown)}
        onAdd={(shown) => {
          if (shown !== chosen) choose(shown)
          setAdding(shown)
          setAdded(null)
          setAddings((addings) => addings + 1)
        }}
      />
      {chosen && (
        <ChosenDay
          day={chosen}
          today={today}
          entries={days?.get(chosen) ?? null}
          onClose={() => {
            focusNext.current = `.calendar-month [data-day="${chosen}"]`
            choose(null)
          }}
        >
          {adding === chosen && (
            <NewSessionForm
              key={chosen}
              day={chosen}
              focusRequests={addings}
              onCancel={() => {
                focusNext.current = `.calendar-month [data-add="${chosen}"]`
                setAdding(null)
              }}
              onAdded={(session) => {
                // The day stays chosen, with the focus on it in the month, where the session shows once it's read.
                focusNext.current = `.calendar-month [data-day="${chosen}"]`
                setAdding(null)
                setAdded({ day: chosen, title: session.title })
                setAddedCount((count) => count + 1)
              }}
            />
          )}
          {added?.day === chosen && (
            <p className="admin-notice" role="status">
              La session {added.title} a été ajoutée.
            </p>
          )}
        </ChosenDay>
      )}
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
        <span className="calendar-swatch calendar-free" /> disponible
      </li>
      <li>
        <span className="calendar-swatch calendar-conflict" /> conflit
      </li>
    </ul>
  )
}
