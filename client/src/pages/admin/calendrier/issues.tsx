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
                const when = formatQuebecDay(conflict.start)
                return (
                  <IssueRow
                    key={i}
                    when={when}
                    action={
                      <button type="button" onClick={() => onShowDay(day)}>
                        <ActionText text="voir le jour" about={when} />
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
              explanation="Donnez-leur une date pour les voir dans le mois, et dans les conflits."
            >
              {undatedSessions.map((session) => (
                <IssueRow
                  key={session.id}
                  className={session.status !== 'planned' ? `admin-status-${session.status}` : undefined}
                  when="à déterminer"
                  action={
                    <Link to={sessionPath(session)} className="admin-button">
                      <ActionText text="lui donner une date" about={session.title} />
                    </Link>
                  }
                >
                  <SessionTitle id={session.id} title={session.title} status={session.status} />
                  <span className="admin-meta"> {[sessionPerformers(session), formatDuration(session.durationMinutes)].filter(Boolean).join(', ')}</span>
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

// What an action of a row says, e.g. "voir le jour →", and what it's about, which only screen readers read, without the
// arrow, e.g. "voir le jour, sam. 21 nov. 2026".
function ActionText({ text, about }: { text: string; about: string }) {
  return (
    <>
      {text}
      <span className="visually-hidden">, {about}</span>
      <span aria-hidden="true"> →</span>
    </>
  )
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
            échoué&nbsp;: {feed.error}. Voir {configuration}.
          </>
        ) : (
          `Le calendrier «\u00a0${feed.name}\u00a0» n'a pas encore été lu\u00a0: des conflits peuvent manquer.`
        )}
      </p>
    ))
}
