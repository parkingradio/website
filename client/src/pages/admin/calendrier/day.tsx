import { useId } from 'react'
import type { ReactNode } from 'react'
import { formatDay, sessionPerformers } from '../describe'
import { fullTimes, inSentence, isAvailable } from './model'
import type { CalendarDay, DayThing } from './model'
import { OccupationLabel, SessionTitle, ThingKind } from './things'

// The chosen day, under the month (see "The chosen day" in docs/design/client/admin/calendrier.md).

type ChosenDayProps = {
  day: string
  today: string
  // What's on it, once the calendar is read for the month's days, or else null.
  entries: CalendarDay | null
  onClose: () => void
  // Under what's on it, e.g. the form for a new session.
  children?: ReactNode
}

export function ChosenDay({ day, today, entries, onClose, children }: ChosenDayProps) {
  const headingId = useId()
  return (
    <section className="calendar-day" aria-labelledby={headingId}>
      <div className="calendar-day-heading">
        <h2 id={headingId} className="calendar-heading">
          {formatDay(day)}
          {/* Screen readers read ", aujourd'hui", rather than the "·". */}
          {day === today && (
            <>
              <span className="visually-hidden">,</span>{' '}
              <span className="calendar-day-today">
                <span aria-hidden="true">·</span> aujourd'hui
              </span>
            </>
          )}
        </h2>
        <button type="button" aria-label="fermer le jour" onClick={onClose}>
          ×
        </button>
      </div>
      {entries &&
        (entries.length === 0 ? (
          <p className="admin-placeholder">Rien ce jour-là.</p>
        ) : (
          <ul className="calendar-rows">
            {entries.map((entry, i) =>
              isAvailable(entry) ? (
                <li key={i} className="calendar-row">
                  <span className="calendar-kind calendar-available">disponible</span>
                  <span>{entry.part}</span>
                </li>
              ) : (
                <ThingRow key={i} day={day} dayThing={entry} />
              ),
            )}
          </ul>
        ))}
      {children}
    </section>
  )
}

// A thing on the chosen day: its kind, its times in full, what it is, whether it's a session outside protected time, and
// its conflicts on that day.
function ThingRow({ day, dayThing: { thing, conflicts } }: { day: string; dayThing: DayThing }) {
  const performers = thing.kind === 'session' && sessionPerformers(thing)
  return (
    <li className={thing.kind === 'session' ? `calendar-row admin-status-${thing.status}` : 'calendar-row'}>
      <ThingKind kind={thing.kind} conflict={conflicts.length > 0} />
      <span>{fullTimes(thing, day)}</span>
      <span>
        {thing.kind === 'session' ? (
          <>
            <SessionTitle id={thing.id} title={thing.title} status={thing.status} />
            {performers && <span className="admin-meta"> {performers}</span>}
          </>
        ) : (
          <OccupationLabel title={thing.title} calendar={thing.calendar} />
        )}
        {thing.kind === 'session' && thing.unprotected && <span className="calendar-unprotected-line">hors plage protégée</span>}
        {conflicts.map(({ other }, i) => (
          <span key={i} className="calendar-conflict-line">
            conflit avec {inSentence(other)}
          </span>
        ))}
      </span>
    </li>
  )
}
