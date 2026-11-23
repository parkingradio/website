import { useId } from 'react'
import type { ReactNode } from 'react'
import { THING_KIND_LABELS, formatDay, sessionPerformers } from '../describe'
import { fullTimes, inSentence, isFree } from './model'
import type { CalendarDay, DayThing } from './model'
import { OccupationLabel, SessionTitle } from './things'

// The chosen day, under the month (see "The chosen day" in docs/design/client/admin/calendrier.md).

type ChosenDayProps = {
  day: string
  today: string
  // What's on it, once the calendar is read for the month's days, or else null.
  shown: CalendarDay | null
  onClose: () => void
  // Under what's on it, e.g. the form for a new session.
  children?: ReactNode
}

export function ChosenDay({ day, today, shown, onClose, children }: ChosenDayProps) {
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
      {shown &&
        (shown.length === 0 ? (
          <p className="admin-placeholder">Rien ce jour-là.</p>
        ) : (
          <ul className="calendar-rows">
            {shown.map((entry, i) =>
              isFree(entry) ? (
                <li key={i} className="calendar-row">
                  <span className="calendar-row-kind calendar-free">disponible</span>
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

// A thing on the chosen day: its kind, its times in full, what it is, and its conflicts on that day.
function ThingRow({ day, dayThing: { thing, conflictsWith } }: { day: string; dayThing: DayThing }) {
  const performers = thing.kind === 'session' && sessionPerformers(thing)
  const status = thing.kind === 'session' && thing.status !== 'planned' && `admin-status-${thing.status}`
  return (
    <li className={status ? `calendar-row ${status}` : 'calendar-row'}>
      <span className={`calendar-row-kind calendar-${thing.kind}${conflictsWith.length > 0 ? ' calendar-conflict' : ''}`}>{THING_KIND_LABELS[thing.kind]}</span>
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
        {conflictsWith.map((other, i) => (
          <span key={i} className="calendar-conflict-line">
            conflit avec {inSentence(other)}
          </span>
        ))}
      </span>
    </li>
  )
}
