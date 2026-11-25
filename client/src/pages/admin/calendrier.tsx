import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useApi } from '../../api/use-api'
import { quebecDayAndTime } from '../../quebec-time'
import { Button } from './button'
import { useTabShownCount } from '../../api/use-tab-shown'
import { useReportConflicts } from './conflict-count'
import { SESSION_STATUS_LABELS, formatMonth } from './describe'
import { useQueryParams } from './list'
import { ChosenDay } from './calendrier/day'
import { NewSessionForm } from './calendrier/new-session'
import { Issues } from './calendrier/issues'
import { List } from './calendrier/list'
import { Month } from './calendrier/month'
import { FIRST_MONTH, LAST_MONTH, addMonths, calendarDays, gridDays, gridRange, listRange, listedMonths, monthOf, readDay, readMonth } from './calendrier/model'
import type { Calendar } from './calendrier/model'
import './calendrier/calendrier.css'

// The studio's calendar: what takes it, month by month or as a list, and what needs settling (see
// docs/design/client/admin/calendrier.md).

// A day's button in the month, and its "+", by their selectors.
const dayInMonth = (day: string) => `.calendar-month [data-day="${day}"]`
const addInMonth = (day: string) => `.calendar-month [data-add="${day}"]`

// The page's views, and their buttons' names.
const VIEWS = ['month', 'list'] as const
type View = (typeof VIEWS)[number]
const VIEW_LABELS: Record<View, string> = { month: 'mois', list: 'liste' }

// The calendar, and the days it was read for.
type Read = { from: string; to: string; calendar: Calendar }

// Reads the calendar of the days from `from` to `to`, again whenever they change, or `version` does, and when the tab is
// shown again, at most once a minute, and tells the menu's badge how many conflicts there are. Only the last request's
// answer counts. Returns the calendar last read, whatever its days, the one read for these days, once it is, and why the
// last request failed, if it did. The last two reads are kept, whatever their days, so that going back to what was shown
// just before shows it while it's read again.
function useCalendar(from: string, to: string, version: number): { last: Calendar | null; shown: Calendar | null; error: string | null } {
  const [reads, setReads] = useState<{ recent: Read[]; error: string | null }>({ recent: [], error: null })
  const tabShown = useTabShownCount()
  const report = useReportConflicts()

  useEffect(() => {
    let cancelled = false
    api.GET('/api/admin/calendar', { params: { query: { from, to } } }).then((result) => {
      if (cancelled) return
      if (!result.ok) return setReads((reads) => ({ ...reads, error: result.error }))
      const read = { from, to, calendar: result }
      setReads(({ recent }) => ({ recent: [read, ...recent.filter((other) => other.from !== from || other.to !== to)].slice(0, 2), error: null }))
      report(result.conflicts.length)
    })
    return () => {
      cancelled = true
    }
  }, [from, to, version, tabShown, report])

  const shown = reads.recent.find((read) => read.from === from && read.to === to)
  return { last: reads.recent[0]?.calendar ?? null, shown: shown?.calendar ?? null, error: reads.error }
}

// The feeds whose read failed, by their names, e.g. « « Séjours » et « Airbnb » ».
const namesFormat = new Intl.ListFormat('fr', { type: 'conjunction' })

// Whether the feeds are being read again, what screen readers are told about it, and why the request failed, if it did.
type FeedsRefresh = { reading: boolean; said: string; error: string | null }

// Reads the calendar feeds again, then calls `onRead`, so that the calendar is read again.
function useFeedsRefresh(onRead: () => void): FeedsRefresh & { refresh: () => Promise<void> } {
  const [state, setState] = useState<FeedsRefresh>({ reading: false, said: '', error: null })
  const refresh = async () => {
    setState({ reading: true, said: 'Lecture des calendriers externes…', error: null })
    const result = await api.POST('/api/admin/calendar/feeds/refresh')
    if (!result.ok) return setState({ reading: false, said: '', error: result.error })
    // Sighted admins see the warnings of "À régler" change: screen readers are told which feeds they're about.
    const failed = result.feeds.filter((feed) => feed.error !== null).map(({ name }) => `«\u00a0${name}\u00a0»`)
    const said = failed.length === 0 ? 'Calendriers externes relus.' : `Calendriers externes relus, sauf ${namesFormat.format(failed)}\u00a0: voir «\u00a0À régler\u00a0».`
    setState({ reading: false, said, error: null })
    onRead()
  }
  return { ...state, refresh }
}

export function Calendrier() {
  const [params, change] = useQueryParams()
  const today = quebecDayAndTime(new Date()).day
  const view: View = params.get('view') === 'list' ? 'list' : 'month'
  const day = readDay(params.get('day'))
  const month = readMonth(params.get('month')) ?? monthOf(day ?? today)
  const grid = gridDays(month)
  // The chosen day, which is in the month's grid, while the month is shown.
  const chosen = view === 'month' && day !== null && grid.includes(day) ? day : null
  const issuesOpen = params.get('issues') === 'open'
  const { from, to } = view === 'list' ? listRange(today) : gridRange(grid)
  // How many times the calendar was changed, e.g. by adding a session, or reading the feeds again, each of which reads it
  // again.
  const [changes, setChanges] = useState(0)
  const changed = () => setChanges((count) => count + 1)
  const reads = useCalendar(from, to, changes)
  const feeds = useFeedsRefresh(changed)
  // The token of the legend's links to the admin's calendars, read once, rather than each time the legend is shown again.
  const subscription = useApi('/api/admin/ics-subscription-token')
  // Only a calendar read for the view's days is shown in it, with, for the month, the grid of its own, which depends on
  // the month alone, unlike `grid`, which is made again on each render.
  const days = useMemo(() => (view === 'month' && reads.shown ? calendarDays(reads.shown, gridDays(month)) : null), [view, reads.shown, month])
  const months = useMemo(() => (view === 'list' && reads.shown ? listedMonths(reads.shown, from, to) : null), [view, reads.shown, from, to])
  const headingId = useId()

  // The day the form for a new session was opened on, which shows while it's the chosen day, and the session last added,
  // and its day, which the chosen day says, until the form opens again. Choosing another day, or none, in any way, e.g.
  // going back in the history, or showing the list, closes the form, and leaves out what it added.
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
  // The day whose chosen day, under the month, is brought into view once it's chosen and shows what's on it, e.g. once
  // it's chosen by clicking it: its heading, as long as the day stays in view in the month, which has the focus.
  const scrollTo = useRef<string | null>(null)
  // A layout effect, as in LoadedSession in sessions.tsx: a passive one runs in a later task when the update follows a
  // request, e.g. once a session is added, and one still pending then could take `focusNext` from a click before the page
  // shows what it names.
  useLayoutEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next) document.querySelector<HTMLElement>(next)?.focus()
    if (scrollTo.current !== null && scrollTo.current === chosen && days) {
      scrollTo.current = null
      // jsdom has no scrollIntoView.
      document.querySelector('.calendar-day h2')?.scrollIntoView?.({ block: 'nearest' })
      document.querySelector(dayInMonth(chosen))?.closest('td')?.scrollIntoView?.({ block: 'nearest' })
    }
  })

  // Changing the view or the month adds a step to the history, but choosing a day in the month doesn't.
  const showView = (shown: View) => {
    if (shown !== view) change({ view: shown === 'list' ? shown : null })
  }
  const showMonth = (shown: string) => change({ month: shown, day: null })
  const showDay = (shown: string) => change({ view: null, month: monthOf(shown), day: shown }, { replace: view === 'month' && monthOf(shown) === month })
  // The same, from a row of "À régler" or of the list, with the focus on the day, and the chosen day in view.
  const goToDay = (shown: string) => {
    focusNext.current = dayInMonth(shown)
    scrollTo.current = shown
    showDay(shown)
  }
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
      {feeds.error !== null && (
        <p className="admin-error" role="alert">
          Les calendriers externes n'ont pas pu être relus&nbsp;: {feeds.error}
        </p>
      )}
      {reads.last && (
        <Issues
          calendar={reads.last}
          today={today}
          open={issuesOpen}
          onToggle={() => change({ issues: issuesOpen ? null : 'open' }, { replace: true })}
          onShowDay={goToDay}
        />
      )}
      {/* One toolbar for both views, whose heading, which screen readers announce, and the views' buttons are the same
          elements in both, so that the buttons keep the focus, and stay where they are. */}
      <div className="admin-toolbar calendar-toolbar">
        {view === 'month' && (
          <Button
            aria-label="mois précédent"
            unavailable={month === FIRST_MONTH ? 'Le calendrier commence en 2000.' : null}
            onClick={() => showMonth(addMonths(month, -1))}
          >
            ←
          </Button>
        )}
        <h2 id={headingId} className={`calendar-heading calendar-toolbar-heading${view === 'month' ? ' calendar-toolbar-heading-month' : ''}`} aria-live="polite">
          {view === 'list' ? 'À venir' : formatMonth(month)}
        </h2>
        {view === 'month' && (
          <>
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
          </>
        )}
        <div className="calendar-toolbar-end">
          <div className="admin-filters calendar-views" role="group" aria-label="Vue">
            {VIEWS.map((each) => (
              <button key={each} type="button" aria-pressed={view === each} onClick={() => showView(each)}>
                {VIEW_LABELS[each]}
              </button>
            ))}
          </div>
          {/* Greyed out while the feeds are read, but keeping the focus (see "Controls that can't be used" in
              docs/design/client/admin/layout.md). */}
          <button
            type="button"
            className="calendar-refresh"
            aria-label="relire les calendriers externes"
            aria-disabled={feeds.reading || undefined}
            onClick={feeds.reading ? undefined : feeds.refresh}
          >
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {feeds.said}
      </p>
      {view === 'list' ? (
        <List nameId={headingId} to={to} months={months} onShowDay={goToDay} />
      ) : (
        <>
          <Legend token={subscription.kind === 'loaded' ? subscription.value.token : null} />
          <Month
            key={month}
            month={month}
            grid={grid}
            nameId={headingId}
            today={today}
            chosen={chosen}
            days={days}
            onChoose={(shown) => {
              const next = shown === chosen ? null : shown
              scrollTo.current = next
              choose(next)
            }}
            onAdd={(shown) => {
              if (shown !== chosen) choose(shown)
              setAdding(shown)
              setAdded(null)
              setAddings((addings) => addings + 1)
            }}
          />
        </>
      )}
      {chosen && (
        <ChosenDay
          day={chosen}
          today={today}
          entries={days?.get(chosen) ?? null}
          onClose={() => {
            focusNext.current = dayInMonth(chosen)
            choose(null)
          }}
        >
          {adding === chosen && (
            <NewSessionForm
              key={chosen}
              day={chosen}
              focusRequests={addings}
              onCancel={() => {
                focusNext.current = addInMonth(chosen)
                setAdding(null)
              }}
              onAdded={(session) => {
                // The day stays chosen, with the focus on it in the month, where the session shows once it's read.
                focusNext.current = dayInMonth(chosen)
                setAdding(null)
                setAdded({ day: chosen, title: session.title })
                changed()
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

// What each kind of thing is, in a tooltip, with its color, and on narrow screens, its mark (see calendrier.css), and
// the links to the admin's calendars of the sessions and of the occupations once their token is known.
const LEGEND = [
  { kind: 'session', name: 'session', tip: 'Toutes les sessions qui ont une date.', calendar: 'sessions' },
  { kind: 'occupation', name: 'occupation', tip: "Période où le studio n'est pas disponible pour des sessions.", calendar: 'occupations' },
  { kind: 'free', name: 'disponible', tip: 'Plage disponible au studio, protégée des occupations.', calendar: null },
  { kind: 'conflict', name: 'conflit', tip: 'Une session ou une occupation qui chevauche une plage indisponible.', calendar: null },
] as const

function Legend({ token }: { token: string | null }) {
  return (
    <ul className="calendar-legend" aria-label="Légende">
      {LEGEND.map(({ kind, name, tip, calendar }) => (
        <li key={kind}>
          <span className={`calendar-swatch calendar-${kind}`} />
          <Button className="calendar-legend-tip" tip={tip}>
            {name}
          </Button>
          {calendar !== null && token !== null && <SubscribeLink calendar={calendar} token={token} />}
        </li>
      ))}
      {/* Which only narrow screens need, whose month doesn't write sessions' status. */}
      {(['done', 'cancelled'] as const).map((status) => (
        <li key={status} className="calendar-legend-narrow">
          <span className={`calendar-mark calendar-mark-session calendar-mark-${status}`} /> {SESSION_STATUS_LABELS[status]}
        </li>
      ))}
    </ul>
  )
}

// A link to one of the admin's calendars, which opens the calendar app (see docs/design/server/admin-calendars.md): a
// calendar with a plus.
function SubscribeLink({ calendar, token }: { calendar: 'sessions' | 'occupations'; token: string }) {
  const name = `s'abonner au calendrier des ${calendar}`
  return (
    <a className="calendar-subscribe" href={`webcal://${window.location.host}/${calendar}.ics?token=${token}`} aria-label={name} title={name}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1.75" y="3" width="12.5" height="11.25" rx="1" />
        <path d="M1.75 6.5h12.5M5 1.5v3M11 1.5v3M8 8.25v4.5M5.75 10.5h4.5" />
      </svg>
    </a>
  )
}
