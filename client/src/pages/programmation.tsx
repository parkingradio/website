import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useApi } from '../api/use-api'
import { useFeature } from '../config-context'
import { RA_PROMOTER_URL } from '../ra'
import { QUEBEC_TIME_ZONE } from '../quebec-time'
import { eventsListing, raListing } from './programmation/listing'
import type { Listing, Row } from './programmation/listing'
import './programmation.css'

type Filter = 'upcoming' | 'past'

// Events' days and times are in Québec time, like the rest of the site, whatever the time zone of the browser or of the
// event's venue.
const inQuebec = { timeZone: QUEBEC_TIME_ZONE } as const
const monthFormat = new Intl.DateTimeFormat('fr-CA', { ...inQuebec, month: 'long', year: 'numeric' })
const weekdayFormat = new Intl.DateTimeFormat('fr-CA', { ...inQuebec, weekday: 'short' })
const dayFormat = new Intl.DateTimeFormat('fr-CA', { ...inQuebec, day: 'numeric' })
const shortMonthFormat = new Intl.DateTimeFormat('fr-CA', { ...inQuebec, month: 'short' })
const timeFormat = new Intl.DateTimeFormat('fr-CA', { ...inQuebec, hour: '2-digit', minute: '2-digit' })

// The name is always written in lowercase, whatever the capitalization in RA (which has the venue as
// "Parking.Radio").
function lowercaseName(text: string) {
  return text.replace(/parking\.radio/gi, 'parking.radio')
}

// The events from RA while the `evenements-publics` flag is off, or the public events once it's on. The flag is known
// before either is asked for: until then, the page is loading, as it would be either way.
export function Programmation() {
  const publicEvents = useFeature('evenements-publics')
  if (publicEvents === undefined) return <ProgrammationStatus failed={false} />
  return publicEvents ? <PublicProgrammation /> : <RaProgrammation />
}

function RaProgrammation() {
  const events = useApi('/api/ra-events')
  if (events.kind !== 'loaded') return <ProgrammationStatus failed={events.kind === 'error'} />
  return <ProgrammationList {...raListing(events.value)} />
}

// The public events, with the calendar feed of them, which doesn't depend on whether they could be loaded. What copying
// its address gave is kept here, since the header's links are rendered by another component once the events are loaded,
// so that it stays as they load.
function PublicProgrammation() {
  const events = useApi('/api/events')
  const address = `${window.location.origin}/calendar.ics`
  const [copy, copyAddress] = useCopy(address)
  const calendar = <CalendarLinks address={address} copy={copy} onCopy={copyAddress} />
  if (events.kind !== 'loaded') return <ProgrammationStatus failed={events.kind === 'error'} headerExtra={calendar} />
  return <ProgrammationList {...eventsListing(events.value)} headerExtra={calendar} />
}

// What copying gave last, a new one each time, so that each copy says so for its own moment.
type Copy = { status: 'idle' | 'copied' | 'failed' }
const NOT_COPIED: Copy = { status: 'idle' }

// Copies `text` when asked, and says that it's copied for a moment, but that it couldn't be until it's copied.
function useCopy(text: string): [Copy, () => Promise<void>] {
  const [copy, setCopy] = useState(NOT_COPIED)
  useEffect(() => {
    if (copy.status !== 'copied') return
    const timeout = setTimeout(() => setCopy(NOT_COPIED), 2000)
    return () => clearTimeout(timeout)
  }, [copy])
  // `navigator.clipboard` is undefined outside a secure context, which this catches too.
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopy({ status: 'copied' })
    } catch {
      setCopy({ status: 'failed' })
    }
  }
  return [copy, copyText]
}

// Subscribing to the calendar feed of the public events (see `GET /calendar.ics` in docs/design/server/events.md): a link
// that opens the calendar app, and the feed's https address to copy, for the apps that don't open webcal:// links.
function CalendarLinks({ address, copy, onCopy }: { address: string; copy: Copy; onCopy: () => void }) {
  return (
    <div className="calendar-links">
      <a href={`webcal://${window.location.host}/calendar.ics`}>s'abonner au calendrier</a>
      {' · '}
      <button type="button" onClick={onCopy}>
        copier le lien (Google Agenda, Outlook)
      </button>{' '}
      <span className="calendar-copied" role="status">
        {copy.status === 'copied' && 'lien copié'}
      </span>
      {copy.status === 'failed' && (
        <p className="calendar-failed" role="alert">
          Le lien n'a pas pu être copié&nbsp;: {address}
        </p>
      )}
    </div>
  )
}

// The page while the events are loading, or once they couldn't be.
function ProgrammationStatus({ failed, headerExtra }: { failed: boolean; headerExtra?: ReactNode }) {
  return (
    <div className="programmation">
      <div className="programmation-inner">
        <header className="programmation-header">
          <div>
            <h1>Programmation</h1>
            {headerExtra}
          </div>
        </header>
        {failed ? (
          <p className="status">
            La programmation n'a pas pu être chargée.{' '}
            <a href={RA_PROMOTER_URL} target="_blank" rel="noreferrer">
              {/* A non-breaking space keeps the arrow from wrapping onto a line of its own. */}
              Voir nos événements sur Resident Advisor&nbsp;→
            </a>
          </p>
        ) : (
          <p className="status">Chargement…</p>
        )}
      </div>
    </div>
  )
}

// `headerExtra`: what the header has under its title, e.g. the links of the calendar feed of the public events.
export function ProgrammationList({ upcoming, past, headerExtra }: Listing & { headerExtra?: ReactNode }) {
  const [filter, setFilter] = useState<Filter>('upcoming')

  // In the server's order: the soonest first, or the most recent first.
  const shown = filter === 'upcoming' ? upcoming : past

  return (
    <div className="programmation">
      <div className="programmation-inner">
        <header className="programmation-header">
          <div>
            <h1>Programmation</h1>
            <a className="ra-link" href={RA_PROMOTER_URL} target="_blank" rel="noreferrer">
              parking.radio sur Resident Advisor ↗
            </a>
            {headerExtra}
          </div>
          <div className="filters" role="group" aria-label="période">
            <button type="button" aria-pressed={filter === 'upcoming'} onClick={() => setFilter('upcoming')}>
              à venir
            </button>
            <button type="button" aria-pressed={filter === 'past'} onClick={() => setFilter('past')}>
              passés
            </button>
          </div>
        </header>

        {shown.length === 0 ? (
          <p className="status">
            {filter === 'upcoming' ? 'Rien de prévu pour le moment. Revenez bientôt.' : 'Aucun événement passé.'}
          </p>
        ) : (
          groupByMonth(shown).map(([month, monthEvents]) => (
            <section key={month} className="month">
              <h2>{month}</h2>
              <ol>
                {monthEvents.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function EventRow({ event }: { event: Row }) {
  const title = lowercaseName(event.title)
  const start = new Date(event.start)
  const time = event.end
    ? `${timeFormat.format(start)} – ${timeFormat.format(new Date(event.end))}`
    : timeFormat.format(start)
  const meta = [...event.places, time].map(lowercaseName)

  return (
    <li className="event">
      <time className="event-date" dateTime={event.start}>
        <span className="weekday">{weekdayFormat.format(start).replace('.', '')}</span>
        <span className="day">{dayFormat.format(start)}</span>
        <span className="short-month">{shortMonthFormat.format(start).replace('.', '')}</span>
      </time>
      <Flyer event={event} />
      <div className="event-body">
        <h3>
          {event.url ? (
            <a href={event.url} target="_blank" rel="noreferrer">
              {title}
            </a>
          ) : (
            title
          )}
        </h3>
        <p className="event-meta">
          {meta.map((part, index) => (
            <span key={index}>
              {index > 0 && ' · '}
              <span className="meta-part">{part}</span>
            </span>
          ))}
        </p>
        {event.lineup.length > 0 && <p className="event-lineup">{lowercaseName(event.lineup.join(' / '))}</p>}
      </div>
      {event.url && (
        <a className="event-ra" href={event.url} target="_blank" rel="noreferrer" aria-label={`${title} sur RA`}>
          voir sur RA →
        </a>
      )}
    </li>
  )
}

// The event's flyer, or a placeholder when it has none.
function Flyer({ event }: { event: Row }) {
  if (!event.flyer) {
    return (
      <div className="event-flyer placeholder" aria-hidden="true">
        parking
        <br />
        .radio
      </div>
    )
  }
  const image = <img src={event.flyer} alt="" loading="lazy" />
  if (!event.url) {
    return (
      <div className="event-flyer" aria-hidden="true">
        {image}
      </div>
    )
  }
  return (
    // The title links to the same page, so this link is skipped by keyboard and screen readers.
    <a className="event-flyer" href={event.url} target="_blank" rel="noreferrer" tabIndex={-1} aria-hidden="true">
      {image}
    </a>
  )
}

function groupByMonth(events: Row[]): [string, Row[]][] {
  const groups = new Map<string, Row[]>()
  for (const event of events) {
    const month = monthFormat.format(new Date(event.start))
    groups.set(month, [...(groups.get(month) ?? []), event])
  }
  return [...groups]
}
