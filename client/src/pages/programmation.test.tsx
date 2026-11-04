import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Schema } from '../api/client'
import { mockFetch, requestsTo } from '../test-utils'
import { Programmation, ProgrammationList } from './programmation'

// The events as the server gives them: the upcoming ones the soonest first, and the past ones the most recent first.
const data: Schema<'Events'> = {
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

const eventTitles = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

describe('Programmation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the events from the server', async () => {
    mockFetch({ '/api/events': data })
    render(<Programmation />)

    expect(await screen.findByRole('heading', { name: 'Soon Party' })).toBeInTheDocument()
    expect(requestsTo('GET', '/api/events')).toHaveLength(1)
  })

  it('points to Resident Advisor when the events cannot be loaded', async () => {
    mockFetch({ '/api/events': { ok: false, error: 'Events are unavailable right now' } })
    render(<Programmation />)

    expect(await screen.findByRole('link', { name: /Resident Advisor/ })).toHaveAttribute(
      'href',
      'https://ra.co/promoters/183980',
    )
  })
})

describe('ProgrammationList', () => {
  it('lists upcoming events in the order the server gives, the soonest first, grouped by month', () => {
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

  it('shows past events, in the order the server gives, the most recent first, when switching to "passés"', () => {
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

  it("shows days and times in Québec time, whatever the browser's time zone", async () => {
    // Loaded again in Tokyo's time zone, since formatters keep the one they're created in, where 22:00 on October 31 in
    // Québec is already 11:00 on November 1.
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    try {
      const { ProgrammationList: TokyoList } = await import('./programmation')
      const halloween = { ...data.upcoming[0], id: 'halloween', title: 'Halloween', start: '2026-10-31T22:00:00-04:00', end: '2026-11-01T02:00:00-05:00' }
      render(<TokyoList data={{ ...data, upcoming: [halloween] }} />)

      expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['octobre 2026'])
      const row = screen.getByRole('heading', { name: 'Halloween' }).closest('li')!
      expect(row.querySelector('.event-date')).toHaveTextContent('sam31oct')
      expect(row).toHaveTextContent('22 h 00 – 02 h 00')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('says so when nothing is coming up', () => {
    render(<ProgrammationList data={{ ...data, upcoming: [] }} />)
    expect(screen.getByText(/Rien de prévu/)).toBeInTheDocument()
  })
})
