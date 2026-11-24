import { Fragment } from 'react'
import { formatDay, formatDayInYear, formatMonth, sessionPerformers } from '../describe'
import { nameOf, boundedTimes, startDay } from './model'
import type { ListedMonth, ListedThing } from './model'
import { OccupationLabel, SessionStatus, ThingKind } from './things'

// The list: what takes the studio over the 365 days from today, month by month, each thing once, in columns (see "The
// list" in docs/design/client/admin/calendrier.md).

type ListProps = {
  // The id of the toolbar's heading, which names the list.
  nameId: string
  // The list's last day.
  to: string
  // What's in it, once the calendar is read for its days, or else null.
  months: ListedMonth[] | null
  // Shows a day, chosen, in the month.
  onShowDay: (day: string) => void
}

export function List({ nameId, to, months, onShowDay }: ListProps) {
  return (
    <section className="calendar-list" aria-labelledby={nameId}>
      {months?.map(({ month, things }) => (
        <div key={month}>
          <h3>{formatMonth(month)}</h3>
          {things.length === 0 ? (
            <p className="admin-placeholder">Rien.</p>
          ) : (
            <ul className="calendar-lines">
              {things.map((listed, i) => (
                <li key={i} className={listed.thing.kind === 'session' ? `admin-status-${listed.thing.status}` : undefined}>
                  <button type="button" className="calendar-line calendar-listed" onClick={() => onShowDay(listed.day)}>
                    <ListedText listed={listed} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {months && <p className="admin-placeholder">La liste s'arrête au {formatDay(to)}.</p>}
    </section>
  )
}

// A thing's row, in columns: its day, its kind, its times in brief on that day, then what it is, and each of its
// conflicts, with the day it starts when it's on another day, which alone wraps.
function ListedText({ listed: { day, thing, conflicts } }: { listed: ListedThing }) {
  const performers = thing.kind === 'session' && sessionPerformers(thing)
  return (
    <>
      <span className="calendar-line-when">{formatDayInYear(day)}</span> <ThingKind kind={thing.kind} conflict={conflicts.length > 0} />{' '}
      <span>{boundedTimes(thing, day)}</span>{' '}
      <span className="calendar-line-what">
        {thing.kind === 'session' ? (
          <>
            <strong>{thing.title}</strong>
            <SessionStatus status={thing.status} />
            {performers && ` · ${performers}`}
          </>
        ) : (
          <OccupationLabel title={thing.title} calendar={thing.calendar} />
        )}
        {conflicts.map(({ conflict, other, elsewhere }, i) => (
          <Fragment key={i}>
            {' · '}
            <span className="calendar-conflict-text">
              conflit avec {nameOf(other)}
              {elsewhere && ` (${startDay(conflict, day)})`}
            </span>
          </Fragment>
        ))}
      </span>
    </>
  )
}
