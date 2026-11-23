import { useId } from 'react'
import { Link } from 'react-router'
import { quebecDayAndTime } from '../../../quebec-time'
import { THING_KIND_LABELS, conflictCount, formatDuration, formatQuebecDay, sessionPerformers } from '../describe'
import { sessionPath } from '../session-errors'
import { fullTimes, namedThing } from './model'
import type { Calendar, Feed, NamedThing } from './model'
import { OccupationLabel, SessionTitle } from './things'

// "À régler": the conflicts and the sessions without a date, with what the feeds' reads say about them (see "À régler" in
// docs/design/client/admin/calendrier.md).

type IssuesProps = {
  calendar: Calendar
  open: boolean
  onToggle: () => void
  // Shows a day, chosen, in the month.
  onShowDay: (day: string) => void
}

export function Issues({ calendar: { conflicts, undatedSessions, feeds }, open, onToggle, onShowDay }: IssuesProps) {
  const headingId = useId()
  const contentId = useId()
  // Conflicts are counted in their color.
  const counts = [
    conflicts.length > 0 && { text: conflictCount(conflicts.length), className: 'calendar-count calendar-conflict-tag' },
    undatedSessions.length > 0 && { text: `${undatedSessions.length} sans date`, className: 'calendar-count' },
  ].filter((count) => count !== false)

  return (
    <section className="calendar-issues" aria-labelledby={headingId}>
      <h2 id={headingId} className="calendar-heading">
        À régler
      </h2>
      <FeedWarnings feeds={feeds} />
      {counts.length === 0 ? (
        <p>Rien à régler.</p>
      ) : (
        <button type="button" className="calendar-issues-toggle" aria-expanded={open} aria-controls={contentId} onClick={onToggle}>
          {counts.map(({ text, className }) => (
            <span key={text} className={className}>
              {text}
            </span>
          ))}
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      )}
      {open && counts.length > 0 && (
        <div id={contentId}>
          {conflicts.length > 0 && (
            <>
              <p>
                Le studio n'accueille qu'une chose à la fois&nbsp;: déplacez, raccourcissez ou annulez l'une des deux. Les
                occupations se changent dans leur calendrier.
              </p>
              <ul className="calendar-issue-list">
                {conflicts.map((conflict, i) => {
                  const day = quebecDayAndTime(new Date(conflict.start)).day
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => onShowDay(day)}>
                        {formatQuebecDay(conflict.start)}
                      </button>{' '}
                      <span className="calendar-issue-times">{fullTimes(conflict, day)}</span>
                      {conflict.things.map((thing, j) => (
                        <ConflictingThing key={j} thing={namedThing(thing, feeds)} />
                      ))}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {undatedSessions.length > 0 && (
            <>
              <h3>Sans date</h3>
              <ul className="calendar-issue-list">
                {undatedSessions.map((session) => {
                  const performers = sessionPerformers(session)
                  return (
                    <li key={session.id}>
                      <Link to={sessionPath(session)}>{session.title}</Link>
                      {performers && <span> {performers}</span>}
                      <span className="admin-meta"> {formatDuration(session.durationMinutes)}</span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

// One of a conflict's things, with its kind.
function ConflictingThing({ thing }: { thing: NamedThing }) {
  return (
    <span className="calendar-issue-thing">
      {THING_KIND_LABELS[thing.kind]}&nbsp;:{' '}
      {thing.kind === 'session' ? <SessionTitle id={thing.id} title={thing.title} status={thing.status} /> : <OccupationLabel title={thing.title} calendar={thing.calendar} />}
    </span>
  )
}

// The feeds whose last read failed, or that haven't been read yet, or that there are none.
function FeedWarnings({ feeds }: { feeds: Feed[] }) {
  if (feeds.length === 0) {
    return (
      <p className="admin-notice">
        Aucun calendrier externe&nbsp;: les conflits avec des occupations ne peuvent pas être trouvés. Ils
        s'ajoutent dans <Link to="/admin/configuration">Configuration</Link>, «&nbsp;Calendriers externes&nbsp;».
      </p>
    )
  }
  return feeds
    .filter((feed) => feed.error !== null || feed.readAt === null)
    .map((feed) => (
      <p key={feed.id} className="admin-notice admin-warning">
        ⚠{' '}
        {feed.error !== null
          ? `Des conflits peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier «\u00a0${feed.name}\u00a0» a échoué\u00a0: ${feed.error}`
          : `Le calendrier «\u00a0${feed.name}\u00a0» n'a pas encore été lu\u00a0: des conflits peuvent manquer.`}
      </p>
    ))
}
