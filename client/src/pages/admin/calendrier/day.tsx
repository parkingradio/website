import { useId } from 'react'
import { Link } from 'react-router'
import { THING_KIND_LABELS, formatDay, sessionPerformers } from '../describe'
import { newSessionPath } from '../session-errors'
import { calendarOf, fullTimes, inSentence, occupationTitle } from './model'
import type { CalendarDay, DayThing, Feed } from './model'
import { SessionTitle } from './things'

// The chosen day, under the month (see "The chosen day" in docs/design/client/admin/calendrier.md).

type ChosenDayProps = {
  day: string
  today: string
  // What's on it, once the calendar is read for the month's days, or else null.
  shown: CalendarDay | null
  feeds: Feed[]
  onClose: () => void
}

export function ChosenDay({ day, today, shown, feeds, onClose }: ChosenDayProps) {
  const headingId = useId()
  return (
    <section className="calendar-day" aria-labelledby={headingId}>
      <div className="calendar-day-heading">
        <h2 id={headingId} className="calendar-heading">
          {formatDay(day)}
          {day === today && (
            <>
              {' '}
              <span className="calendar-day-today">· aujourd'hui</span>
            </>
          )}
        </h2>
        <button type="button" aria-label="fermer le jour" onClick={onClose}>
          ×
        </button>
      </div>
      {shown &&
        (shown.things.length === 0 && shown.free.length === 0 ? (
          <p className="admin-placeholder">Rien ce jour-là.</p>
        ) : (
          <ul className="calendar-rows">
            {shown.things.map((dayThing, i) => (
              <ThingRow key={i} day={day} dayThing={dayThing} feeds={feeds} />
            ))}
            {shown.free.length > 0 && (
              <li className="calendar-row">
                <span className="calendar-row-kind calendar-free">disponible</span>
                <span>{shown.free.join(', ')}</span>
              </li>
            )}
          </ul>
        ))}
      {day >= today && (
        <p>
          <Link to={newSessionPath({ day })}>nouvelle session ce jour →</Link>
        </p>
      )}
    </section>
  )
}

// A thing on the chosen day: its kind, its times in full, what it is, and its conflicts on that day.
function ThingRow({ day, dayThing: { thing, conflictsWith }, feeds }: { day: string; dayThing: DayThing; feeds: Feed[] }) {
  const performers = thing.kind === 'session' && sessionPerformers(thing)
  return (
    <li className="calendar-row">
      <span className={`calendar-row-kind calendar-${thing.kind}${conflictsWith.length > 0 ? ' calendar-conflict' : ''}`}>{THING_KIND_LABELS[thing.kind]}</span>
      <span>{fullTimes(thing, day)}</span>
      <span>
        {thing.kind === 'session' ? (
          <>
            <SessionTitle id={thing.id} title={thing.title} status={thing.status} />
            {performers && <span className="admin-meta"> {performers}</span>}
          </>
        ) : thing.kind === 'occupation' ? (
          <>
            {occupationTitle(thing.title)} <span className="admin-meta">({calendarOf(feeds, thing.feed)})</span>
          </>
        ) : (
          <span className="admin-meta">{calendarOf(feeds, thing.feed)}</span>
        )}
        {conflictsWith.map((other, i) => (
          <span key={i} className="calendar-conflict-line">
            conflit avec {inSentence(other, feeds)}
          </span>
        ))}
      </span>
    </li>
  )
}
