import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { eventsRoutes } from './routes.js'

const raEvent = {
  id: '2512073',
  title: 'PLEINE LUNE TAKEOVER',
  startTime: '2026-09-25T18:00:00.000',
  endTime: '2026-09-25T22:00:00.000',
  contentUrl: '/events/2512073',
  venue: { name: 'Parking.Radio', area: { name: 'Quebec City', ianaTimeZone: 'America/Toronto' } },
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
  useZodSchemas(app)
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
          start: '2026-09-25T18:00:00-04:00',
          end: '2026-09-25T22:00:00-04:00',
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
          start: '2026-09-25T18:00:00-04:00',
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

  it('asks RA for more events than the 10 upcoming and 50 past ones it returns by default', async () => {
    fetchMock.mockResolvedValue(Response.json(raResponse))
    const app = await buildApp()

    await app.inject({ method: 'GET', url: '/api/events' })

    const [, init] = fetchMock.mock.calls[0]
    const { query, variables } = JSON.parse(init.body)
    expect(query).toContain('events(type: LATEST, limit: $upcomingLimit)')
    expect(query).toContain('events(type: PREVIOUS, limit: $pastLimit)')
    expect(variables.upcomingLimit).toBeGreaterThan(10)
    expect(variables.pastLimit).toBeGreaterThan(1000)
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

  it('falls back to the tagged artists when the Line-up text has nothing but blank lines and tags', async () => {
    const blank = { ...raEvent, lineup: '<artist id="1"></artist>\u00a0\n \n', artists: [{ name: 'Tagged Only' }] }
    const promoter = { ...raResponse.data.promoter, upcoming: [blank] }
    fetchMock.mockResolvedValue(Response.json({ data: { promoter } }))
    const app = await buildApp()

    const { upcoming } = (await app.inject({ method: 'GET', url: '/api/events' })).json()

    expect(upcoming[0].lineup).toEqual(['Tagged Only'])
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

  it('passes on whatever RA answers that it accepts', async () => {
    const quirky = {
      ...raEvent,
      id: '',
      title: '',
      startTime: '2026-09-25T18:00',
      endTime: '2026-09-26T02:30:59.999',
      contentUrl: '/',
      venue: { name: '', area: null },
      lineup: '<artist id="1"></artist>\n \n',
      artists: [],
      images: [{ filename: '', type: 'FLYERFRONT' }],
    }
    // Fields that are undefined are left out of the JSON.
    const sparse = { ...raEvent, endTime: undefined, venue: undefined, lineup: undefined, artists: null, images: null }
    const promoter = { ...raResponse.data.promoter, upcoming: [quirky], past: [sparse] }
    fetchMock.mockResolvedValue(Response.json({ data: { promoter } }))
    const app = await buildApp()

    const response = await app.inject({ method: 'GET', url: '/api/events' })

    expect(response.statusCode).toBe(200)
    expect(response.json().upcoming).toEqual([
      {
        id: '',
        title: '',
        category: 'other',
        start: '2026-09-25T18:00:00-04:00',
        end: '2026-09-26T02:30:00-04:00',
        venue: '',
        city: null,
        lineup: [],
        url: 'https://ra.co/',
        flyer: '',
      },
    ])
    expect(response.json().past).toEqual([
      expect.objectContaining({ start: '2026-09-25T18:00:00-04:00', end: null, venue: null, city: null, lineup: [], flyer: null }),
    ])
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
      'RA returns as many past events as were asked for',
      () =>
        Response.json({
          data: {
            promoter: {
              ...raResponse.data.promoter,
              past: Array.from({ length: 2000 }, (_, i) => ({ ...raEvent, id: String(i) })),
            },
          },
        }),
    ],
    [
      "a single event's start time isn't a local time",
      () =>
        Response.json({
          data: { promoter: { ...raResponse.data.promoter, upcoming: [{ ...raEvent, startTime: '2026-09-25 18:00:00' }] } },
        }),
    ],
    [
      "a single event starts on a day that doesn't exist",
      () =>
        Response.json({
          data: { promoter: { ...raResponse.data.promoter, upcoming: [{ ...raEvent, startTime: '2026-02-30T18:00:00.000' }] } },
        }),
    ],
    [
      "a single event starts in a month that doesn't exist",
      () =>
        Response.json({
          data: { promoter: { ...raResponse.data.promoter, upcoming: [{ ...raEvent, startTime: '2026-13-01T18:00:00.000' }] } },
        }),
    ],
    [
      "a single event ends at a time that doesn't exist",
      () =>
        Response.json({
          data: { promoter: { ...raResponse.data.promoter, past: [{ ...raEvent, endTime: '2026-09-25T24:30:00.000' }] } },
        }),
    ],
    [
      "a single event's end time isn't a local time",
      () =>
        Response.json({
          data: { promoter: { ...raResponse.data.promoter, past: [{ ...raEvent, endTime: '2026-9-25T22:00' }] } },
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

  // RA answering with these events, each given as its id, its local start, and maybe its venue's time zone.
  type Spec = [id: string, startTime: string, zone?: string | null]
  function answer(upcoming: Spec[], past: Spec[] = []) {
    const toRa = ([id, startTime, zone = 'America/Toronto']: Spec) => ({
      ...raEvent,
      id,
      startTime,
      endTime: null,
      contentUrl: `/events/${id}`,
      venue: { name: 'Somewhere', area: { name: 'Somewhere', ianaTimeZone: zone } },
    })
    fetchMock.mockImplementation(async () => Response.json({ data: { promoter: { ...raResponse.data.promoter, upcoming: upcoming.map(toRa), past: past.map(toRa) } } }))
  }

  async function get(url: string) {
    const app = await buildApp()
    return app.inject({ method: 'GET', url })
  }

  const ids = (events: { id: string }[]) => events.map((event) => event.id)

  it.each([
    ['in Québec', 'America/Toronto', '2026-09-25T18:00', '2026-09-25T18:00:00-04:00'],
    ['in another time zone', 'Europe/Paris', '2026-09-25T18:00', '2026-09-25T12:00:00-04:00'],
    ['with an offset that isn\'t whole hours', 'Asia/Kolkata', '2026-09-25T18:00', '2026-09-25T08:30:00-04:00'],
    ['without a time zone', null, '2026-09-25T18:00', '2026-09-25T18:00:00-04:00'],
    ['in a time zone Intl doesn\'t know', 'Mars/Olympus_Mons', '2026-09-25T18:00', '2026-09-25T18:00:00-04:00'],
    ['at a time the clocks show twice in its time zone', 'Europe/Paris', '2026-10-25T02:30', '2026-10-24T20:30:00-04:00'],
    ['at a time the clocks skip in its time zone', 'Europe/Paris', '2027-03-28T02:30', '2027-03-27T21:30:00-04:00'],
  ])("gives the start of an event %s as an instant in Québec time, read in its venue's time zone", async (_, zone, local, start) => {
    answer([['1', local, zone]])

    const response = await get('/api/events')

    expect(response.json().upcoming[0].start).toBe(start)
  })

  it("reads the end, and the times of an event without a venue or an area, in Québec's time zone unless the venue says otherwise", async () => {
    const promoter = {
      ...raResponse.data.promoter,
      upcoming: [
        { ...raEvent, id: 'paris', startTime: '2026-10-24T22:00', endTime: '2026-10-25T05:00', venue: { name: 'Club', area: { name: 'Paris', ianaTimeZone: 'Europe/Paris' } } },
        { ...raEvent, id: 'no-venue', venue: null },
        { ...raEvent, id: 'no-area', venue: { name: 'Club', area: null } },
      ],
    }
    fetchMock.mockResolvedValue(Response.json({ data: { promoter } }))

    const { upcoming } = (await get('/api/events')).json()

    // The clocks go back during the night in Paris.
    expect(upcoming.find((event: { id: string }) => event.id === 'paris')).toMatchObject({ start: '2026-10-24T16:00:00-04:00', end: '2026-10-25T00:00:00-04:00' })
    for (const id of ['no-venue', 'no-area']) {
      expect(upcoming.find((event: { id: string }) => event.id === id)).toMatchObject({ start: '2026-09-25T18:00:00-04:00', end: '2026-09-25T22:00:00-04:00' })
    }
  })

  it('lists the upcoming events the soonest first, and the past ones the most recent first, by when they start', async () => {
    // 20:00 in Québec is later than 00:30 the next day in Paris.
    answer(
      [['quebec', '2026-11-20T20:00'], ['paris', '2026-11-21T00:30', 'Europe/Paris'], ['later', '2026-12-01T20:00']],
      [['old', '2026-03-29T15:00'], ['recent', '2026-10-31T18:00'], ['middle', '2026-07-01T00:30', 'Europe/Paris'], ['middle-quebec', '2026-06-30T20:00']],
    )

    const { upcoming, past } = (await get('/api/events')).json()

    expect(ids(upcoming)).toEqual(['paris', 'quebec', 'later'])
    expect(ids(past)).toEqual(['recent', 'middle-quebec', 'middle', 'old'])
  })

  const pastDays: Spec[] = Array.from({ length: 25 }, (_, i) => [`past-${i + 1}`, `2026-08-${String(i + 1).padStart(2, '0')}T18:00`])

  it('only gives the 20 most recent past events, without a time range', async () => {
    answer([['upcoming', '2026-11-14T21:00']], pastDays.toReversed())

    const { upcoming, past } = (await get('/api/events')).json()

    expect(ids(upcoming)).toEqual(['upcoming'])
    expect(ids(past)).toEqual(pastDays.slice(5).map(([id]) => id).toReversed())
  })

  it('never lists an event both as upcoming and past', async () => {
    answer([['both', '2026-11-14T21:00']], [['both', '2026-11-14T21:00'], ['past', '2026-08-01T18:00']])

    const { upcoming, past } = (await get('/api/events')).json()

    expect(ids(upcoming)).toEqual(['both'])
    expect(ids(past)).toEqual(['past'])
  })

  it.each([
    ['from and to, with from included and to excluded', '?from=2026-08-02T18:00-04:00&to=2026-08-04T18:00-04:00', [], ['past-3', 'past-2']],
    ['from alone, from then on', '?from=2026-08-24T18:00-04:00', ['upcoming-1', 'upcoming-2'], ['past-25', 'past-24']],
    ['to alone, beyond the 20 most recent past events', '?to=2026-08-03T00:00-04:00', [], ['past-2', 'past-1']],
    ['a range of upcoming events only', '?from=2026-11-14T21:00-05:00&to=2026-11-21T21:00-05:00', ['upcoming-1'], []],
    ['a range of both', '?from=2026-08-25T00:00-04:00&to=2026-11-15T00:00-05:00', ['upcoming-1'], ['past-25']],
    ['a range without any', '?from=2026-09-01T00:00-04:00&to=2026-10-01T00:00-04:00', [], []],
  ])('gives the events that start in a time range: %s', async (_, query, upcoming, past) => {
    answer([['upcoming-1', '2026-11-14T21:00'], ['upcoming-2', '2026-11-21T21:00']], pastDays.toReversed())

    const response = await get(`/api/events${query}`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ promoterUrl: 'https://ra.co/promoters/183980' })
    expect(ids(response.json().upcoming)).toEqual(upcoming)
    expect(ids(response.json().past)).toEqual(past)
  })

  it("compares the time range with the instants events start at, read in their venue's time zone", async () => {
    answer([], [['paris', '2026-08-10T02:00', 'Europe/Paris'], ['quebec', '2026-08-10T02:00']])

    const response = await get('/api/events?from=2026-08-09T20:00-04:00&to=2026-08-09T20:01-04:00')

    expect(ids(response.json().past)).toEqual(['paris'])
  })

  const BAD_BOUND = (name: string) => new RegExp(`^\`${name}\` must be a single date and time in Québec time, with the offset from UTC in effect then \\(.*\\), except a time the clocks skip in spring, e.g. ".*", from the year 2000 to 2999$`)

  it.each([
    ['from is UTC', '?from=2026-11-14T21:00Z', BAD_BOUND('from')],
    ["to doesn't have Québec's offset then", '?to=2026-11-14T21:00-04:00', BAD_BOUND('to')],
    ['from is empty', '?from=', BAD_BOUND('from')],
    ['from is given twice', '?from=2026-11-14T21:00-05:00&from=2026-11-15T21:00-05:00', BAD_BOUND('from')],
    ['from is a time the clocks skip', '?from=2027-03-14T02:30-05:00', BAD_BOUND('from')],
    ['from is before the year 2000', '?from=1999-12-31T00:00-05:00', BAD_BOUND('from')],
    ['to is a day without a time', '?to=2026-11-14', BAD_BOUND('to')],
    ['from is to', '?from=2026-11-14T21:00-05:00&to=2026-11-14T21:00-05:00', /^`from` must be before `to`$/],
    ['from is after to', '?from=2026-11-15T21:00-05:00&to=2026-11-14T21:00-05:00', /^`from` must be before `to`$/],
  ])('responds 400 without asking RA when %s', async (_, query, error) => {
    answer([])

    const response = await get(`/api/events${query}`)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: expect.stringMatching(error) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('responds 502 with a time range too when the events can\'t be read from RA', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))

    const response = await get('/api/events?from=2026-08-01T00:00-04:00')

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ ok: false, error: 'Events are unavailable right now' })
  })

  it('asks RA once for every time range, and without one', async () => {
    answer([['upcoming', '2026-11-14T21:00']], pastDays)
    const app = await buildApp()

    for (const query of ['', '?from=2026-08-01T00:00-04:00', '?to=2026-08-10T00:00-04:00', '?from=2026-08-05T00:00-04:00&to=2026-12-01T00:00-05:00']) {
      expect((await app.inject({ method: 'GET', url: `/api/events${query}` })).statusCode).toBe(200)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
