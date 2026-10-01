import { useState } from 'react'
import type { EventListing, EventsResponse } from 'shared/events'
import { RA_PROMOTER_URL, useEvents } from '../events'
import './programmation.css'

type Filter = 'upcoming' | 'past'

const monthFormat = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric' })
const weekdayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'short' })
const shortMonthFormat = new Intl.DateTimeFormat('fr-CA', { month: 'short' })
const timeFormat = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' })

// The name is always written in lowercase, whatever the capitalization in RA (which has the venue as
// "Parking.Radio").
function lowercaseName(text: string) {
  return text.replace(/parking\.radio/gi, 'parking.radio')
}

// Flyers are full-size uploads (often 1080×1920), so rows load a small square crop from RA's image resizer,
// the same one ra.co uses. It takes the original URL in URL-safe base64.
function flyerThumbnail(flyer: string) {
  const encoded = btoa(flyer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `https://imgproxy.ra.co/_/quality:66/w:240/h:240/rt:fill/${encoded}`
}

export function Programmation() {
  const { data, failed } = useEvents()

  if (data) return <ProgrammationList data={data} />

  return (
    <div className="programmation">
      <div className="programmation-inner">
        <header className="programmation-header">
          <h1>Programmation</h1>
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

export function ProgrammationList({ data }: { data: EventsResponse }) {
  const [filter, setFilter] = useState<Filter>('upcoming')

  const shown = [...(filter === 'upcoming' ? data.upcoming : data.past)].sort(
    (a, b) => (filter === 'upcoming' ? 1 : -1) * a.start.localeCompare(b.start),
  )

  return (
    <div className="programmation">
      <div className="programmation-inner">
        <header className="programmation-header">
          <div>
            <h1>Programmation</h1>
            <a className="ra-link" href={data.promoterUrl} target="_blank" rel="noreferrer">
              parking.radio sur Resident Advisor ↗
            </a>
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

function EventRow({ event }: { event: EventListing }) {
  const title = lowercaseName(event.title)
  const start = new Date(event.start)
  const time = event.end
    ? `${timeFormat.format(start)} – ${timeFormat.format(new Date(event.end))}`
    : timeFormat.format(start)
  const meta = [event.venue, event.city, time].filter((part) => part !== null).map(lowercaseName)

  return (
    <li className="event">
      <time className="event-date" dateTime={event.start}>
        <span className="weekday">{weekdayFormat.format(start).replace('.', '')}</span>
        <span className="day">{start.getDate()}</span>
        <span className="short-month">{shortMonthFormat.format(start).replace('.', '')}</span>
      </time>
      {event.flyer ? (
        // The title links to the same page, so this link is skipped by keyboard and screen readers.
        <a
          className="event-flyer"
          href={event.url}
          target="_blank"
          rel="noreferrer"
          tabIndex={-1}
          aria-hidden="true"
        >
          <img src={flyerThumbnail(event.flyer)} alt="" loading="lazy" />
        </a>
      ) : (
        <div className="event-flyer placeholder" aria-hidden="true">
          parking
          <br />
          .radio
        </div>
      )}
      <div className="event-body">
        <h3>
          <a href={event.url} target="_blank" rel="noreferrer">
            {title}
          </a>
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
      <a className="event-ra" href={event.url} target="_blank" rel="noreferrer" aria-label={`${title} sur RA`}>
        voir sur RA →
      </a>
    </li>
  )
}

function groupByMonth(events: EventListing[]): [string, EventListing[]][] {
  const groups = new Map<string, EventListing[]>()
  for (const event of events) {
    const month = monthFormat.format(new Date(event.start))
    groups.set(month, [...(groups.get(month) ?? []), event])
  }
  return [...groups]
}
