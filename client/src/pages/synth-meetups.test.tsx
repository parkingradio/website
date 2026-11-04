import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schema } from '../api/client'
import { mockFetch, requestsTo } from '../test-utils'
import { SynthMeetups } from './synth-meetups'

function event(id: string, category: Schema<'Event'>['category'], start: string): Schema<'Event'> {
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
const events: Schema<'Events'> = {
  promoterUrl: 'https://ra.co/promoters/183980',
  upcoming: [
    event('soon', 'synth-meetup', '2026-10-07T18:00:00-04:00'),
    event('mixes', 'other', '2026-10-09T11:00:00-04:00'),
    event('later', 'synth-meetup', '2026-11-11T18:00:00-05:00'),
  ],
  past: [event('past', 'synth-meetup', '2026-09-23T18:00:00-04:00')],
}

describe('SynthMeetups', () => {
  beforeEach(() => {
    mockFetch({ '/api/events': events })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders without crashing', () => {
    const { container } = render(<SynthMeetups />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('renders the banner and one thumbnail button per poster', () => {
    render(<SynthMeetups />)
    expect(screen.getByAltText('Synth Meetups')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(9)
  })

  it('expands a poster into a lightbox on click, and closes it on a second click', () => {
    render(<SynthMeetups />)
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
    render(<SynthMeetups />)
    fireEvent.click(screen.getByRole('button', { name: /23 septembre 2026/ }))
    const lightbox = screen.getByRole('dialog')

    act(() => (lightbox as HTMLDialogElement).close())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(lightbox).toBeEmptyDOMElement()
  })

  it('lists the upcoming synth meetups in the order the server gives, the soonest first, linking to RA', async () => {
    render(<SynthMeetups />)

    const links = await screen.findAllByRole('link', { name: /^mercredi/ })
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['mercredi 7 octobre 2026', 'https://ra.co/events/soon'],
      ['mercredi 11 novembre 2026', 'https://ra.co/events/later'],
    ])
    expect(requestsTo('GET', '/api/events')).toHaveLength(1)
  })

  it("gives the days of the synth meetups in Québec time, whatever the browser's time zone", async () => {
    // Loaded again in Tokyo's time zone, since formatters keep the one they're created in, where 18:00 on Wednesday,
    // October 7 in Québec is already Thursday.
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    try {
      const { SynthMeetups: TokyoMeetups } = await import('./synth-meetups')
      render(<TokyoMeetups />)

      const links = await screen.findAllByRole('link', { name: /^mercredi/ })
      expect(links.map((link) => link.textContent)).toEqual(['mercredi 7 octobre 2026', 'mercredi 11 novembre 2026'])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('says so when no synth meetup is coming up', async () => {
    mockFetch({ '/api/events': { ...events, upcoming: [event('mixes', 'other', '2026-10-09T11:00:00-04:00')] } })
    render(<SynthMeetups />)

    expect(await screen.findByText(/aucune date annoncée/)).toBeInTheDocument()
  })

  it('points to Resident Advisor when the dates cannot be loaded', async () => {
    mockFetch({ '/api/events': { ok: false, error: 'Events are unavailable right now' } })
    render(<SynthMeetups />)

    expect(await screen.findByRole('link', { name: /Resident Advisor/ })).toHaveAttribute(
      'href',
      'https://ra.co/promoters/183980',
    )
  })
})
