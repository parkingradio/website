import { Link } from 'react-router'
import { SESSION_STATUS_LABELS } from '../describe'
import { sessionPath } from '../session-errors'
import type { SessionStatus } from '../../../session-fields'

// A session's title, linking to its page, and its status, unless it's planned, wherever the Calendrier page shows it.
export function SessionTitle({ id, title, status, inMonth = false }: { id: string; title: string; status: SessionStatus; inMonth?: boolean }) {
  return (
    <>
      {/* The month leaves its links out of the keyboard's way, since the chosen day has them. */}
      <Link to={sessionPath({ id })} tabIndex={inMonth ? -1 : undefined}>
        {title}
      </Link>
      {status !== 'planned' && <span className="calendar-status"> {SESSION_STATUS_LABELS[status]}</span>}
    </>
  )
}
