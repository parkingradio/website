import { useId } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { quebecDayAndTime } from '../../../quebec-time'
import { THING_KIND_LABELS, conflictCount, formatDuration, formatQuebecDay, sessionPerformers } from '../describe'
import { sessionPath } from '../session-errors'
import { fullTimes, namedThing } from './model'
import type { Calendar, Feed, NamedThing } from './model'
import { OccupationLabel, SessionTitle } from './things'

// "À régler": one box, whose first row opens it, with how many conflicts and sessions without a date there are, then
// what the feeds' reads say, and, opened, the conflicts and the sessions without a date (see "À régler" in
// docs/design/client/admin/calendrier.md).

type IssuesProps = {
  calendar: Calendar
  open: boolean
  onToggle: () => void
  // Shows a day, chosen, in the month.
  onShowDay: (day: string) => void
}

export function Issues({ calendar: { conflicts, undatedSessions, feeds }, open, onToggle, onShowDay }: IssuesProps) {
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
        {nothing ? (
          <span className="calendar-issues-header">
            {title} Rien à régler.
          </span>
        ) : (
          <button type="button" className="calendar-issues-header" aria-expanded={open} aria-controls={open ? contentId : undefined} onClick={onToggle}>
            {title}
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
            <span aria-hidden="true" className="calendar-issues-chevron">
              {open ? '⌄' : '›'}
            </span>
          </button>
        )}
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
                const when = formatQuebecDay(conflict.start)
                return (
                  <IssueRow
                    key={i}
                    when={when}
                    action={
                      <button type="button" aria-label={`voir le jour, ${when}`} onClick={() => onShowDay(day)}>
                        voir le jour →
                      </button>
                    }
                  >
                    <span className="admin-meta">{fullTimes(conflict, day)}</span>
                    {conflict.things.map((thing, j) => (
                      <ConflictingThing key={j} thing={namedThing(thing, feeds)} />
                    ))}
                  </IssueRow>
                )
              })}
            </IssueGroup>
          )}
          {undatedSessions.length > 0 && (
            <IssueGroup
              tag={<Tag>sans date</Tag>}
              heading="sessions à placer"
              explanation={"Elles n'ont pas encore de date\u00a0: elles ne sont ni dans le mois, ni dans les conflits."}
            >
              {undatedSessions.map((session) => (
                <IssueRow
                  key={session.id}
                  className={session.status !== 'planned' ? `admin-status-${session.status}` : undefined}
                  when="à déterminer"
                  action={
                    <Link to={sessionPath(session)}>
                      lui donner une date<span className="visually-hidden"> : {session.title}</span> →
                    </Link>
                  }
                >
                  <SessionTitle id={session.id} title={session.title} status={session.status} />
                  <span className="admin-meta">
                    {' '}
                    {[sessionPerformers(session), formatDuration(session.durationMinutes)].filter(Boolean).join(' · ')}
                  </span>
                </IssueRow>
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

// A thing to settle: when, what it is, and what to do about it.
function IssueRow({ when, action, className, children }: { when: string; action: ReactNode; className?: string; children: ReactNode }) {
  return (
    <li className={className}>
      <span className="calendar-issue-when">{when}</span>
      <span className="calendar-issue-what">{children}</span>
      <span className="calendar-issue-action">{action}</span>
    </li>
  )
}

// One of a conflict's things, with its kind.
function ConflictingThing({ thing }: { thing: NamedThing }) {
  return (
    <span className={thing.kind === 'session' && thing.status !== 'planned' ? `calendar-issue-thing admin-status-${thing.status}` : 'calendar-issue-thing'}>
      {THING_KIND_LABELS[thing.kind]}&nbsp;:{' '}
      {thing.kind === 'session' ? <SessionTitle id={thing.id} title={thing.title} status={thing.status} /> : <OccupationLabel title={thing.title} calendar={thing.calendar} />}
    </span>
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
            échoué&nbsp;: {feed.error} (voir {configuration})
          </>
        ) : (
          `Le calendrier «\u00a0${feed.name}\u00a0» n'a pas encore été lu\u00a0: des conflits peuvent manquer.`
        )}
      </p>
    ))
}
