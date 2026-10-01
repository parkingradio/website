import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

import { eventsRoutes } from './events.js'

const raEvent = {
  id: '2512073',
  title: 'PLEINE LUNE TAKEOVER',
  startTime: '2026-09-25T18:00:00.000',
  endTime: '2026-09-25T22:00:00.000',
  contentUrl: '/events/2512073',
  venue: { name: 'Parking.Radio', area: { name: 'Quebec City' } },
  lineup: '<artist id="100001">Nadia Quartz</artist>\u00a0\nDJ ORPHEA\n\nILAN &amp; PAPA V \n',
  artists: [{ name: 'Nadia Quartz' }],
  images: [
    { filename: 'https://images.ra.co/back.jpg', type: 'FLYERBACK' },
    { filename: 'https://images.ra.co/front.png', type: 'FLYERFRONT' },
  ],
}

const raResponse = {
  data: {
    promoter: {
      contentUrl: '/promoters/183980',
      upcoming: [raEvent],
      past: [{ ...raEvent, id: '1', contentUrl: '/events/1', venue: null, lineup: null, artists: [{ name: 'Tagged Only' }], images: [], endTime: null }],
    },
  },
}

const fetchMock = vi.fn()

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(eventsRoutes)
  return app
}

describe('GET /api/events', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ toFake: ['Date'] })
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("returns the promoter's upcoming and past events from Resident Advisor", async () => {
    fetchMock.mockResolvedValue(Response.json(raResponse))
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url: '/api/events' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      promoterUrl: 'https://ra.co/promoters/183980',
      upcoming: [
        {
          id: '2512073',
          title: 'PLEINE LUNE TAKEOVER',
          category: 'other',
          start: '2026-09-25T18:00',
          end: '2026-09-25T22:00',
          venue: 'Parking.Radio',
          city: 'Quebec City',
          lineup: ['Nadia Quartz', 'DJ ORPHEA', 'ILAN & PAPA V'],
          url: 'https://ra.co/events/2512073',
          flyer: 'https://images.ra.co/front.png',
        },
      ],
      past: [
        {
          id: '1',
          title: 'PLEINE LUNE TAKEOVER',
          category: 'other',
          start: '2026-09-25T18:00',
          end: null,
          venue: null,
          city: null,
          lineup: ['Tagged Only'],
          url: 'https://ra.co/events/1',
          flyer: null,
        },
      ],
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://ra.co/graphql')
    expect(JSON.parse(init.body).variables.id).toBe('183980')
  })

  it('asks RA for more upcoming events than the 10 it returns by default', async () => {
    fetchMock.mockResolvedValue(Response.json(raResponse))
    const app = await buildApp()

    await app.inject({ method: 'GET', url: '/api/events' })

    const [, init] = fetchMock.mock.calls[0]
    const { query, variables } = JSON.parse(init.body)
    expect(query).toContain('events(type: LATEST, limit: $upcomingLimit)')
    expect(variables.upcomingLimit).toBeGreaterThan(10)
  })

  it.each([
    ['SYNTH MEETUPS', 'synth-meetup'],
    ['Synth Meetup', 'synth-meetup'],
    ['SYNTH MEETUPS - parking.radio - 2026.07.29', 'synth-meetup'],
    ['GUEST MIXES', 'other'],
    ['WORKSHOP', 'other'],
    ['SYNTHWAVE MEETUP', 'other'],
  ])('categorizes an event titled "%s" as %s', async (title, category) => {
    const promoter = { ...raResponse.data.promoter, upcoming: [{ ...raEvent, title }] }
    fetchMock.mockResolvedValue(Response.json({ data: { promoter } }))
    const app = await buildApp()

    const { upcoming } = (await app.inject({ method: 'GET', url: '/api/events' })).json()

    expect(upcoming[0].category).toBe(category)
  })

  it("reads the lineup from the event's Line-up text, falling back to its tagged artists", async () => {
    fetchMock.mockResolvedValue(Response.json(raResponse))
    const app = await buildApp()

    const { upcoming, past } = (await app.inject({ method: 'GET', url: '/api/events' })).json()

    expect(upcoming[0].lineup).toEqual(['Nadia Quartz', 'DJ ORPHEA', 'ILAN & PAPA V'])
    expect(past[0].lineup).toEqual(['Tagged Only'])
  })

  it('decodes HTML entities in the Line-up text', async () => {
    const lineup = 'Andr&eacute;e\nL&#233;a &#x26; Zo&euml;\nDJ &lt;3\nR&amp;lt;B\nMoon&nbsp;Child&nbsp;\n'
    const promoter = { ...raResponse.data.promoter, upcoming: [{ ...raEvent, lineup }] }
    fetchMock.mockResolvedValue(Response.json({ data: { promoter } }))
    const app = await buildApp()

    const { upcoming } = (await app.inject({ method: 'GET', url: '/api/events' })).json()

    expect(upcoming[0].lineup).toEqual(['Andrée', 'Léa & Zoë', 'DJ <3', 'R&lt;B', 'Moon\u00a0Child'])
  })

  it('defaults the optional fields that RA leaves out', async () => {
    const promoter = {
      ...raResponse.data.promoter,
      upcoming: [{ ...raEvent, endTime: null, venue: null, images: null, artists: null, lineup: null }],
    }
    fetchMock.mockResolvedValue(Response.json({ data: { promoter } }))
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url: '/api/events' })

    expect(response.statusCode).toBe(200)
    expect(response.json().upcoming[0]).toMatchObject({ end: null, venue: null, city: null, flyer: null, lineup: [] })
  })

  it.each([
    ['RA responds with an error status', () => new Response('nope', { status: 500 })],
    ['RA responds with something other than JSON', () => new Response('<html>Just a moment...</html>')],
    ['RA responds with GraphQL errors', () => Response.json({ data: null, errors: [{ message: 'boom' }] })],
    [
      "the promoter isn't shaped as expected",
      () => Response.json({ data: { promoter: { ...raResponse.data.promoter, upcoming: null } } }),
    ],
    [
      'a single event is missing its start time',
      () =>
        Response.json({
          data: { promoter: { ...raResponse.data.promoter, upcoming: [raEvent, { ...raEvent, startTime: null }] } },
        }),
    ],
    [
      'RA returns as many upcoming events as were asked for',
      () =>
        Response.json({
          data: {
            promoter: {
              ...raResponse.data.promoter,
              upcoming: Array.from({ length: 100 }, (_, i) => ({ ...raEvent, id: String(i) })),
            },
          },
        }),
    ],
    [
      'a single event links outside of RA',
      () =>
        Response.json({
          data: { promoter: { ...raResponse.data.promoter, upcoming: [{ ...raEvent, contentUrl: 'https://example.com' }] } },
        }),
    ],
  ])('responds 502 when %s', async (_, raReply) => {
    fetchMock.mockImplementation(async () => raReply())
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url: '/api/events' })

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ ok: false, error: 'Events are unavailable right now' })
  })

  it('asks RA at most once every 2 minutes', async () => {
    fetchMock.mockImplementation(async () => Response.json(raResponse))
    const app = await buildApp()

    await app.inject({ method: 'GET', url: '/api/events' })
    vi.advanceTimersByTime(90 * 1000)
    await app.inject({ method: 'GET', url: '/api/events' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60 * 1000)
    await app.inject({ method: 'GET', url: '/api/events' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shares a fetch that is in flight between requests', async () => {
    fetchMock.mockImplementation(async () => Response.json(raResponse))
    const app = await buildApp()

    const responses = await Promise.all([1, 2, 3].map(() => app.inject({ method: 'GET', url: '/api/events' })))

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fall back on the last good answer when RA fails', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(raResponse))
    const app = await buildApp()
    await app.inject({ method: 'GET', url: '/api/events' })

    vi.advanceTimersByTime(3 * 60 * 1000)
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))
    const response = await app.inject({ method: 'GET', url: '/api/events' })

    expect(response.statusCode).toBe(502)
  })

  it('waits 2 minutes before asking RA again after a failure, then recovers', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/events' })).statusCode).toBe(502)

    fetchMock.mockResolvedValueOnce(Response.json(raResponse))
    vi.advanceTimersByTime(90 * 1000)
    expect((await app.inject({ method: 'GET', url: '/api/events' })).statusCode).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60 * 1000)
    expect((await app.inject({ method: 'GET', url: '/api/events' })).statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
