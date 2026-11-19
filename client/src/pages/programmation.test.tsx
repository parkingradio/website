import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Schema } from '../api/client'
import { ConfigContext } from '../config-context'
import type { ConfigState } from '../config-context'
import { configWith, mockFetch, requestsTo } from '../test-utils'
import { Programmation, ProgrammationList } from './programmation'
import { eventsListing, raListing } from './programmation/listing'

// The events as the server gives them: the upcoming ones the soonest first, and the past ones the most recent first.
const data: Schema<'RaEvents'> = {
  promoterUrl: 'https://ra.co/promoters/183980',
  upcoming: [
    {
      id: 'soon',
      title: 'Soon Party',
      category: 'other',
      start: '2026-10-03T22:00:00-04:00',
      end: '2026-10-04T03:00:00-04:00',
      venue: 'Venue A',
      city: 'Montréal',
      lineup: ['Artist A', 'Artist B'],
      url: 'https://ra.co/events/1',
      flyer: 'https://images.ra.co/soon.png',
    },
    {
      id: 'later',
      title: 'Later Party',
      category: 'other',
      start: '2026-11-07T21:00:00-05:00',
      end: null,
      venue: 'Venue B',
      city: 'Québec',
      lineup: [],
      url: 'https://ra.co/events/2',
      flyer: null,
    },
  ],
  past: [
    {
      id: 'recent',
      title: 'Recent Party',
      category: 'other',
      start: '2026-09-05T22:00:00-04:00',
      end: null,
      venue: 'Venue A',
      city: 'Montréal',
      lineup: [],
      url: 'https://ra.co/events/4',
      flyer: null,
    },
    {
      id: 'older',
      title: 'Older Party',
      category: 'other',
      start: '2026-08-16T19:00:00-04:00',
      end: null,
      venue: null,
      city: null,
      lineup: [],
      url: 'https://ra.co/events/3',
      flyer: null,
    },
  ],
}

// A public event, with no sets, lineup, flyer or event on RA unless it's given them.
function publicEvent(fields: Partial<Schema<'Event'>> & Pick<Schema<'Event'>, 'id' | 'title' | 'start' | 'end'>): Schema<'Event'> {
  return { type: 'other', takeover: null, cancelled: false, description: '', flyer: null, raEvent: null, sets: [], lineup: [], ...fields }
}

// A lineup, as the server gives it.
const lineupOf = (names: string[]) => names.map((name) => ({ id: name.toLowerCase(), name }))

// A set of a public event, played by these artists, unless it's cancelled.
function publicSet(names: string[], cancelled = false): Schema<'EventSet'> {
  return {
    id: names.join('-'),
    performers: names.map((name) => ({ id: name.toLowerCase(), name })),
    durationMinutes: 60,
    performanceTypes: [],
    otherPerformanceType: '',
    genres: [],
    cancelled,
    soundcloudTrack: null,
    youtubeVideo: null,
  }
}

// The public events as the server gives them: the upcoming ones the soonest first, and the past ones the most recent
// first.
const events: Schema<'Events'> = {
  ok: true,
  upcoming: [
    publicEvent({
      id: 'mixes',
      title: 'GUEST MIXES',
      type: 'guest-mixes',
      start: '2026-10-03T21:00:00-04:00',
      end: '2026-10-03T23:30:00-04:00',
      flyer: '/api/events/mixes/flyer',
      raEvent: 'https://ra.co/events/2201001',
      // Brume plays twice, and Dune's set is cancelled.
      sets: [publicSet(['Aurore', 'Brume']), publicSet(['Dune'], true), publicSet(['Brume', 'Cyan'])],
      lineup: lineupOf(['Aurore', 'Brume', 'Cyan']),
    }),
    publicEvent({ id: 'meetup', title: 'SYNTH MEETUPS', type: 'synth-meetup', start: '2026-10-07T18:00:00-04:00', end: '2026-10-07T21:00:00-04:00' }),
    publicEvent({
      id: 'cancelled',
      title: 'HAUTE RIVE TAKEOVER',
      type: 'takeover',
      takeover: { id: 'haute-rive', name: 'Haute Rive' },
      start: '2026-10-10T20:00:00-04:00',
      end: '2026-10-10T22:00:00-04:00',
      cancelled: true,
      raEvent: 'https://ra.co/events/2201002',
      sets: [publicSet(['Écume'], true)],
    }),
    publicEvent({
      id: 'cancelled-meetup',
      title: 'SYNTH MEETUPS',
      type: 'synth-meetup',
      start: '2026-10-14T18:00:00-04:00',
      end: '2026-10-14T21:00:00-04:00',
      cancelled: true,
    }),
    publicEvent({ id: 'workshop', title: 'ATELIER DE PARKING.RADIO', start: '2026-11-07T14:00:00-05:00', end: '2026-11-07T16:00:00-05:00' }),
  ],
  past: [
    publicEvent({
      id: 'played',
      title: 'LIVE PERFORMANCE',
      type: 'live-performance',
      start: '2026-09-05T20:00:00-04:00',
      end: '2026-09-05T21:00:00-04:00',
      sets: [publicSet(['Ondine'])],
      lineup: lineupOf(['Ondine']),
    }),
  ],
}

const eventTitles = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

// The configuration, as it is while it's loading, once it couldn't be fetched, or with the `evenements-publics` flag off or
// on.
const LOADING: ConfigState = { kind: 'loading' }
const FAILED: ConfigState = { kind: 'failed' }
const configured = (publicEvents: boolean) => configWith({ 'evenements-publics': publicEvents })

function renderPage(config: ConfigState) {
  return render(
    <ConfigContext value={config}>
      <Programmation />
    </ConfigContext>,
  )
}

describe('Programmation', () => {
  it('asks for no events until it knows whether the flag is on, and says that it is loading', async () => {
    mockFetch({ '/api/ra-events': data, '/api/events': events })
    renderPage(LOADING)

    expect(screen.getByText('Chargement…')).toBeInTheDocument()
    // Whatever the page would have asked for by now.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requestsTo('GET', '/api/ra-events')).toHaveLength(0)
    expect(requestsTo('GET', '/api/events')).toHaveLength(0)
  })

  it('loads the events from RA while the flag is off', async () => {
    mockFetch({ '/api/ra-events': data })
    renderPage(configured(false))

    expect(await screen.findByRole('heading', { name: 'Soon Party' })).toBeInTheDocument()
    expect(requestsTo('GET', '/api/ra-events')).toHaveLength(1)
  })

  it("loads the events from RA when the configuration couldn't be fetched, as if the flag were off", async () => {
    mockFetch({ '/api/ra-events': data })
    renderPage(FAILED)

    expect(await screen.findByRole('heading', { name: 'Soon Party' })).toBeInTheDocument()
  })

  it('loads the public events, and never the events from RA, once the flag is on', async () => {
    mockFetch({ '/api/events': events })
    renderPage(configured(true))

    expect(await screen.findByRole('heading', { name: 'GUEST MIXES' })).toBeInTheDocument()
    expect(requestsTo('GET', '/api/events')).toHaveLength(1)
    expect(requestsTo('GET', '/api/ra-events')).toHaveLength(0)
  })

  it('has the links of the calendar feed once the flag is on, whether the events are loading, loaded or not', async () => {
    const webcal = `webcal://${location.host}/calendar.ics`
    const subscribe = () => screen.queryByRole('link', { name: "s'abonner au calendrier" })

    mockFetch({ '/api/events': events })
    const loaded = renderPage(configured(true))
    expect(screen.getByText('Chargement…')).toBeInTheDocument()
    expect(subscribe()).toHaveAttribute('href', webcal)
    expect(await screen.findByRole('heading', { name: 'GUEST MIXES' })).toBeInTheDocument()
    expect(subscribe()).toHaveAttribute('href', webcal)
    loaded.unmount()

    mockFetch({ '/api/events': { ok: false, error: 'Events are unavailable right now' } })
    renderPage(configured(true))
    expect(await screen.findByText(/La programmation n'a pas pu être chargée/)).toBeInTheDocument()
    expect(subscribe()).toHaveAttribute('href', webcal)
    expect(screen.getByRole('button', { name: 'copier le lien (Google Agenda, Outlook)' })).toBeInTheDocument()
  })

  it('has no links of the calendar feed while the flag is off', async () => {
    mockFetch({ '/api/ra-events': data })
    renderPage(configured(false))
    expect(await screen.findByRole('heading', { name: 'Soon Party' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: "s'abonner au calendrier" })).toBeNull()
    expect(screen.queryByRole('button', { name: /copier le lien/ })).toBeNull()
  })

  it.each([
    ['from RA', false, '/api/ra-events'],
    ['public', true, '/api/events'],
  ])('points to Resident Advisor when the %s events cannot be loaded', async (_, publicEvents, url) => {
    mockFetch({ [url]: { ok: false, error: 'Events are unavailable right now' } })
    renderPage(configured(publicEvents))

    expect(await screen.findByRole('link', { name: /Resident Advisor/ })).toHaveAttribute(
      'href',
      'https://ra.co/promoters/183980',
    )
  })
})

describe('ProgrammationList, from RA', () => {
  it('lists upcoming events in the order the server gives, the soonest first, grouped by month', () => {
    render(<ProgrammationList {...raListing(data)} />)
    expect(eventTitles()).toEqual(['Soon Party', 'Later Party'])
    const months = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(months).toEqual(['octobre 2026', 'novembre 2026'])
  })

  it('shows the venue, city, times and lineup of each event', () => {
    render(<ProgrammationList {...raListing(data)} />)
    const row = screen.getByRole('heading', { name: 'Soon Party' }).closest('li')!
    expect(row).toHaveTextContent('Venue A · Montréal · 22 h 00 – 03 h 00')
    expect(within(row).getByText('Artist A / Artist B')).toBeInTheDocument()
  })

  it('links each event to its Resident Advisor page', () => {
    render(<ProgrammationList {...raListing(data)} />)
    const row = screen.getByRole('heading', { name: 'Soon Party' }).closest('li')!
    for (const link of within(row).getAllByRole('link')) {
      expect(link).toHaveAttribute('href', 'https://ra.co/events/1')
    }
  })

  it("links to the promoter's Resident Advisor page", () => {
    render(<ProgrammationList {...raListing(data)} />)
    expect(screen.getByRole('link', { name: /parking.radio sur Resident Advisor/ })).toHaveAttribute(
      'href',
      'https://ra.co/promoters/183980',
    )
  })

  it('shows past events, in the order the server gives, the most recent first, when switching to "passés"', () => {
    render(<ProgrammationList {...raListing(data)} />)
    fireEvent.click(screen.getByRole('button', { name: 'passés' }))
    expect(screen.getByRole('button', { name: 'passés' })).toHaveAttribute('aria-pressed', 'true')
    expect(eventTitles()).toEqual(['Recent Party', 'Older Party'])
  })

  it("shows a square thumbnail of each event's flyer, linking to the event on RA", () => {
    const { container } = render(<ProgrammationList {...raListing(data)} />)
    const thumbnails = container.querySelectorAll('.event-flyer img')
    expect(thumbnails).toHaveLength(1)
    const src = thumbnails[0].getAttribute('src')!
    expect(src).toMatch(/^https:\/\/imgproxy\.ra\.co\/.*\/w:240\/h:240\/rt:fill\//)
    expect(atob(src.split('/').pop()!)).toBe('https://images.ra.co/soon.png')
    expect(thumbnails[0].closest('a')).toHaveAttribute('href', 'https://ra.co/events/1')
  })

  it('always writes parking.radio in lowercase', () => {
    const event = {
      ...data.upcoming[0],
      title: 'GUEST MIXES - PARKING.RADIO',
      venue: 'Parking.Radio',
      city: 'Québec',
      lineup: ['Parking.radio crew'],
    }
    render(<ProgrammationList {...raListing({ ...data, upcoming: [event] })} />)
    const row = screen.getByRole('listitem')
    expect(within(row).getByRole('heading')).toHaveTextContent('GUEST MIXES - parking.radio')
    expect(row).toHaveTextContent('parking.radio · Québec')
    expect(row).toHaveTextContent('parking.radio crew')
    expect(row.textContent).not.toMatch(/Parking\.Radio|PARKING\.RADIO|Parking\.radio/)
  })

  it("shows days and times in Québec time, whatever the browser's time zone", async () => {
    // Loaded again in Tokyo's time zone, since formatters keep the one they're created in, where 22:00 on October 31 in
    // Québec is already 11:00 on November 1.
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    try {
      const { ProgrammationList: TokyoList } = await import('./programmation')
      const halloween = { ...data.upcoming[0], id: 'halloween', title: 'Halloween', start: '2026-10-31T22:00:00-04:00', end: '2026-11-01T02:00:00-05:00' }
      render(<TokyoList {...raListing({ ...data, upcoming: [halloween] })} />)

      expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['octobre 2026'])
      const row = screen.getByRole('heading', { name: 'Halloween' }).closest('li')!
      expect(row.querySelector('.event-date')).toHaveTextContent('sam31oct')
      expect(row).toHaveTextContent('22 h 00 – 02 h 00')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('says so when nothing is coming up', () => {
    render(<ProgrammationList {...raListing({ ...data, upcoming: [] })} />)
    expect(screen.getByText(/Rien de prévu/)).toBeInTheDocument()
  })
})

describe('ProgrammationList, from the public events', () => {
  const rowOf = (id: string) => screen.getAllByRole('listitem')[events.upcoming.findIndex((event) => event.id === id)]

  it('lists upcoming events in the order the server gives, the soonest first, grouped by month, cancelled ones included', () => {
    render(<ProgrammationList {...eventsListing(events)} />)
    expect(eventTitles()).toEqual(['GUEST MIXES', 'SYNTH MEETUPS', '[CANCELLED] HAUTE RIVE TAKEOVER', '[CANCELLED] SYNTH MEETUPS', 'ATELIER DE parking.radio'])
    const months = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(months).toEqual(['octobre 2026', 'novembre 2026'])
  })

  it('shows past events, the most recent first, when switching to "passés"', () => {
    render(<ProgrammationList {...eventsListing(events)} />)
    fireEvent.click(screen.getByRole('button', { name: 'passés' }))
    expect(eventTitles()).toEqual(['LIVE PERFORMANCE'])
    expect(screen.getByRole('listitem')).toHaveTextContent('Ondine')
  })

  it('shows the times of each event, without a venue or a city, which are always the studio', () => {
    render(<ProgrammationList {...eventsListing(events)} />)
    expect(rowOf('mixes').querySelector('.event-meta')).toHaveTextContent(/^21 h 00 – 23 h 30$/)
  })

  it('shows the lineup the server gives', () => {
    render(<ProgrammationList {...eventsListing(events)} />)
    expect(rowOf('mixes').querySelector('.event-lineup')).toHaveTextContent(/^Aurore \/ Brume \/ Cyan$/)
  })

  it("shows OPEN JAM as the lineup of a synth meetup without one, unless it's cancelled, and no lineup otherwise", () => {
    render(<ProgrammationList {...eventsListing(events)} />)
    expect(rowOf('meetup').querySelector('.event-lineup')).toHaveTextContent(/^OPEN JAM$/)
    for (const id of ['cancelled', 'cancelled-meetup', 'workshop']) expect(rowOf(id).querySelector('.event-lineup')).toBeNull()
  })

  it('shows the flyer from the server, full size, loaded once it comes into view, or a placeholder', () => {
    render(<ProgrammationList {...eventsListing(events)} />)
    const flyer = rowOf('mixes').querySelector('.event-flyer img')!
    expect(flyer).toHaveAttribute('src', '/api/events/mixes/flyer')
    expect(flyer).toHaveAttribute('loading', 'lazy')
    expect(rowOf('meetup').querySelector('.event-flyer')).toHaveClass('placeholder')
  })

  it('links the flyer, the title and « voir sur RA » to the event on RA when it has one', () => {
    render(<ProgrammationList {...eventsListing(events)} />)
    const links = within(rowOf('mixes')).getAllByRole('link', { hidden: true })
    expect(links).toHaveLength(3)
    for (const link of links) expect(link).toHaveAttribute('href', 'https://ra.co/events/2201001')
    expect(within(rowOf('mixes')).getByRole('link', { name: 'GUEST MIXES sur RA' })).toHaveTextContent('voir sur RA →')
    expect(within(rowOf('cancelled')).getByRole('link', { name: '[CANCELLED] HAUTE RIVE TAKEOVER sur RA' })).toBeInTheDocument()
  })

  it('links nothing for an event without an event on RA', () => {
    render(<ProgrammationList {...eventsListing({ ...events, upcoming: [{ ...events.upcoming[0], raEvent: null }] })} />)
    const row = screen.getByRole('listitem')
    expect(within(row).queryAllByRole('link', { hidden: true })).toHaveLength(0)
    expect(within(row).getByRole('heading')).toHaveTextContent('GUEST MIXES')
    expect(row.querySelector('.event-flyer img')).toHaveAttribute('src', '/api/events/mixes/flyer')
    expect(row).not.toHaveTextContent('voir sur RA')
  })

  it("links to the promoter's Resident Advisor page", () => {
    render(<ProgrammationList {...eventsListing(events)} />)
    expect(screen.getByRole('link', { name: /parking.radio sur Resident Advisor/ })).toHaveAttribute('href', 'https://ra.co/promoters/183980')
  })

  it('says so when nothing is coming up', () => {
    render(<ProgrammationList {...eventsListing({ ...events, upcoming: [] })} />)
    expect(screen.getByText(/Rien de prévu/)).toBeInTheDocument()
  })
})

describe('the links of the calendar feed', () => {
  const address = `${location.origin}/calendar.ics`
  const copyButton = () => screen.getByRole('button', { name: 'copier le lien (Google Agenda, Outlook)' })
  const withClipboard = (clipboard: Partial<Clipboard> | undefined) =>
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })

  // The page with the public events, loaded.
  async function loadedPage() {
    mockFetch({ '/api/events': events })
    renderPage(configured(true))
    expect(await screen.findByRole('heading', { name: 'GUEST MIXES' })).toBeInTheDocument()
  }

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('copies the https address of the feed, and says so for a moment after each copy', async () => {
    const writeText = vi.fn(async () => {})
    withClipboard({ writeText })
    await loadedPage()
    vi.useFakeTimers()

    await act(async () => fireEvent.click(copyButton()))
    expect(writeText).toHaveBeenCalledWith(address)
    expect(screen.getByRole('status')).toHaveTextContent(/^lien copié$/)
    act(() => vi.advanceTimersByTime(1500))
    // Copied again, which says so for another moment.
    await act(async () => fireEvent.click(copyButton()))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByRole('status')).toHaveTextContent(/^lien copié$/)
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('gives the address to copy by hand, for good, when it cannot be copied, e.g. without a clipboard', async () => {
    withClipboard(undefined)
    await loadedPage()
    vi.useFakeTimers()

    await act(async () => fireEvent.click(copyButton()))
    expect(screen.getByRole('alert')).toHaveTextContent(`Le lien n'a pas pu être copié : ${address}`)
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('keeps saying that the address could not be copied once the events are loaded', async () => {
    withClipboard(undefined)
    mockFetch({ '/api/events': events })
    // The events are only answered once they're let through.
    let letThrough!: () => void
    const gate = new Promise<void>((resolve) => (letThrough = resolve))
    const answer = fetch
    vi.stubGlobal('fetch', async (...request: Parameters<typeof fetch>) => {
      await gate
      return answer(...request)
    })
    renderPage(configured(true))

    await act(async () => fireEvent.click(copyButton()))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Chargement…')).toBeInTheDocument()
    letThrough()
    expect(await screen.findByRole('heading', { name: 'GUEST MIXES' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(`Le lien n'a pas pu être copié : ${address}`)
  })
})
