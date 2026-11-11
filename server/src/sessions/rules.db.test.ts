import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { artistsRoutes } from '../artists/routes.js'
import { artistsStore } from '../artists/store.js'
import type { Photos } from '../artists/store.js'
import { collectivesRoutes } from '../collectives/routes.js'
import { collectivesStore } from '../collectives/store.js'
import { artists, collectives, sessions, setPerformers, sets } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { SESSION_FIELDS, SET_FIELDS } from './fields.js'
import { sessionsRoutes } from './routes.js'
import { sessionsStore } from './store.js'
import { checkSessionsInvariants } from './test-invariants.js'

// Property-based tests of the rules of sessions and sets (see "Rules" in docs/design/server/sessions.md), against a real
// database: random sequences of requests, through the routes, after each of which every rule must still hold (see
// test-invariants.ts), the server must not have failed, and a 409 must be about a rule, with what's really in the way.
//
// Each operation is plain data, which fast-check generates and shrinks, and that `run` sends. What it acts on, e.g. the
// session a set is added to, is an index into the ids of what exists, in the order it was added, or an id of nothing
// when nothing exists, so that a seed replays exactly, whatever ids the database gives. The values are taken from small
// sets, so that sessions and sets often overlap, and share tracks and videos, and a few aren't valid, which the server
// refuses.
//
// FC_SEED and FC_PATH replay a failure, as fast-check prints them, and FC_NUM_RUNS changes how many sequences are tried.

// What exists, by kind, in the order it was added, and what the operations are run with.
type Ids = { sessions: string[]; sets: string[]; artists: string[]; collectives: string[] }
type Context = { app: FastifyInstance; database: TestDatabase; cookies: Record<string, string>; ids: Ids }
type Body = { error: string; session: Session | null; set: StudioSet | null }
type StudioSet = { id: string; soundcloudTrack: { id: string } | null; youtubeVideo: { id: string } | null }
type Session = {
  id: string
  start: string | null
  end: string | null
  durationMinutes: number
  type: string
  takeover: { id: string } | null
  status: string
  sets: StudioSet[]
}

// An operation: how to generate it, and how often, relative to the others, how to send it, and how to check the 409s it
// can get, which are about the rules, each by its message.
type Operation<Args> = {
  args: fc.Arbitrary<Args>
  weight: number
  run(context: Context, args: Args): Promise<LightMyRequestResponse>
  conflicts?: Record<string, (body: Body, args: Args, context: Context) => Promise<void> | void>
}

const SESSION_OVERLAPS = 'Another session overlaps this one'
const SESSION_CANCELLED = 'This session is cancelled'
const TRACK_TAKEN = "This SoundCloud track is another set's"
const VIDEO_TAKEN = "This YouTube video is another set's"
const HAS_TAKEOVERS = 'This collective has takeovers: give them another collective, or another type, first'

// An id that's never one of anything's.
const NONE = '00000000-0000-4000-8000-000000000000'

function pick(ids: string[], index: number): string {
  return ids.length === 0 ? NONE : ids[index % ids.length]
}

const STATUS = fc.constantFrom('planned', 'done', 'cancelled')

// Mostly `valid`, and sometimes `invalid`, which the server refuses.
function mostly<T>(valid: fc.Arbitrary<T>, invalid: fc.Arbitrary<T>): fc.Arbitrary<T> {
  return fc.oneof({ arbitrary: valid, weight: 19 }, { arbitrary: invalid, weight: 1 })
}

// Null 2 times in 3, so that sets often go without a link, and sessions can have several.
function rarely<T>(value: fc.Arbitrary<T>): fc.Arbitrary<T | null> {
  return fc.oneof({ arbitrary: fc.constant(null), weight: 2 }, { arbitrary: value, weight: 1 })
}

// A session's type, its collective, as an index into the collectives, and its name: mostly a takeover, with a collective,
// or another type, without one, and a name for those of type other, and sometimes what doesn't go together.
type Kind = { type: string; takeover: number | null; name: string }
const NAME = fc.constantFrom('', 'VKT TAKEOVER', 'ATELIER DE DJing')
const Kind = mostly<Kind>(
  fc.oneof(
    fc.record({ type: fc.constant('takeover'), takeover: fc.nat(), name: NAME }),
    fc.record({ type: fc.constantFrom('guest-mixes', 'live-performance', 'synth-meetup'), takeover: fc.constant(null), name: NAME }),
    fc.record({ type: fc.constant('other'), takeover: fc.constant(null), name: fc.constant('LISTENING PARTY') }),
  ),
  fc.oneof(
    fc.record({ type: fc.constant('takeover'), takeover: fc.constant(null), name: NAME }),
    fc.record({ type: fc.constantFrom('guest-mixes', 'other'), takeover: fc.nat(), name: NAME }),
    fc.record({ type: fc.constantFrom('other', 'meetup'), takeover: fc.constant(null), name: fc.constant('') }),
  ),
)

// Sessions over a couple of evenings.
const SessionFields = fc.record({
  start: mostly<string | null>(
    fc.option(fc.constantFrom('2026-11-14T18:00-05:00', '2026-11-14T21:00-05:00', '2026-11-14T23:30-05:00', '2026-11-15T21:00-05:00')),
    fc.constant('1999-12-31T21:00-05:00'),
  ),
  durationMinutes: mostly<number>(fc.constantFrom(1, 60, 120, 240, 1440), fc.constantFrom(0, 1441)),
  kind: Kind,
})
type SessionArgs = typeof SessionFields extends fc.Arbitrary<infer T> ? T : never

function sessionBody(context: Context, { start, durationMinutes, kind: { type, takeover, name } }: SessionArgs) {
  return { start, durationMinutes, type, takeover: takeover === null ? null : pick(context.ids.collectives, takeover), name, raEvent: null, description: '' }
}

// Adds or changes a session, which is sent as multipart/form-data, without a flyer.
function sendSession({ app, cookies }: Context, method: 'POST' | 'PUT', url: string, session: object) {
  return app.inject({ method, url, ...multipartBody({ session: JSON.stringify(session) }), cookies })
}

// The SoundCloud tracks, by the links that lead to them, and one where SoundCloud shows none.
const MISSING_TRACK = 'https://soundcloud.com/parkingdotradio/missing'
const TRACKS: Record<string, string | null> = {
  ...Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((name, i) => [`https://soundcloud.com/parkingdotradio/${name}`, String(i + 1)])),
  [MISSING_TRACK]: null,
}
const VIDEOS = ['a', 'b', 'c', 'd', 'e'].map((letter) => letter.repeat(11))

const DURATION = fc.constantFrom(1, 30, 60, 120, 240, 1440)

// A set's place: mostly an offset and a duration, from the start of a session to past its end.
const Place = mostly<{ offsetMinutes: number | null; durationMinutes: number | null }>(
  fc.oneof(
    { arbitrary: fc.record({ offsetMinutes: fc.constantFrom(0, 30, 60, 120, 180, 1439), durationMinutes: DURATION }), weight: 3 },
    { arbitrary: fc.record({ offsetMinutes: fc.constant(null), durationMinutes: fc.option(DURATION) }), weight: 1 },
  ),
  fc.record({ offsetMinutes: fc.constantFrom(null, 30, 1440), durationMinutes: fc.constantFrom(null, 0, 1441) }),
)

const SetFields = fc
  .record({
    performers: mostly<number[]>(fc.array(fc.nat(), { minLength: 1, maxLength: 2 }), fc.constant([])),
    place: Place,
    soundcloudTrack: rarely(mostly(fc.constantFrom(...Object.keys(TRACKS).filter((link) => TRACKS[link])), fc.constant(MISSING_TRACK))),
    youtubeVideo: rarely(fc.constantFrom(...VIDEOS)),
  })
  .map(({ place, ...fields }) => ({ ...fields, ...place }))
type SetArgs = typeof SetFields extends fc.Arbitrary<infer T> ? T : never

function setBody(context: Context, { performers, ...fields }: SetArgs) {
  return {
    ...fields,
    performers: performers.map((index) => ({ id: pick(context.ids.artists, index) })),
    performanceTypes: [],
    otherPerformanceType: '',
    genres: [],
  }
}

function send({ app, cookies }: Context, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies })
}

// Deletes what's at `url`, and leaves out of the ids what doesn't exist anymore, e.g. the sets of a session.
async function remove(context: Context, url: string) {
  const response = await send(context, 'DELETE', url)
  if (response.statusCode !== 200) return response
  for (const kind of ['sessions', 'sets', 'artists', 'collectives'] as const) {
    const { rows } = await context.database.db.execute<{ id: string }>(sql`select id from ${sql.identifier(kind)}`)
    const existing = new Set(rows.map((row) => row.id))
    context.ids[kind] = context.ids[kind].filter((id) => existing.has(id))
  }
  return response
}

// Whether two periods overlap, each from its start, included, to its end, excluded.
function overlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

// Checks that `other`, which a 409 says is in the way of a session that would take `period`, overlaps it.
function expectOverlappingSession(other: Session | null, id: string | null, period: { start: number; end: number }) {
  expect(other, 'the session in the way').not.toBeNull()
  expect(other!.id).not.toBe(id)
  expect(other!.status).not.toBe('cancelled')
  expect(other!.start).not.toBeNull()
  expect(overlap(period, { start: Date.parse(other!.start!), end: Date.parse(other!.end!) })).toBe(true)
}

// Checks that the set a 409 says is in the way, which isn't `id`, has the track or the video that was sent, and is one of
// the session it comes with.
function expectSetWith(body: Body, id: string | null, has: (set: StudioSet) => boolean) {
  expect(body.set, 'the set in the way').not.toBeNull()
  expect(body.set!.id).not.toBe(id)
  expect(has(body.set!)).toBe(true)
  expect(body.session?.sets.map((set) => set.id)).toContain(body.set!.id)
}

// The 409s of adding or changing a set with `fields`, which `id` is, if it's changed.
function setConflicts<Args extends { fields: SetArgs }>(id: (args: Args, context: Context) => string | null) {
  return {
    [TRACK_TAKEN]: (body: Body, args: Args, context: Context) =>
      expectSetWith(body, id(args, context), (set) => set.soundcloudTrack?.id === TRACKS[args.fields.soundcloudTrack!]),
    [VIDEO_TAKEN]: (body: Body, args: Args, context: Context) =>
      expectSetWith(body, id(args, context), (set) => set.youtubeVideo?.id === args.fields.youtubeVideo),
  }
}

// The period of a session that would start at `start` and last `durationMinutes`.
function period(start: string, durationMinutes: number) {
  return { start: Date.parse(start), end: Date.parse(start) + durationMinutes * 60_000 }
}

// Only the fields of `body` that are `sent`, as a change with PATCH sends them.
function only(body: Record<string, unknown>, sent: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([field]) => sent.includes(field)))
}

// The fields a PATCH can send: all of them, so that a field that's added is sent too.
const SESSION_FIELD_NAMES = Object.keys(SESSION_FIELDS)
const SET_FIELD_NAMES = Object.keys(SET_FIELDS)

// Every operation, by name. A step that adds an operation adds it here.
const OPERATIONS = {
  createSession: {
    weight: 4,
    args: SessionFields,
    async run(context, args) {
      const response = await sendSession(context, 'POST', '/api/admin/sessions', sessionBody(context, args))
      if (response.statusCode === 200) context.ids.sessions.push(response.json().session.id)
      return response
    },
    conflicts: { [SESSION_OVERLAPS]: (body, args) => expectOverlappingSession(body.session, null, period(args.start!, args.durationMinutes)) },
  } satisfies Operation<SessionArgs>,

  updateSession: {
    weight: 3,
    args: fc.record({ session: fc.nat(), fields: SessionFields }),
    run: (context, { session, fields }) => sendSession(context, 'PUT', `/api/admin/sessions/${pick(context.ids.sessions, session)}`, sessionBody(context, fields)),
    conflicts: {
      [SESSION_OVERLAPS]: (body, { session, fields }, context) =>
        expectOverlappingSession(body.session, pick(context.ids.sessions, session), period(fields.start!, fields.durationMinutes)),
    },
  } satisfies Operation<{ session: number; fields: SessionArgs }>,

  // Changes some of the session's fields: the rules are checked on the session as it would then be.
  patchSession: {
    weight: 3,
    args: fc.record({ session: fc.nat(), fields: SessionFields, sent: fc.subarray(SESSION_FIELD_NAMES, { minLength: 1 }) }),
    run: (context, { session, fields, sent }) =>
      send(context, 'PATCH', `/api/admin/sessions/${pick(context.ids.sessions, session)}`, only(sessionBody(context, fields), sent)),
    conflicts: {
      // The session is as it was, since the request failed, but for what was sent.
      [SESSION_OVERLAPS]: async (body, { session, fields, sent }, context) => {
        const id = pick(context.ids.sessions, session)
        const before = (await send(context, 'GET', `/api/admin/sessions/${id}`)).json().session as Session
        const start = sent.includes('start') ? fields.start : before.start
        const durationMinutes = sent.includes('durationMinutes') ? fields.durationMinutes : before.durationMinutes
        expectOverlappingSession(body.session, id, period(start!, durationMinutes))
      },
    },
  } satisfies Operation<{ session: number; fields: SessionArgs; sent: string[] }>,

  setSessionStatus: {
    weight: 2,
    args: fc.record({ session: fc.nat(), status: STATUS }),
    run: (context, { session, status }) => send(context, 'PUT', `/api/admin/sessions/${pick(context.ids.sessions, session)}/status`, { status }),
    conflicts: {
      // The session is as it was, since the request failed.
      [SESSION_OVERLAPS]: async (body, { session }, context) => {
        const id = pick(context.ids.sessions, session)
        const { start, durationMinutes } = (await send(context, 'GET', `/api/admin/sessions/${id}`)).json().session as Session
        expectOverlappingSession(body.session, id, period(start!, durationMinutes))
      },
    },
  } satisfies Operation<{ session: number; status: string }>,

  deleteSession: {
    weight: 1,
    args: fc.nat(),
    run: (context, session) => remove(context, `/api/admin/sessions/${pick(context.ids.sessions, session)}`),
  } satisfies Operation<number>,

  addSet: {
    weight: 10,
    args: fc.record({ session: fc.nat(), fields: SetFields }),
    async run(context, { session, fields }) {
      const response = await send(context, 'POST', `/api/admin/sessions/${pick(context.ids.sessions, session)}/sets`, setBody(context, fields))
      if (response.statusCode === 200) {
        const added = (response.json().session as Session).sets.find((set) => !context.ids.sets.includes(set.id))
        context.ids.sets.push(added!.id)
      }
      return response
    },
    conflicts: {
      [SESSION_CANCELLED]: (body, { session }, context) => {
        expect(body.session?.id).toBe(pick(context.ids.sessions, session))
        expect(body.session?.status).toBe('cancelled')
        expect(body.set).toBeNull()
      },
      ...setConflicts<{ session: number; fields: SetArgs }>(() => null),
    },
  } satisfies Operation<{ session: number; fields: SetArgs }>,

  updateSet: {
    weight: 5,
    args: fc.record({ set: fc.nat(), fields: SetFields }),
    run: (context, { set, fields }) => send(context, 'PUT', `/api/admin/sets/${pick(context.ids.sets, set)}`, setBody(context, fields)),
    conflicts: setConflicts<{ set: number; fields: SetArgs }>(({ set }, context) => pick(context.ids.sets, set)),
  } satisfies Operation<{ set: number; fields: SetArgs }>,

  // Changes some of the set's fields: its place is checked as it would then be, and its track is only resolved when it's
  // sent.
  patchSet: {
    weight: 5,
    args: fc.record({ set: fc.nat(), fields: SetFields, sent: fc.subarray(SET_FIELD_NAMES, { minLength: 1 }) }),
    run: (context, { set, fields, sent }) => send(context, 'PATCH', `/api/admin/sets/${pick(context.ids.sets, set)}`, only(setBody(context, fields), sent)),
    conflicts: setConflicts<{ set: number; fields: SetArgs; sent: string[] }>(({ set }, context) => pick(context.ids.sets, set)),
  } satisfies Operation<{ set: number; fields: SetArgs; sent: string[] }>,

  setSetStatus: {
    weight: 3,
    args: fc.record({ set: fc.nat(), status: STATUS }),
    run: (context, { set, status }) => send(context, 'PUT', `/api/admin/sets/${pick(context.ids.sets, set)}/status`, { status }),
    conflicts: {
      [SESSION_CANCELLED]: (body, { set }, context) => {
        expect(body.session?.status).toBe('cancelled')
        expect(body.session?.sets.map(({ id }) => id)).toContain(pick(context.ids.sets, set))
        expect(body.set).toBeNull()
      },
    },
  } satisfies Operation<{ set: number; status: string }>,

  deleteSet: {
    weight: 1,
    args: fc.nat(),
    run: (context, set) => remove(context, `/api/admin/sets/${pick(context.ids.sets, set)}`),
  } satisfies Operation<number>,

  // Takes the artist out of their sets.
  deleteArtist: {
    weight: 1,
    args: fc.nat(),
    run: (context, artist) => remove(context, `/api/admin/artists/${pick(context.ids.artists, artist)}`),
  } satisfies Operation<number>,

  // Fails while it has takeovers, which need it.
  deleteCollective: {
    weight: 1,
    args: fc.nat(),
    run: (context, collective) => remove(context, `/api/admin/collectives/${pick(context.ids.collectives, collective)}`),
    conflicts: {
      [HAS_TAKEOVERS]: (body, collective, context) => {
        expect(body.session?.type).toBe('takeover')
        expect(body.session?.takeover?.id).toBe(pick(context.ids.collectives, collective))
        expect(body.set).toBeNull()
      },
    },
  } satisfies Operation<number>,
}

type Name = keyof typeof OPERATIONS
type Step = { name: Name; args: unknown }

const STEP: fc.Arbitrary<Step> = fc.oneof(
  ...Object.entries(OPERATIONS).map(([name, operation]) => ({
    arbitrary: (operation.args as fc.Arbitrary<unknown>).map((args) => ({ name: name as Name, args })),
    weight: operation.weight,
  })),
)

// Photos and flyers aren't sent, so there are none to read or delete.
const NO_PHOTOS: Photos = {
  store: async () => {
    throw new Error('No photos in these tests')
  },
  read: async () => null,
  delete: async () => {},
}

async function buildApp(database: TestDatabase) {
  const app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(sessionsRoutes, { store: sessionsStore(database.db), photos: NO_PHOTOS, resolveTrack: async (link) => TRACKS[link] ?? null })
  await app.register(artistsRoutes, { store: artistsStore(database.db), photos: NO_PHOTOS })
  await app.register(collectivesRoutes, { store: collectivesStore(database.db), photos: NO_PHOTOS })
  return app
}

// Empties the database, but for 4 artists, 2 collectives, and 2 sessions of 4 hours, one of them without a date, which is
// the second collective's takeover, each with 2 sets, one after the other, so that even short sequences act on sets and
// on a collective with a takeover, and returns their ids, in the order they were added.
async function reset(database: TestDatabase): Promise<Ids> {
  await database.db.execute(sql`truncate sessions, artists, collectives cascade`)
  const profile = { country: '' as const, city: '', links: {}, phone: '' }
  // Returned in the order they're added.
  const added = await Promise.all([
    database.db
      .insert(artists)
      .values(['Aurore', 'Brume', 'Cyan', 'Dune'].map((name) => ({ ...profile, name, genres: [], bio: '' })))
      .returning({ id: artists.id }),
    database.db
      .insert(collectives)
      .values(['Les Ondes', 'Haute Rive'].map((name) => ({ ...profile, name, description: '' })))
      .returning({ id: collectives.id }),
  ])
  const [artistIds, collectiveIds] = added.map((rows) => rows.map(({ id }) => id))
  const sessionRows = await database.db
    .insert(sessions)
    .values([
      { startAt: new Date('2026-11-15T02:00:00Z'), type: 'guest-mixes' as const, takeoverId: null },
      { startAt: null, type: 'takeover' as const, takeoverId: collectiveIds[1] },
    ].map((session) => ({ ...session, durationMinutes: 240, name: '', createdBy: 'seed' })))
    .returning({ id: sessions.id })
  const sessionIds = sessionRows.map(({ id }) => id)
  const setIds: string[] = []
  for (const sessionId of sessionIds) {
    for (const offsetMinutes of [0, 60]) {
      const set = { sessionId, offsetMinutes, durationMinutes: 60, performanceTypes: [], otherPerformanceType: '', genres: [], createdBy: 'seed' }
      const [{ id }] = await database.db.insert(sets).values(set).returning({ id: sets.id })
      await database.db.insert(setPerformers).values({ setId: id, artistId: artistIds[setIds.length % artistIds.length], position: 0 })
      setIds.push(id)
    }
  }
  return { sessions: sessionIds, sets: setIds, artists: artistIds, collectives: collectiveIds }
}

function numberFromEnv(name: string): number | undefined {
  return process.env[name] ? Number(process.env[name]) : undefined
}

describe('the rules of sessions and sets', () => {
  let database: TestDatabase
  let app: FastifyInstance

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret'
    database = await testDatabase()
    app = await buildApp(database)
  })

  afterAll(async () => {
    await app?.close()
    await database?.drop()
  })

  it('hold after any sequence of requests, which never fail unexpectedly, and whose 409s say what is really in the way', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(STEP, { maxLength: 40, size: 'max' }), async (steps) => {
        const context: Context = { app, database, cookies: await sessionCookies(), ids: await reset(database) }
        for (const [i, { name, args }] of steps.entries()) {
          const operation: Operation<unknown> = OPERATIONS[name] as Operation<unknown>
          const response = await operation.run(context, args)
          const where = `step ${i}, ${name}: ${response.statusCode} ${response.body}`
          expect(response.statusCode, where).toBeLessThan(500)
          expect([401, 403], where).not.toContain(response.statusCode)
          if (response.statusCode === 409) {
            const body = response.json() as Body
            const check = operation.conflicts?.[body.error]
            expect(check, `${where}: a 409 that isn't about one of the rules`).toBeDefined()
            await check!(body, args, context)
          }
          await checkSessionsInvariants(database.db)
        }
      }),
      { numRuns: numberFromEnv('FC_NUM_RUNS') ?? 200, seed: numberFromEnv('FC_SEED'), path: process.env.FC_PATH },
    )
  })
})
