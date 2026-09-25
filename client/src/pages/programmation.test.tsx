import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Programmation, ProgrammationList } from './programmation'
import type { EventsResponse } from 'shared/events'

const data: EventsResponse = {
  promoterUrl: 'https://ra.co/promoters/183980',
  upcoming: [
    {
      id: 'later',
      title: 'Later Party',
      start: '2026-11-07T21:00',
      end: null,
      venue: 'Venue B',
      city: 'Québec',
      lineup: [],
      url: 'https://ra.co/events/2',
      flyer: null,
    },
    {
      id: 'soon',
      title: 'Soon Party',
      start: '2026-10-03T22:00',
      end: '2026-10-04T03:00',
      venue: 'Venue A',
      city: 'Montréal',
      lineup: ['Artist A', 'Artist B'],
      url: 'https://ra.co/events/1',
      flyer: 'https://images.ra.co/soon.png',
    },
  ],
  past: [
    {
      id: 'older',
      title: 'Older Party',
      start: '2026-08-16T19:00',
      end: null,
      venue: null,
      city: null,
      lineup: [],
      url: 'https://ra.co/events/3',
      flyer: null,
    },
    {
      id: 'recent',
      title: 'Recent Party',
      start: '2026-09-05T22:00',
      end: null,
      venue: 'Venue A',
      city: 'Montréal',
      lineup: [],
      url: 'https://ra.co/events/4',
      flyer: null,
    },
  ],
}

const eventTitles = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

describe('Programmation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the events from the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(data))
    vi.stubGlobal('fetch', fetchMock)
    render(<Programmation />)

    expect(await screen.findByRole('heading', { name: 'Soon Party' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/events')
  })

  it('points to Resident Advisor when the events cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })))
    render(<Programmation />)

    expect(await screen.findByRole('link', { name: /Resident Advisor/ })).toHaveAttribute(
      'href',
      'https://ra.co/promoters/183980',
    )
  })
})

describe('ProgrammationList', () => {
  it('lists upcoming events soonest first, grouped by month', () => {
    render(<ProgrammationList data={data} />)
    expect(eventTitles()).toEqual(['Soon Party', 'Later Party'])
    const months = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(months).toEqual(['octobre 2026', 'novembre 2026'])
  })

  it('shows the venue, city, times and lineup of each event', () => {
    render(<ProgrammationList data={data} />)
    const row = screen.getByRole('heading', { name: 'Soon Party' }).closest('li')!
    expect(row).toHaveTextContent('Venue A · Montréal · 22 h 00 – 03 h 00')
    expect(within(row).getByText('Artist A / Artist B')).toBeInTheDocument()
  })

  it('links each event to its Resident Advisor page', () => {
    render(<ProgrammationList data={data} />)
    const row = screen.getByRole('heading', { name: 'Soon Party' }).closest('li')!
    for (const link of within(row).getAllByRole('link')) {
      expect(link).toHaveAttribute('href', 'https://ra.co/events/1')
    }
  })

  it("links to the promoter's Resident Advisor page", () => {
    render(<ProgrammationList data={data} />)
    expect(screen.getByRole('link', { name: /parking.radio sur Resident Advisor/ })).toHaveAttribute(
      'href',
      'https://ra.co/promoters/183980',
    )
  })

  it('shows past events, most recent first, when switching to "passés"', () => {
    render(<ProgrammationList data={data} />)
    fireEvent.click(screen.getByRole('button', { name: 'passés' }))
    expect(screen.getByRole('button', { name: 'passés' })).toHaveAttribute('aria-pressed', 'true')
    expect(eventTitles()).toEqual(['Recent Party', 'Older Party'])
  })

  it("shows a square thumbnail of each event's flyer, linking to the event on RA", () => {
    const { container } = render(<ProgrammationList data={data} />)
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
    render(<ProgrammationList data={{ ...data, upcoming: [event] }} />)
    const row = screen.getByRole('listitem')
    expect(within(row).getByRole('heading')).toHaveTextContent('GUEST MIXES - parking.radio')
    expect(row).toHaveTextContent('parking.radio · Québec')
    expect(row).toHaveTextContent('parking.radio crew')
    expect(row.textContent).not.toMatch(/Parking\.Radio|PARKING\.RADIO|Parking\.radio/)
  })

  it('says so when nothing is coming up', () => {
    render(<ProgrammationList data={{ ...data, upcoming: [] }} />)
    expect(screen.getByText(/Rien de prévu/)).toBeInTheDocument()
  })
})
