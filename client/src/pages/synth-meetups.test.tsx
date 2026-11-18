import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schema } from '../api/client'
import { ConfigContext } from '../config-context'
import type { ConfigState } from '../config-context'
import { configWith, mockFetch, requestsTo } from '../test-utils'
import { SynthMeetups } from './synth-meetups'

function event(id: string, category: Schema<'RaEvent'>['category'], start: string): Schema<'RaEvent'> {
  return {
    id,
    title: 'Event',
    category,
    start,
    end: null,
    venue: 'Parking.Radio',
    city: 'Québec',
    lineup: [],
    url: `https://ra.co/events/${id}`,
    flyer: null,
  }
}

// The events as the server gives them: the upcoming ones the soonest first.
const events: Schema<'RaEvents'> = {
  promoterUrl: 'https://ra.co/promoters/183980',
  upcoming: [
    event('soon', 'synth-meetup', '2026-10-07T18:00:00-04:00'),
    event('mixes', 'other', '2026-10-09T11:00:00-04:00'),
    event('later', 'synth-meetup', '2026-11-11T18:00:00-05:00'),
  ],
  past: [event('past', 'synth-meetup', '2026-09-23T18:00:00-04:00')],
}

// A public event, which is a synth meetup unless it's given another type, without an event on RA unless it's given one.
function publicEvent(id: string, start: string, fields: Partial<Schema<'Event'>> = {}): Schema<'Event'> {
  const end = new Date(new Date(start).getTime() + 3 * 60 * 60 * 1000).toISOString()
  return { id, title: 'SYNTH MEETUPS', type: 'synth-meetup', takeover: null, start, end, cancelled: false, description: '', flyer: null, raEvent: null, sets: [], ...fields }
}

// The public events as the server gives them: the upcoming ones the soonest first.
const publicEvents: Schema<'Events'> = {
  ok: true,
  upcoming: [
    publicEvent('soon', '2026-10-07T18:00:00-04:00', { raEvent: 'https://ra.co/events/2201001' }),
    publicEvent('mixes', '2026-10-09T21:00:00-04:00', { title: 'GUEST MIXES', type: 'guest-mixes', raEvent: 'https://ra.co/events/2201002' }),
    publicEvent('later', '2026-10-21T18:00:00-04:00'),
    publicEvent('cancelled', '2026-11-25T18:00:00-05:00', { cancelled: true, raEvent: 'https://ra.co/events/2201003' }),
  ],
  past: [publicEvent('past', '2026-09-23T18:00:00-04:00')],
}

// The configuration, with the `evenements-publics` flag off unless it's on.
const configured = (on = false) => configWith({ 'evenements-publics': on })

function renderPage(config: ConfigState = configured()) {
  return render(
    <ConfigContext value={config}>
      <SynthMeetups />
    </ConfigContext>,
  )
}

// The upcoming dates, as their items read.
const dates = () => within(screen.getByRole('heading', { name: 'dates à venir' }).nextElementSibling as HTMLElement).getAllByRole('listitem')

describe('SynthMeetups', () => {
  beforeEach(() => {
    mockFetch({ '/api/ra-events': events, '/api/events': publicEvents })
  })

  it('renders without crashing', () => {
    const { container } = renderPage()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('renders the banner and one thumbnail button per poster', () => {
    renderPage()
    expect(screen.getByAltText('Synth Meetups')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(10)
  })

  it('expands a poster into a lightbox on click, and closes it on a second click', () => {
    renderPage()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /23 septembre 2026/ }))
    const lightbox = screen.getByRole('dialog', { name: 'Affiche du synth meetup du 23 septembre 2026' })
    const image = within(lightbox).getByRole('img', { name: 'Affiche du synth meetup du 23 septembre 2026' })
    expect(image).toBeVisible()

    fireEvent.click(image)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lightbox).toBeEmptyDOMElement()
  })

  it('closes the lightbox when the browser closes it, e.g. on Escape', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /23 septembre 2026/ }))
    const lightbox = screen.getByRole('dialog')

    act(() => (lightbox as HTMLDialogElement).close())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lightbox).toBeEmptyDOMElement()
  })

  it('lists the upcoming synth meetups in the order the server gives, the soonest first, linking to RA', async () => {
    renderPage()

    const links = await screen.findAllByRole('link', { name: /^mercredi/ })
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['mercredi 7 octobre 2026', 'https://ra.co/events/soon'],
      ['mercredi 11 novembre 2026', 'https://ra.co/events/later'],
    ])
    expect(requestsTo('GET', '/api/ra-events')).toHaveLength(1)
  })

  it("gives the days of the synth meetups in Québec time, whatever the browser's time zone", async () => {
    // Loaded again in Tokyo's time zone, since formatters keep the one they're created in, where 18:00 on Wednesday,
    // October 7 in Québec is already Thursday.
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    try {
      const { SynthMeetups: TokyoMeetups } = await import('./synth-meetups')
      const { ConfigContext: TokyoContext } = await import('../config-context')
      render(
        <TokyoContext value={configured()}>
          <TokyoMeetups />
        </TokyoContext>,
      )

      const links = await screen.findAllByRole('link', { name: /^mercredi/ })
      expect(links.map((link) => link.textContent)).toEqual(['mercredi 7 octobre 2026', 'mercredi 11 novembre 2026'])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('says so when no synth meetup is coming up', async () => {
    mockFetch({ '/api/ra-events': { ...events, upcoming: [event('mixes', 'other', '2026-10-09T11:00:00-04:00')] } })
    renderPage()

    expect(await screen.findByText(/aucune date annoncée/)).toBeInTheDocument()
  })

  it('points to Resident Advisor when the dates cannot be loaded', async () => {
    mockFetch({ '/api/ra-events': { ok: false, error: 'Events are unavailable right now' } })
    renderPage()

    expect(await screen.findByRole('link', { name: /Resident Advisor/ })).toHaveAttribute(
      'href',
      'https://ra.co/promoters/183980',
    )
  })

  it('asks for no events until it knows whether the flag is on, and says that the dates are loading', async () => {
    renderPage({ kind: 'loading' })

    expect(screen.getByText('chargement…')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requestsTo('GET', '/api/ra-events')).toHaveLength(0)
    expect(requestsTo('GET', '/api/events')).toHaveLength(0)
  })

  it("lists the synth meetups from RA when the configuration couldn't be fetched, as if the flag were off", async () => {
    renderPage({ kind: 'failed' })

    expect(await screen.findAllByRole('link', { name: /^mercredi/ })).toHaveLength(2)
    expect(requestsTo('GET', '/api/events')).toHaveLength(0)
  })

  describe('once the flag is on', () => {
    it('lists the upcoming public synth meetups in the order the server gives, linking those with an event on RA to it, and never asks RA', async () => {
      renderPage(configured(true))

      await screen.findAllByRole('link', { name: /^mercredi/ })
      expect(dates().map((item) => [item.textContent, item.querySelector('a')?.getAttribute('href') ?? null])).toEqual([
        ['mercredi 7 octobre 2026', 'https://ra.co/events/2201001'],
        ['mercredi 21 octobre 2026', null],
        ['[CANCELLED] mercredi 25 novembre 2026', 'https://ra.co/events/2201003'],
      ])
      expect(requestsTo('GET', '/api/events')).toHaveLength(1)
      expect(requestsTo('GET', '/api/ra-events')).toHaveLength(0)
    })

    it('says so when no synth meetup is coming up', async () => {
      mockFetch({ '/api/events': { ...publicEvents, upcoming: [publicEvents.upcoming[1]] } })
      renderPage(configured(true))

      expect(await screen.findByText(/aucune date annoncée/)).toBeInTheDocument()
    })

    it('points to Resident Advisor when the dates cannot be loaded', async () => {
      mockFetch({ '/api/events': { ok: false, error: 'Something went wrong' } })
      renderPage(configured(true))

      expect(await screen.findByRole('link', { name: /Resident Advisor/ })).toHaveAttribute('href', 'https://ra.co/promoters/183980')
    })
  })
})
