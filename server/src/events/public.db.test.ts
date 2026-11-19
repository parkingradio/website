import { Readable } from 'node:stream'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { artistsRoutes } from '../artists/routes.js'
import { artistsStore } from '../artists/store.js'
import type { Photos } from '../artists/store.js'
import { collectivesRoutes } from '../collectives/routes.js'
import { collectivesStore } from '../collectives/store.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { DEFAULT_DESCRIPTIONS } from '../sessions/descriptions.js'
import { sessionsRoutes } from '../sessions/routes.js'
import { sessionsStore } from '../sessions/store.js'
import { calendarRoutes } from './calendar.js'
import { eventsRoutes } from './routes.js'
import { eventsStore } from './store.js'
import type { EventsStore } from './store.js'

// What's public, against a real database: the events, which are the announced sessions, and the artists and collectives
// they make public, with their photos and flyers (see docs/design/server/events.md, and "Public profiles" in artists.md
// and collectives.md). Sessions, artists and collectives are added and changed through the admin routes, and the public
// ones are asked without a session.

// The photos and flyers, as the bucket would keep them, by key.
const stored = new Map<string, Buffer>()
let nextPhoto = 0
const photos: Photos = {
  store: async ({ body }, folder) => {
    const key = `${folder}/photo-${++nextPhoto}`
    stored.set(key, body)
    return key
  },
  read: async (key) => (stored.has(key) ? Readable.from([stored.get(key)!]) : null),
  delete: async (key) => {
    stored.delete(key)
  },
}

// The smallest thing that starts like a JPEG image.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const NOBODY = '00000000-0000-4000-8000-000000000000'

let database: TestDatabase
let app: FastifyInstance
let events: EventsStore

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  database = await testDatabase()
  app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  // Each link is its own track.
  const resolveTrack = async (link: string) => `track:${link}`
  await app.register(sessionsRoutes, { store: sessionsStore(database.db), photos, resolveTrack })
  await app.register(artistsRoutes, { store: artistsStore(database.db), photos })
  await app.register(collectivesRoutes, { store: collectivesStore(database.db), photos })
  events = eventsStore(database.db)
  await app.register(eventsRoutes, { store: events, photos })
  await app.register(calendarRoutes, { store: events, siteOrigin: 'https://parking.radio' })
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions, artists, collectives cascade`)
  stored.clear()
})

// An admin's request, which has to succeed, with a JSON body.
async function admin(method: 'PUT' | 'PATCH', url: string, payload: object) {
  const response = await app.inject({ method, url, payload, cookies: await sessionCookies() })
  expect(response.statusCode, response.body).toBe(200)
  return response.json()
}

// An admin's request that adds something, which has to succeed, as multipart/form-data, with these parts.
async function adminForm(url: string, parts: Parameters<typeof multipartBody>[0]) {
  const response = await app.inject({ method: 'POST', url, ...multipartBody(parts), cookies: await sessionCookies() })
  expect(response.statusCode, response.body).toBe(200)
  return response.json()
}

// A public request, without a session.
function get(url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url, headers })
}

const artistStatus = async (id: string) => (await get(`/api/artists/${id}`)).statusCode
const collectiveStatus = async (id: string) => (await get(`/api/collectives/${id}`)).statusCode

const emailOf = (name: string) => `${name.toLowerCase().replace(/[^a-z]/g, '')}@example.com`

const PROFILE = { country: 'CA', city: 'Québec', genres: ['techno', 'house'], bio: 'Une bio', links: { soundcloud: 'someone' }, phone: '418 555 0100' }

async function createArtist(name: string, photo?: Buffer): Promise<string> {
  const artist = JSON.stringify({ name, ...PROFILE, email: emailOf(name) })
  return (await adminForm('/api/admin/artists', { artist, photo })).artist.id
}

async function createCollective(name: string, members: string[], photo?: Buffer): Promise<string> {
  const collective = JSON.stringify({ name, members: members.map((id) => ({ id })), country: 'CA', description: 'Un collectif', email: emailOf(name) })
  return (await adminForm('/api/admin/collectives', { collective, photo })).collective.id
}

function set(performers: string[], fields: object = {}) {
  return {
    performers: performers.map((id) => ({ id })),
    durationMinutes: 60,
    performanceTypes: ['dj'],
    otherPerformanceType: '',
    genres: ['techno'],
    soundcloudTrack: null,
    youtubeVideo: null,
    application: null,
    ...fields,
  }
}

type Session = { id: string; sets: { id: string }[] }

// Adds a session, which starts at `start`, with `sets`, announced unless told otherwise.
async function createSession(start: string, sets: object[] = [], { announced = true, flyer, ...fields }: { announced?: boolean; flyer?: Buffer; [field: string]: unknown } = {}) {
  const session = JSON.stringify({
    start,
    durationMinutes: 120,
    type: 'guest-mixes',
    takeover: null,
    application: null,
    name: '',
    raEvent: null,
    description: '',
    ...fields,
    sets,
  })
  const created: Session = (await adminForm('/api/admin/sessions', { session, flyer })).session
  if (announced) await announce(created.id, true)
  return created
}

function announce(id: string, announced: boolean) {
  return admin('PUT', `/api/admin/sessions/${id}/announced`, { announced })
}

// Days long past, and far in the future, which sessions can still end before the year 3000 in (see "Times" in
// docs/design/server/sessions.md).
const PAST = (day: number) => `2020-01-${String(day).padStart(2, '0')}T21:00-05:00`
const FUTURE = (day: number) => `2990-01-${String(day).padStart(2, '0')}T21:00-05:00`

describe('GET /api/events', () => {
  it('gives the announced sessions, whatever their status, with their sets, and nothing that is not public', async () => {
    const [ana, brume, cyan] = [await createArtist('Ana'), await createArtist('Brume'), await createArtist('Cyan')]
    const ondes = await createCollective('Les Ondes', [ana])
    const takeover = await createSession(
      FUTURE(10),
      [
        set([brume, ana], { soundcloudTrack: 'https://soundcloud.com/parking/public-set', youtubeVideo: 'dQw4w9WgXcQ', otherPerformanceType: 'Synthé', durationMinutes: null }),
        set([cyan], { soundcloudTrack: 'https://soundcloud.com/parking/private-set/s-Secret1', genres: [] }),
        set([ana], { performanceTypes: ['live-performance', 'dj'] }),
      ],
      { type: 'takeover', takeover: ondes, raEvent: '6683745', description: 'Une soirée', flyer: JPEG },
    )
    await admin('PUT', `/api/admin/sets/${takeover.sets[1].id}/status`, { status: 'cancelled' })
    await createSession(FUTURE(11), [set([cyan])], { announced: false })
    const cancelled = await createSession(FUTURE(12), [], { type: 'synth-meetup' })
    await admin('PUT', `/api/admin/sessions/${cancelled.id}/status`, { status: 'cancelled' })

    const response = await get('/api/events')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      upcoming: [
        {
          id: takeover.id,
          title: 'LES ONDES TAKEOVER',
          type: 'takeover',
          start: '2990-01-10T21:00:00-05:00',
          end: '2990-01-10T23:00:00-05:00',
          cancelled: false,
          description: 'Une soirée',
          flyer: `/api/events/${takeover.id}/flyer`,
          raEvent: 'https://ra.co/events/6683745',
          takeover: { id: ondes, name: 'Les Ondes' },
          sets: [
            {
              id: takeover.sets[0].id,
              performers: [
                { id: brume, name: 'Brume' },
                { id: ana, name: 'Ana' },
              ],
              durationMinutes: null,
              performanceTypes: ['dj'],
              otherPerformanceType: 'Synthé',
              genres: ['techno'],
              cancelled: false,
              soundcloudTrack: { id: 'track:https://soundcloud.com/parking/public-set', url: 'https://soundcloud.com/parking/public-set' },
              youtubeVideo: { id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
            },
            {
              id: takeover.sets[1].id,
              performers: [{ id: cyan, name: 'Cyan' }],
              durationMinutes: 60,
              performanceTypes: ['dj'],
              otherPerformanceType: '',
              genres: [],
              cancelled: true,
              // Its private link is a secret.
              soundcloudTrack: { id: 'track:https://soundcloud.com/parking/private-set/s-Secret1', url: null },
              youtubeVideo: null,
            },
            {
              id: takeover.sets[2].id,
              performers: [{ id: ana, name: 'Ana' }],
              durationMinutes: 60,
              performanceTypes: ['dj', 'live-performance'],
              otherPerformanceType: '',
              genres: ['techno'],
              cancelled: false,
              soundcloudTrack: null,
              youtubeVideo: null,
            },
          ],
          // Cyan's set is cancelled, and Ana is in it once.
          lineup: [
            { id: brume, name: 'Brume' },
            { id: ana, name: 'Ana' },
          ],
        },
        {
          id: cancelled.id,
          title: 'SYNTH MEETUPS',
          type: 'synth-meetup',
          start: '2990-01-12T21:00:00-05:00',
          end: '2990-01-12T23:00:00-05:00',
          cancelled: true,
          description: DEFAULT_DESCRIPTIONS['synth-meetup'],
          flyer: null,
          raEvent: null,
          takeover: null,
          sets: [],
          lineup: [],
        },
      ],
      past: [],
    })
  })

  it('leaves out a session once it is un-announced', async () => {
    const session = await createSession(PAST(10))
    expect((await get('/api/events')).json().past.map(({ id }: { id: string }) => id)).toEqual([session.id])
    await announce(session.id, false)
    expect((await get('/api/events')).json()).toEqual({ ok: true, upcoming: [], past: [] })
  })

  it('splits the events into upcoming and past, in a time range when one is given', async () => {
    const ids = [await createSession(PAST(10)), await createSession(PAST(11)), await createSession(FUTURE(10)), await createSession(FUTURE(11))].map(({ id }) => id)
    expect((await get('/api/events')).json()).toMatchObject({ upcoming: [{ id: ids[2] }, { id: ids[3] }], past: [{ id: ids[1] }, { id: ids[0] }] })
    const ranged = await get(`/api/events?from=${encodeURIComponent('2020-01-11T00:00-05:00')}&to=${encodeURIComponent(FUTURE(11))}`)
    expect(ranged.json()).toMatchObject({ upcoming: [{ id: ids[2] }], past: [{ id: ids[1] }] })
  })
})

// Upcoming and past, as worked out at `now`, which the route gives as the time of the request.
describe('EventsStore.list', () => {
  const idsOf = ({ upcoming, past }: Awaited<ReturnType<EventsStore['list']>>) => ({ upcoming: upcoming.map(({ id }) => id), past: past.map(({ id }) => id) })

  it('has an event as upcoming until its end, then as past', async () => {
    // From 21:00 to 23:00.
    const { id } = await createSession('2026-11-14T21:00-05:00')
    expect(idsOf(await events.list({ now: new Date('2026-11-14T20:59-05:00') }))).toEqual({ upcoming: [id], past: [] })
    expect(idsOf(await events.list({ now: new Date('2026-11-14T22:59:59.999-05:00') }))).toEqual({ upcoming: [id], past: [] })
    expect(idsOf(await events.list({ now: new Date('2026-11-14T23:00-05:00') }))).toEqual({ upcoming: [], past: [id] })
  })

  it('works it out from the time, not from the status', async () => {
    const done = await createSession('2026-11-14T21:00-05:00')
    await admin('PUT', `/api/admin/sessions/${done.id}/status`, { status: 'done' })
    expect(idsOf(await events.list({ now: new Date('2026-11-14T22:00-05:00') }))).toEqual({ upcoming: [done.id], past: [] })
  })

  it('has every upcoming event, the soonest first, but only the 20 most recent past ones, the most recent first', async () => {
    const past: string[] = []
    for (let day = 1; day <= 22; day++) past.push((await createSession(PAST(day))).id)
    const later = await createSession(FUTURE(2))
    const sooner = await createSession(FUTURE(1))
    // A cancelled session can start when another one does, and is then ordered by when it was added: the first added
    // first among upcoming events, and last among past ones.
    async function cancelledAlongside(start: string, elsewhere: string) {
      const session = await createSession(elsewhere)
      await admin('PUT', `/api/admin/sessions/${session.id}/status`, { status: 'cancelled' })
      await admin('PATCH', `/api/admin/sessions/${session.id}`, { start })
      return session.id
    }
    const upcomingAlongside = await cancelledAlongside(FUTURE(1), FUTURE(3))
    const pastAlongside = await cancelledAlongside(PAST(22), PAST(25))
    const listed = idsOf(await events.list({ now: new Date('2026-11-14T21:00-05:00') }))
    expect(listed.upcoming).toEqual([sooner.id, upcomingAlongside, later.id])
    expect(listed.past).toEqual([pastAlongside, ...past.toReversed().slice(0, 19)])
  })

  it('has every event that starts in the time range, upcoming or past', async () => {
    const past: string[] = []
    for (let day = 1; day <= 22; day++) past.push((await createSession(PAST(day))).id)
    const upcoming = (await createSession(FUTURE(1))).id
    const now = new Date('2026-11-14T21:00-05:00')
    expect(idsOf(await events.list({ from: new Date(PAST(1)), now }))).toEqual({ upcoming: [upcoming], past: past.toReversed() })
    expect(idsOf(await events.list({ to: new Date(PAST(3)), now }))).toEqual({ upcoming: [], past: [past[1], past[0]] })
    // From `from`, included, to `to`, excluded, by start: an event going on at `from` isn't in it.
    expect(idsOf(await events.list({ from: new Date(PAST(2)), to: new Date(PAST(4)), now }))).toEqual({ upcoming: [], past: [past[2], past[1]] })
    expect(idsOf(await events.list({ from: new Date('2020-01-02T22:00-05:00'), to: new Date(PAST(4)), now }))).toEqual({ upcoming: [], past: [past[2]] })
  })

  it('leaves out the sessions that are not announced', async () => {
    await createSession(PAST(1), [], { announced: false })
    await createSession(FUTURE(1), [], { announced: false })
    expect(idsOf(await events.list({ now: new Date('2026-11-14T21:00-05:00') }))).toEqual({ upcoming: [], past: [] })
  })
})

describe('GET /calendar.ics', () => {
  it('has the announced sessions, as events, with their lineups, until they are un-announced', async () => {
    const [ana, brume] = [await createArtist('Ana'), await createArtist('Brume')]
    const session = await createSession(FUTURE(10), [set([ana, brume]), set([ana])], { description: 'Une soirée' })
    await createSession(FUTURE(11), [set([brume])], { announced: false })
    // Long past.
    await createSession(PAST(10))

    const response = await get('/calendar.ics')
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8')
    const vevents = response.body.match(/BEGIN:VEVENT[^]*?END:VEVENT/g)
    expect(vevents).toHaveLength(1)
    expect(vevents![0]).toContain(`UID:${session.id}@parking.radio\r\n`)
    expect(vevents![0]).toContain('DTSTART:29900111T020000Z\r\nDTEND:29900111T040000Z\r\nSUMMARY:GUEST MIXES\r\n')
    expect(vevents![0]).toContain('DESCRIPTION:Ana\\nBrume\\n\\nUne soirée\r\nURL:https://parking.radio/programmation\r\n')

    await announce(session.id, false)
    expect((await get('/calendar.ics')).body).not.toContain('BEGIN:VEVENT')
  })
})

describe('EventsStore.feed', () => {
  const now = new Date('2026-11-14T21:00-05:00')
  const since = new Date('2025-11-14T21:00-05:00')
  const idsOf = (sessions: { id: string }[]) => sessions.map(({ id }) => id)

  it('has the events that start at or after `since`, past and upcoming', async () => {
    await createSession('2025-11-14T20:59-05:00', [], { durationMinutes: 1 })
    const ids = [
      await createSession('2026-11-14T22:00-05:00'),
      await createSession('2025-11-14T21:00-05:00'),
      await createSession('2026-06-01T21:00-04:00'),
    ].map(({ id }) => id)
    await createSession('2026-01-01T21:00-05:00', [], { announced: false })
    expect(idsOf(await events.feed({ since, now })).toSorted()).toEqual(ids.toSorted())
  })

  it('has an event that started before `since` while it has not ended', async () => {
    // Two years long, until January 1st, 2027, at 21:00.
    const { id } = await createSession('2025-01-01T21:00-05:00', [], { durationMinutes: 2 * 365 * 24 * 60 })
    expect(idsOf(await events.feed({ since, now }))).toEqual([id])
    const later = new Date('2027-02-01T00:00-05:00')
    expect(idsOf(await events.feed({ since: new Date('2026-02-01T00:00-05:00'), now: later }))).toEqual([])
  })
})

describe('GET /api/artists/:id', () => {
  it("gives a public artist's profile, without their contact details, their collectives, or who added them", async () => {
    const ana = await createArtist('Ana', JPEG)
    const brume = await createArtist('Brume')
    // A collective that isn't public, which their profile mustn't name.
    await createCollective('Privé', [ana])
    await createSession(FUTURE(1), [set([ana]), set([brume])])
    expect((await get(`/api/artists/${ana}`)).json()).toEqual({
      ok: true,
      artist: {
        id: ana,
        name: 'Ana',
        country: 'CA',
        city: 'Québec',
        genres: ['techno', 'house'],
        bio: 'Une bio',
        links: { soundcloud: 'someone' },
        photo: `/api/artists/${ana}/photo`,
      },
    })
    expect((await get(`/api/artists/${brume}`)).json().artist.photo).toBeNull()
  })

  it('is not found for an artist who is private, like one who does not exist', async () => {
    const alone = await createArtist('Ana')
    const unannounced = await createArtist('Brume')
    await createSession(FUTURE(1), [set([unannounced])], { announced: false })
    for (const id of [alone, unannounced, NOBODY, 'nope']) {
      const response = await get(`/api/artists/${id}`)
      expect(response.statusCode, id).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such artist' })
    }
  })

  it('makes the performers of an event public, even of a cancelled set, or of a cancelled event, and private again once it is un-announced', async () => {
    const [ana, brume] = [await createArtist('Ana'), await createArtist('Brume')]
    const session = await createSession(FUTURE(1), [set([ana]), set([brume])], { announced: false })
    expect([await artistStatus(ana), await artistStatus(brume)]).toEqual([404, 404])
    await announce(session.id, true)
    await admin('PUT', `/api/admin/sets/${session.sets[1].id}/status`, { status: 'cancelled' })
    expect([await artistStatus(ana), await artistStatus(brume)]).toEqual([200, 200])
    await admin('PUT', `/api/admin/sessions/${session.id}/status`, { status: 'cancelled' })
    expect([await artistStatus(ana), await artistStatus(brume)]).toEqual([200, 200])
    await announce(session.id, false)
    expect([await artistStatus(ana), await artistStatus(brume)]).toEqual([404, 404])
  })

  it('makes an artist private once their set is moved to a session that is not announced', async () => {
    const ana = await createArtist('Ana')
    const announced = await createSession(FUTURE(1), [set([ana])])
    const unannounced = await createSession(FUTURE(2), [], { announced: false })
    expect(await artistStatus(ana)).toBe(200)
    await admin('PUT', `/api/admin/sets/${announced.sets[0].id}/session`, { session: unannounced.id })
    expect(await artistStatus(ana)).toBe(404)
  })

  it('makes the members of a public collective public, even those who do not play, until they leave it', async () => {
    const [ana, brume] = [await createArtist('Ana'), await createArtist('Brume')]
    const ondes = await createCollective('Les Ondes', [ana, brume])
    await createSession(FUTURE(1), [set([ana])], { type: 'takeover', takeover: ondes })
    expect(await artistStatus(brume)).toBe(200)
    await admin('PATCH', `/api/admin/collectives/${ondes}`, { members: [{ id: ana }] })
    expect(await artistStatus(brume)).toBe(404)
  })

  it('leaves the members of a collective whose only takeover is not announced private', async () => {
    const ana = await createArtist('Ana')
    const ondes = await createCollective('Les Ondes', [ana])
    await createSession(FUTURE(1), [], { type: 'takeover', takeover: ondes, announced: false })
    expect(await artistStatus(ana)).toBe(404)
  })
})

describe('GET /api/collectives/:id', () => {
  it("gives a public collective's profile, with its members in order, without its contact's details, or who added it", async () => {
    const [ana, brume] = [await createArtist('Ana'), await createArtist('Brume')]
    const ondes = await createCollective('Les Ondes', [brume, ana], JPEG)
    await createSession(FUTURE(1), [], { type: 'takeover', takeover: ondes })
    expect((await get(`/api/collectives/${ondes}`)).json()).toEqual({
      ok: true,
      collective: {
        id: ondes,
        name: 'Les Ondes',
        country: 'CA',
        city: '',
        description: 'Un collectif',
        links: {},
        members: [
          { id: brume, name: 'Brume' },
          { id: ana, name: 'Ana' },
        ],
        photo: `/api/collectives/${ondes}/photo`,
      },
    })
  })

  it('is not found for a collective that is private, like one that does not exist', async () => {
    const ana = await createArtist('Ana')
    const without = await createCollective('Sans', [ana])
    const unannounced = await createCollective('Pas annoncé', [ana])
    // Its artist is public, but that doesn't make it public.
    await createSession(FUTURE(1), [set([ana])])
    await createSession(FUTURE(2), [], { type: 'takeover', takeover: unannounced, announced: false })
    for (const id of [without, unannounced, NOBODY, 'nope']) {
      const response = await get(`/api/collectives/${id}`)
      expect(response.statusCode, id).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such collective' })
    }
  })

  it('is public while it has a takeover that is an event, even a cancelled one', async () => {
    const ana = await createArtist('Ana')
    const ondes = await createCollective('Les Ondes', [ana])
    const takeover = await createSession(FUTURE(1), [], { type: 'takeover', takeover: ondes })
    await admin('PUT', `/api/admin/sessions/${takeover.id}/status`, { status: 'cancelled' })
    expect(await collectiveStatus(ondes)).toBe(200)
    await announce(takeover.id, false)
    expect(await collectiveStatus(ondes)).toBe(404)
  })

  it('is private, and so are its members, once its takeover is another type of session', async () => {
    const ana = await createArtist('Ana')
    const ondes = await createCollective('Les Ondes', [ana])
    const takeover = await createSession(FUTURE(1), [], { type: 'takeover', takeover: ondes })
    expect([await collectiveStatus(ondes), await artistStatus(ana)]).toEqual([200, 200])
    await admin('PATCH', `/api/admin/sessions/${takeover.id}`, { type: 'guest-mixes', takeover: null })
    expect([await collectiveStatus(ondes), await artistStatus(ana)]).toEqual([404, 404])
  })
})

describe('the photos and flyers of what is public', () => {
  // The ETag that the admin endpoint gives the image at `url`.
  async function etagOf(url: string): Promise<string> {
    const response = await app.inject({ method: 'GET', url, cookies: await sessionCookies() })
    expect(response.statusCode).toBe(200)
    return response.headers.etag as string
  }

  it('are served like those of the admin pages, to anyone', async () => {
    const ana = await createArtist('Ana', JPEG)
    const ondes = await createCollective('Les Ondes', [ana], JPEG)
    const takeover = await createSession(FUTURE(1), [], { type: 'takeover', takeover: ondes, flyer: JPEG })
    for (const url of [`/api/artists/${ana}/photo`, `/api/collectives/${ondes}/photo`, `/api/events/${takeover.id}/flyer`]) {
      const response = await get(url)
      expect(response.statusCode, url).toBe(200)
      expect(response.rawPayload).toEqual(JPEG)
      expect(response.headers).toMatchObject({ 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-cache' })
      const again = await get(url, { 'if-none-match': response.headers.etag as string })
      expect(again.statusCode, url).toBe(304)
    }
  })

  it("aren't served once what they're of is private, even to a browser that already has them", async () => {
    const ana = await createArtist('Ana', JPEG)
    const ondes = await createCollective('Les Ondes', [ana], JPEG)
    const takeover = await createSession(FUTURE(1), [], { type: 'takeover', takeover: ondes, flyer: JPEG, announced: false })
    for (const [url, adminUrl, error] of [
      [`/api/artists/${ana}/photo`, `/api/admin/artists/${ana}/photo`, 'No such artist'],
      [`/api/collectives/${ondes}/photo`, `/api/admin/collectives/${ondes}/photo`, 'No such collective'],
      [`/api/events/${takeover.id}/flyer`, `/api/admin/sessions/${takeover.id}/flyer`, 'No such event'],
    ]) {
      const response = await get(url, { 'if-none-match': await etagOf(adminUrl) })
      expect(response.statusCode, url).toBe(404)
      expect(response.json()).toEqual({ ok: false, error })
    }
  })

  it("aren't found when there's none, when it's missing, or when there's no such event", async () => {
    const ana = await createArtist('Ana')
    const brume = await createArtist('Brume', JPEG)
    const without = await createSession(FUTURE(1), [set([ana]), set([brume])])
    const missing = await createSession(FUTURE(2), [], { flyer: JPEG })
    stored.clear()
    for (const [url, error] of [
      [`/api/artists/${ana}/photo`, 'This artist has no photo'],
      [`/api/artists/${brume}/photo`, 'The photo of this artist is missing'],
      [`/api/events/${without.id}/flyer`, 'This event has no flyer'],
      [`/api/events/${missing.id}/flyer`, 'The flyer of this event is missing'],
      [`/api/events/${NOBODY}/flyer`, 'No such event'],
      ['/api/events/x/flyer', 'No such event'],
    ]) {
      const response = await get(url)
      expect(response.statusCode, url).toBe(404)
      expect(response.json()).toEqual({ ok: false, error })
    }
  })
})
