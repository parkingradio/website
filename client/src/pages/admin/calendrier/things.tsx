import { Link } from 'react-router'
import { SESSION_STATUS_LABELS } from '../describe'
import { sessionPath } from '../session-errors'
import type { SessionStatus } from '../../../session-fields'
import type { OccupationName } from './model'

// A session's title, linking to its page, and its status, unless it's planned, wherever the Calendrier page shows it.
export function SessionTitle({ id, title, status, inMonth = false }: { id: string; title: string; status: SessionStatus; inMonth?: boolean }) {
  return (
    <>
      {/* The month leaves its links out of the keyboard's way, since the chosen day has them. */}
      <Link to={sessionPath({ id })} tabIndex={inMonth ? -1 : undefined}>
        {title}
      </Link>
      <SessionStatus status={status} />
    </>
  )
}

// A session's status, after its title, unless it's planned.
export function SessionStatus({ status }: { status: SessionStatus }) {
  return status !== 'planned' && <span className="calendar-status"> {SESSION_STATUS_LABELS[status]}</span>
}

// An occupation's title, or its calendar's name in its place, as it's written.
export function OccupationTitle({ title, calendar }: OccupationName) {
  return <span className={title === null ? 'calendar-feed-name' : undefined}>{title ?? calendar}</span>
}

// An occupation's calendar, after its title, which screen readers read after ", calendrier".
export function OccupationCalendar({ calendar }: { calendar: string }) {
  return (
    <>
      <span className="visually-hidden">, calendrier</span> {calendar}
    </>
  )
}

// An occupation's name, within a line: its title, then its calendar, or its calendar alone.
export function OccupationLabel({ title, calendar }: OccupationName) {
  return (
    <>
      <OccupationTitle title={title} calendar={calendar} />
      {title !== null && (
        <span className="admin-meta">
          <OccupationCalendar calendar={calendar} />
        </span>
      )}
    </>
  )
}
