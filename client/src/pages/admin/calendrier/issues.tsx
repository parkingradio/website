import { useId } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { quebecDayAndTime } from '../../../quebec-time'
import { conflictCount, formatDuration, formatQuebecDay, formatQuebecDayInYear, sessionPerformers } from '../describe'
import { sessionPath } from '../session-errors'
import { nameOf, namedThing, overlapTimes } from './model'
import type { Calendar, Feed } from './model'
import { SessionStatus } from './things'

// "À régler": one box, whose first row opens it, with how many conflicts and sessions without a date there are, then
// what the feeds' reads say, and, opened, the conflicts and the sessions without a date (see "À régler" in
// docs/design/client/admin/calendrier.md).

type IssuesProps = {
  calendar: Calendar
  // Today, whose year the days of the conflicts don't say.
  today: string
  open: boolean
  onToggle: () => void
  // Shows a day, chosen, in the month.
  onShowDay: (day: string) => void
}

export function Issues({ calendar: { conflicts, undatedSessions, feeds }, today, open, onToggle, onShowDay }: IssuesProps) {
  const titleId = useId()
  const contentId = useId()
  const nothing = conflicts.length === 0 && undatedSessions.length === 0
  const title = (
    <span id={titleId} className="calendar-issues-title">
      À régler
    </span>
  )

  return (
    <section className="calendar-issues" aria-labelledby={titleId}>
      <h2 className="calendar-heading">
        {/* The same button whether there's something to settle or not, so that it keeps the focus when that changes. */}
        <button
          type="button"
          className="calendar-issues-header"
          aria-disabled={nothing || undefined}
          aria-expanded={nothing ? undefined : open}
          aria-controls={open && !nothing ? contentId : undefined}
          onClick={nothing ? undefined : onToggle}
        >
          {title}
          {nothing && (
            <>
              {' '}
              <span className="admin-meta">rien</span>
            </>
          )}
          {conflicts.length > 0 && (
            <>
              {' '}
              <Tag conflict>{conflictCount(conflicts.length)}</Tag>
            </>
          )}
          {undatedSessions.length > 0 && (
            <>
              {' '}
              <Tag>{undatedSessions.length} sans date</Tag>
            </>
          )}
          {!nothing && (
            <span aria-hidden="true" className="calendar-issues-chevron">
              {open ? '⌄' : '›'}
            </span>
          )}
        </button>
      </h2>
      <FeedWarnings feeds={feeds} />
      {open && !nothing && (
        <div id={contentId}>
          {conflicts.length > 0 && (
            <IssueGroup
              tag={<Tag conflict>conflits</Tag>}
              heading="chevauchements à résoudre"
              explanation={"Le studio n'accueille qu'une chose à la fois\u00a0: déplacez, raccourcissez ou annulez l'une des deux. Les occupations se changent dans leur calendrier."}
            >
              {conflicts.map((conflict, i) => {
                const day = quebecDayAndTime(new Date(conflict.start)).day
                // Without its year, unless it's another one than today's.
                const when = day.slice(0, 4) === today.slice(0, 4) ? formatQuebecDayInYear(conflict.start) : formatQuebecDay(conflict.start)
                const [a, b] = conflict.things.map((thing) => nameOf(namedThing(thing, feeds)))
                return (
                  <li key={i}>
                    <button type="button" className="calendar-issue-row" onClick={() => onShowDay(day)}>
                      <IssueText when={when}>
                        {overlapTimes(conflict, day)} · <strong>{a}</strong> et <strong>{b}</strong>
                      </IssueText>
                    </button>
                  </li>
                )
              })}
            </IssueGroup>
          )}
          {undatedSessions.length > 0 && (
            <IssueGroup
              tag={<Tag>sans date</Tag>}
              heading="sessions à placer"
              explanation="Donnez-leur une date pour les voir dans le mois, et dans les conflits."
            >
              {undatedSessions.map((session) => (
                <li key={session.id} className={`admin-status-${session.status}`}>
                  <Link to={sessionPath(session)} className="calendar-issue-row">
                    <IssueText when="à déterminer">
                      <strong>{session.title}</strong>
                      <SessionStatus status={session.status} /> ·{' '}
                      {[sessionPerformers(session), formatDuration(session.durationMinutes)].filter(Boolean).join(', ')}
                    </IssueText>
                  </Link>
                </li>
              ))}
            </IssueGroup>
          )}
        </div>
      )}
    </section>
  )
}

// A count, or a group's kind, in a tag: conflicts' in their red.
function Tag({ conflict = false, children }: { conflict?: boolean; children: ReactNode }) {
  return <span className={conflict ? 'calendar-tag calendar-conflict-tag' : 'calendar-tag'}>{children}</span>
}

// A kind of thing to settle: its tag and its heading, what to do about it, then a row for each one.
function IssueGroup({ tag, heading, explanation, children }: { tag: ReactNode; heading: string; explanation: string; children: ReactNode }) {
  return (
    <div className="calendar-issue-group">
      <h3>
        {tag} {heading}
      </h3>
      <p className="admin-meta">{explanation}</p>
      <ul className="calendar-issue-list">{children}</ul>
    </div>
  )
}

// What a row to settle says, on one line: when, then what it is. The whole row is what's done about it, so its text,
// which names it, has no links of its own.
function IssueText({ when, children }: { when: string; children: ReactNode }) {
  return (
    <>
      <span className="calendar-issue-when">{when}</span> <span className="calendar-issue-what">{children}</span>
    </>
  )
}

// The feeds whose last read failed, which are changed in Configuration, or that haven't been read yet, or that there are
// none.
function FeedWarnings({ feeds }: { feeds: Feed[] }) {
  const configuration = <Link to="/admin/configuration">Configuration</Link>
  if (feeds.length === 0) {
    return (
      <p className="admin-notice">
        Aucun calendrier externe&nbsp;: les conflits avec des occupations ne peuvent pas être trouvés. Ils s'ajoutent dans{' '}
        {configuration}, «&nbsp;Calendriers externes&nbsp;».
      </p>
    )
  }
  return feeds
    .filter((feed) => feed.error !== null || feed.readAt === null)
    .map((feed) => (
      <p key={feed.id} className="admin-notice admin-warning">
        ⚠{' '}
        {feed.error !== null ? (
          <>
            Des conflits peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier «&nbsp;{feed.name}&nbsp;» a
            échoué&nbsp;: {feed.error}. Voir {configuration}.
          </>
        ) : (
          `Le calendrier «\u00a0${feed.name}\u00a0» n'a pas encore été lu\u00a0: des conflits peuvent manquer.`
        )}
      </p>
    ))
}
