import { useId } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { quebecDayAndTime } from '../../../quebec-time'
import { conflictCount, formatDuration, sessionPerformers } from '../describe'
import { sessionPath } from '../session-errors'
import { briefTimes, nameOf, namedThing, startDay } from './model'
import type { Calendar, Feed } from './model'
import { SessionStatus } from './things'

// "À régler": one box, whose first row opens it, with how many conflicts, sessions outside protected time and sessions
// without a date there are, then what the feeds' reads say, and, opened, each of them (see "À régler" in
// docs/design/client/admin/calendrier.md).

type IssuesProps = {
  calendar: Calendar
  // Today, whose year the days of the rows don't say.
  today: string
  open: boolean
  onToggle: () => void
  // Shows a day, chosen, in the month.
  onShowDay: (day: string) => void
}

export function Issues({ calendar: { conflicts, unprotectedSessions, undatedSessions, feeds }, today, open, onToggle, onShowDay }: IssuesProps) {
  const titleId = useId()
  const contentId = useId()
  const nothing = conflicts.length === 0 && unprotectedSessions.length === 0 && undatedSessions.length === 0
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
          {unprotectedSessions.length > 0 && (
            <>
              {' '}
              <Tag>{unprotectedSessions.length} hors plage protégée</Tag>
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
            >
              {conflicts.map((conflict, i) => {
                const [a, b] = conflict.things.map((thing) => nameOf(namedThing(thing, feeds)))
                return (
                  <DayLine key={i} times={conflict} today={today} onShowDay={onShowDay}>
                    <strong>{a}</strong> et <strong>{b}</strong>
                  </DayLine>
                )
              })}
            </IssueGroup>
          )}
          {unprotectedSessions.length > 0 && (
            <IssueGroup tag={<Tag>hors plage protégée</Tag>} heading="sessions à protéger ou à déplacer">
              {unprotectedSessions.map((session) => (
                <DayLine key={session.id} times={session} today={today} onShowDay={onShowDay}>
                  <strong>{session.title}</strong>
                </DayLine>
              ))}
            </IssueGroup>
          )}
          {undatedSessions.length > 0 && (
            <IssueGroup
              tag={<Tag>sans date</Tag>}
              heading="sessions à placer"
            >
              {undatedSessions.map((session) => (
                <li key={session.id} className={`admin-status-${session.status}`}>
                  <Link to={sessionPath(session)} className="calendar-line">
                    <LineText when="à déterminer">
                      <strong>{session.title}</strong>
                      <SessionStatus status={session.status} /> ·{' '}
                      {[sessionPerformers(session), formatDuration(session.durationMinutes)].filter(Boolean).join(', ')}
                    </LineText>
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

// What a row says, on one line: when, then what it is. The whole row is what's done about it, a button or a link, so its
// text, which names it, has no links of its own.
function LineText({ when, children }: { when: string; children: ReactNode }) {
  return (
    <>
      <span className="calendar-line-when">{when}</span> <span className="calendar-line-what">{children}</span>
    </>
  )
}

// A row about something on a day, which shows the day it starts: that day, then its times in brief on it, and what it is.
function DayLine({ times, today, onShowDay, children }: { times: { start: string; end: string }; today: string; onShowDay: (day: string) => void; children: ReactNode }) {
  const day = quebecDayAndTime(new Date(times.start)).day
  return (
    <li>
      <button type="button" className="calendar-line" onClick={() => onShowDay(day)}>
        <LineText when={startDay(times, today)}>
          {briefTimes(times, day)} · {children}
        </LineText>
      </button>
    </li>
  )
}

// A count, or a group's kind, in a tag: conflicts' in their red.
function Tag({ conflict = false, children }: { conflict?: boolean; children: ReactNode }) {
  return <span className={conflict ? 'calendar-tag calendar-conflict-tag' : 'calendar-tag'}>{children}</span>
}

// A kind of thing to settle: its tag and its heading, then a row for each one.
function IssueGroup({ tag, heading, children }: { tag: ReactNode; heading: string; children: ReactNode }) {
  return (
    <div className="calendar-issue-group">
      <h3>
        {tag} {heading}
      </h3>
      <ul className="calendar-lines">{children}</ul>
    </div>
  )
}

// The feeds whose last read failed, which are changed in Configuration, or that haven't been read yet, each with what it
// affects: an `occupations` feed's conflicts, and free time while there's a `holds` feed, which there's none of
// otherwise, and a `holds` feed's free time and sessions outside protected time.
function FeedWarnings({ feeds }: { feeds: Feed[] }) {
  const holds = feeds.some(({ kind }) => kind === 'holds')
  return feeds
    .filter((feed) => feed.error !== null || feed.readAt === null)
    .map((feed) => {
      // What a failed read can make missing or out of date, and what a feed not read yet can make missing or wrong.
      const [affected, missing] =
        feed.kind === 'holds'
          ? [
              'Des plages disponibles et des sessions hors plage protégée',
              'des plages disponibles peuvent manquer, et des sessions être signalées à tort hors plage protégée',
            ]
          : holds
            ? ['Des conflits et des plages disponibles', 'des conflits peuvent manquer, et des plages être indiquées disponibles à tort']
            : ['Des conflits', 'des conflits peuvent manquer']
      return (
        <p key={feed.id} className="admin-notice admin-warning">
          ⚠{' '}
          {feed.error !== null ? (
            <>
              {affected} peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier «&nbsp;{feed.name}&nbsp;» a
              échoué&nbsp;: {feed.error}. Voir <Link to="/admin/configuration">Configuration</Link>.
            </>
          ) : (
            `Le calendrier «\u00a0${feed.name}\u00a0» n'a pas encore été lu\u00a0: ${missing}.`
          )}
        </p>
      )
    })
}
