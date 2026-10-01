import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventListing, EventsResponse } from 'shared/events'
import { SynthMeetups } from './synth-meetups'

function event(id: string, category: EventListing['category'], start: string): EventListing {
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

const events: EventsResponse = {
  promoterUrl: 'https://ra.co/promoters/183980',
  upcoming: [
    event('later', 'synth-meetup', '2026-11-11T18:00'),
    event('mixes', 'other', '2026-10-09T11:00'),
    event('soon', 'synth-meetup', '2026-10-07T18:00'),
  ],
  past: [event('past', 'synth-meetup', '2026-09-23T18:00')],
}

const fetchMock = vi.fn()

describe('SynthMeetups', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(Response.json(events))
    vi.stubGlobal('fetch', fetchMock)
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
    expect(screen.getAllByRole('button')).toHaveLength(8)
  })

  it('expands a poster into a lightbox on click, and closes it on a second click', () => {
    render(<SynthMeetups />)
    expect(screen.getAllByRole('img')).toHaveLength(9) // banner + 8 thumbnails

    fireEvent.click(screen.getAllByRole('button')[0])
    const lightboxImage = screen.getAllByRole('img').at(-1)
    expect(lightboxImage).toBeVisible()
    expect(screen.getAllByRole('img')).toHaveLength(10) // + the lightbox image

    fireEvent.click(lightboxImage!)
    expect(screen.getAllByRole('img')).toHaveLength(9) // back to banner + 8 thumbnails
  })

  it('lists the upcoming synth meetups from the server, soonest first, linking to RA', async () => {
    render(<SynthMeetups />)

    const links = await screen.findAllByRole('link', { name: /^mercredi/ })
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['mercredi 7 octobre 2026', 'https://ra.co/events/soon'],
      ['mercredi 11 novembre 2026', 'https://ra.co/events/later'],
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/events')
  })

  it('says so when no synth meetup is coming up', async () => {
    fetchMock.mockResolvedValue(Response.json({ ...events, upcoming: [event('mixes', 'other', '2026-10-09T11:00')] }))
    render(<SynthMeetups />)

    expect(await screen.findByText(/aucune date annoncée/)).toBeInTheDocument()
  })

  it('points to Resident Advisor when the dates cannot be loaded', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }))
    render(<SynthMeetups />)

    expect(await screen.findByRole('link', { name: /Resident Advisor/ })).toHaveAttribute(
      'href',
      'https://ra.co/promoters/183980',
    )
  })
})
