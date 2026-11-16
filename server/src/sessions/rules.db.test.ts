import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { TEST_ADMIN, acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { artistsRoutes } from '../artists/routes.js'
import { artistsStore } from '../artists/store.js'
import type { Photos } from '../artists/store.js'
import { collectivesRoutes } from '../collectives/routes.js'
import { collectivesStore } from '../collectives/store.js'
import { applicationsRoutes } from '../applications/routes.js'
import { applicationsSettingsStore } from '../applications/settings.js'
import { applicationsStore } from '../applications/store.js'
import { applications, artists, collectives, sessions, setPerformers, sets } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { MAX_MINUTES, SESSION_FIELDS, SET_FIELDS } from './fields.js'
import { sessionsRoutes } from './routes.js'
import { sessionsStore } from './store.js'
import { checkSessionsInvariants } from './test-invariants.js'

// Property-based tests of the rules of sessions and sets (see "Rules" and "Applications" in docs/design/server/sessions.md), against a real
// database: random sequences of requests, through the routes, after each of which every rule must still hold (see
// test-invariants.ts), the server must not have failed, a 409 must be about a rule, with what's really in the way, and
// the statuses of sessions and sets must have changed as the request says they do, and no other way (see "Status" in
// docs/design/server/sessions.md, and `expectStatuses`), which isn't an invariant: e.g. a session that's planned again
// can have sets that are all done.
//
// Each operation is plain data, which fast-check generates and shrinks, and that `run` sends. What it acts on, e.g. the
// session a set is added to, is an index into the ids of what exists, in the order it was added, or an id of nothing
// when nothing exists, so that a seed replays exactly, whatever ids the database gives. The values are taken from small
// sets, so that sessions and sets often overlap, and share tracks and videos, and a few aren't valid, which the server
// refuses.
//
// FC_SEED and FC_PATH replay a failure, as fast-check prints them, and FC_NUM_RUNS changes how many sequences are tried.

// What exists, by kind, in the order it was added, applications with the artist or the collective they belong to, and what
// the operations are run with.
type Ids = { sessions: string[]; sets: string[]; artists: string[]; collectives: string[]; applications: { id: string; owner: string }[] }
type Context = { app: FastifyInstance; database: TestDatabase; cookies: Record<string, string>; ids: Ids }
type Body = { error: string; session: Session | null; set: StudioSet | null; setIndex?: number; otherSetIndex?: number }
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

// An operation: how to generate it, and how often, relative to the others, how to send it, how to check the 409s it
// can get, which are about the rules, each by its message, and, for those that change a status or delete a set, which
// ones, found before it's sent, since deleting a set leaves it out of the ids (see `expectStatuses`).
type Operation<Args> = {
  args: fc.Arbitrary<Args>
  weight: number
  run(context: Context, args: Args): Promise<LightMyRequestResponse>
  conflicts?: Record<string, (body: Body, args: Args, context: Context) => Promise<void> | void>
  statusRequest?: (context: Context, args: Args) => StatusRequest
}

// What an operation asks of statuses: a session's or a set's, or deleting a set.
type StatusRequest = { session: string; status: string } | { set: string; status: string } | { deletedSet: string }

// The status of every session and set, by id, who last changed it and when, in milliseconds, and, for a set, its session.
type StatusRow = { status: string; by: string | null; at: number | null; session: string | null }
type Statuses = Map<string, StatusRow>

async function statuses(database: TestDatabase): Promise<Statuses> {
  const { rows } = await database.db.execute<StatusRow & { id: string }>(sql`
    select id::text, status::text, status_updated_by as by, (extract(epoch from status_updated_at) * 1000)::float8 as at, null as session
    from sessions
    union all
    select id::text, status::text, status_updated_by, (extract(epoch from status_updated_at) * 1000)::float8, session_id::text from sets`)
  return new Map(rows.map(({ id, ...row }) => [id, row]))
}

// The statuses that the sessions and the sets of `before` should have once `request` succeeded, by id, and whether it
// changed them, as the admin who sent it, all at the same time, with the sets of each session as they are `after` it:
// - a session's status changes, and cancelling it cancels its sets that aren't, while marking it done marks its planned
//   sets done;
// - a set's status changes, or it's deleted, after which its session, if it's planned, with at least one set that's done
//   and none that's planned, becomes done.
function expectedStatuses(before: Statuses, after: Statuses, request: StatusRequest): Map<string, { status: string; changed: boolean }> {
  const expected = new Map([...before].map(([id, { status }]) => [id, { status, changed: false }]))
  const mark = (id: string, status: string) => expected.set(id, { status, changed: true })
  const setsOf = (session: string) => [...after].filter(([, row]) => row.session === session).map(([id]) => id)
  const markDoneIfPlayed = (session: string) => {
    const statuses = setsOf(session).map((id) => expected.get(id)!.status)
    if (expected.get(session)!.status === 'planned' && statuses.includes('done') && !statuses.includes('planned')) mark(session, 'done')
  }
  if ('session' in request) {
    mark(request.session, request.status)
    for (const set of setsOf(request.session)) {
      const { status } = expected.get(set)!
      if (request.status === 'cancelled' ? status !== 'cancelled' : request.status === 'done' && status === 'planned') mark(set, request.status)
    }
  } else if ('set' in request) {
    mark(request.set, request.status)
    markDoneIfPlayed(before.get(request.set)!.session!)
  } else {
    markDoneIfPlayed(before.get(request.deletedSet)!.session!)
  }
  return expected
}

// Checks that statuses changed from `before` to `after` as `request`, if it's sent and succeeded, says, and that nothing
// else changed them: what's added is planned, and what's changed is changed by the admin, at the same time, since the
// step started, `since`.
function expectStatuses(before: Statuses, after: Statuses, request: StatusRequest | null, since: number, where: string) {
  const expected = request ? expectedStatuses(before, after, request) : null
  const at = new Set<number | null>()
  for (const [id, row] of after) {
    const was = before.get(id)
    if (!was) {
      expect(row, `${where}: ${id}, added`).toMatchObject({ status: 'planned', by: null, at: null })
      continue
    }
    const { status, changed } = expected?.get(id) ?? { status: was.status, changed: false }
    if (!changed) {
      expect(row, `${where}: ${id}, unchanged`).toEqual(was)
      continue
    }
    expect(row, `${where}: ${id}, changed`).toMatchObject({ status, by: TEST_ADMIN.email })
    expect(row.at, `${where}: when ${id} changed`).toBeGreaterThanOrEqual(since)
    at.add(row.at)
  }
  expect(at.size, `${where}: when the statuses changed`).toBeLessThanOrEqual(1)
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

// A set's or a session's application: mostly none, or else mostly one that goes with it, an application of one of the
// set's performers, or of the takeover's collective, which is found when it's sent, or else any application, by its index
// into them, which may not go with it.
type ApplicationArg = { own: boolean; index: number } | null
const Application: fc.Arbitrary<ApplicationArg> = rarely(
  fc.record({ own: fc.oneof({ arbitrary: fc.constant(true), weight: 3 }, { arbitrary: fc.constant(false), weight: 1 }), index: fc.nat() }),
)

// The id of the application that `application` stands for, among those of `owners`, by their ids, when it's one that goes
// with the set or the session.
function applicationId(context: Context, application: ApplicationArg, owners: string[]): string | null {
  if (application === null) return null
  const { applications } = context.ids
  return pick((application.own ? applications.filter(({ owner }) => owners.includes(owner)) : applications).map(({ id }) => id), application.index)
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

// Sessions over a couple of evenings, some of which last several days, and one just before the year 3000, in UTC, by
// which sessions end.
const SessionFields = fc.record({
  start: mostly<string | null>(
    fc.option(fc.constantFrom('2026-11-14T18:00-05:00', '2026-11-14T21:00-05:00', '2026-11-14T23:30-05:00', '2026-11-15T21:00-05:00', '2999-12-31T18:00-05:00')),
    fc.constant('1999-12-31T21:00-05:00'),
  ),
  durationMinutes: mostly<number>(fc.constantFrom(1, 60, 120, 240, 1440, 2880, 4320, MAX_MINUTES), fc.constantFrom(0, MAX_MINUTES + 1)),
  kind: Kind,
  application: Application,
})
type SessionArgs = typeof SessionFields extends fc.Arbitrary<infer T> ? T : never

function sessionBody(context: Context, { start, durationMinutes, kind: { type, takeover, name }, application }: SessionArgs) {
  const takeoverId = takeover === null ? null : pick(context.ids.collectives, takeover)
  return {
    start,
    durationMinutes,
    type,
    takeover: takeoverId,
    application: applicationId(context, application, takeoverId === null ? [] : [takeoverId]),
    name,
    raEvent: null,
    description: '',
  }
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

const DURATION = fc.constantFrom(1, 30, 60, 120, 240, 1440, 2880, MAX_MINUTES)

// A set's duration: mostly one, sometimes none, which isn't known yet.
const SetDuration = mostly<number | null>(
  fc.oneof({ arbitrary: DURATION, weight: 3 }, { arbitrary: fc.constant(null), weight: 1 }),
  fc.constantFrom(0, MAX_MINUTES + 1),
)

// Where a set is moved to: mostly a place among a few sets, sometimes past the last, or else not a place.
const Position = mostly<number>(
  fc.oneof({ arbitrary: fc.nat({ max: 4 }), weight: 9 }, { arbitrary: fc.constant(Number.MAX_SAFE_INTEGER), weight: 1 }),
  fc.constantFrom(-1, 1.5, 1e20),
)

const SetFields = fc
  .record({
    performers: mostly<number[]>(fc.array(fc.nat(), { minLength: 1, maxLength: 2 }), fc.constant([])),
    durationMinutes: SetDuration,
    soundcloudTrack: rarely(mostly(fc.constantFrom(...Object.keys(TRACKS).filter((link) => TRACKS[link])), fc.constant(MISSING_TRACK))),
    youtubeVideo: rarely(fc.constantFrom(...VIDEOS)),
    application: Application,
  })
type SetArgs = typeof SetFields extends fc.Arbitrary<infer T> ? T : never
type NewSessionArgs = { session: SessionArgs; sets: SetArgs[] }

function setBody(context: Context, { performers, application, ...fields }: SetArgs) {
  const performerIds = performers.map((index) => pick(context.ids.artists, index))
  return {
    ...fields,
    performers: performerIds.map((id) => ({ id })),
    application: applicationId(context, application, performerIds),
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
  const existing = async (kind: string) => {
    const { rows } = await context.database.db.execute<{ id: string }>(sql`select id from ${sql.identifier(kind)}`)
    return new Set(rows.map((row) => row.id))
  }
  for (const kind of ['sessions', 'sets', 'artists', 'collectives'] as const) {
    const ids = await existing(kind)
    context.ids[kind] = context.ids[kind].filter((id) => ids.has(id))
  }
  const applicationIds = await existing('applications')
  context.ids.applications = context.ids.applications.filter(({ id }) => applicationIds.has(id))
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

// The 409s of adding a session with `sets`: what's in the way of one of them is an earlier one, with the same track or
// video, or a set that was already there, which it names.
function newSetConflict(has: (set: SetArgs, other: SetArgs) => boolean, hasIt: (set: SetArgs) => (other: StudioSet) => boolean) {
  return (body: Body, { sets }: NewSessionArgs, context: Context) => {
    expect(body.setIndex, 'the set that fails').toBeGreaterThanOrEqual(0)
    expect(body.setIndex).toBeLessThan(sets.length)
    const set = sets[body.setIndex!]
    if (body.otherSetIndex !== undefined) {
      expect(body.otherSetIndex).toBeLessThan(body.setIndex!)
      expect(has(set, sets[body.otherSetIndex])).toBe(true)
      expect(body.session).toBeNull()
      expect(body.set).toBeNull()
    } else {
      expectSetWith(body, null, hasIt(set))
      expect(context.ids.sets, 'the set in the way, which was there already').toContain(body.set!.id)
    }
  }
}

// The fields a PATCH can send: all of them, so that a field that's added is sent too.
const SESSION_FIELD_NAMES = Object.keys(SESSION_FIELDS)
const SET_FIELD_NAMES = Object.keys(SET_FIELDS)

// Every operation, by name. A step that adds an operation adds it here.
const OPERATIONS = {
  // With up to 3 sets, all of them or nothing.
  createSession: {
    weight: 4,
    args: fc.record({ session: SessionFields, sets: fc.array(SetFields, { maxLength: 3 }) }),
    async run(context, { session, sets }) {
      const count = async () => (await context.database.db.execute<{ count: number }>(sql`select (select count(*) from sessions) + (select count(*) from sets) as count`)).rows[0].count
      const before = await count()
      const response = await sendSession(context, 'POST', '/api/admin/sessions', { ...sessionBody(context, session), sets: sets.map((set) => setBody(context, set)) })
      if (response.statusCode === 200) {
        const added = response.json().session as Session
        expect(added.sets).toHaveLength(sets.length)
        context.ids.sessions.push(added.id)
        context.ids.sets.push(...added.sets.map(({ id }) => id))
      } else {
        expect(await count(), 'what a request that failed saved').toBe(before)
        const { setIndex } = response.json() as Body
        if (setIndex !== undefined) expect(setIndex).toBeLessThan(sets.length)
      }
      return response
    },
    conflicts: {
      [SESSION_OVERLAPS]: (body, { session }) => {
        expect(body.setIndex).toBeUndefined()
        expectOverlappingSession(body.session, null, period(session.start!, session.durationMinutes))
      },
      [TRACK_TAKEN]: newSetConflict(
        (set, other) => TRACKS[set.soundcloudTrack!] === TRACKS[other.soundcloudTrack!],
        (set) => (other) => other.soundcloudTrack?.id === TRACKS[set.soundcloudTrack!],
      ),
      [VIDEO_TAKEN]: newSetConflict(
        (set, other) => set.youtubeVideo === other.youtubeVideo,
        (set) => (other) => other.youtubeVideo?.id === set.youtubeVideo,
      ),
    },
  } satisfies Operation<NewSessionArgs>,

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
    statusRequest: (context, { session, status }) => ({ session: pick(context.ids.sessions, session), status }),
    conflicts: {
      // The session is as it was, since the request failed.
      [SESSION_OVERLAPS]: async (body, { session }, context) => {
        const id = pick(context.ids.sessions, session)
        const { start, durationMinutes } = (await send(context, 'GET', `/api/admin/sessions/${id}`)).json().session as Session
        expectOverlappingSession(body.session, id, period(start!, durationMinutes))
      },
    },
  } satisfies Operation<{ session: number; status: string }>,

  // Only a session with a start can be announced, whatever its status, which the database's own constraint enforces too,
  // so that what the server doesn't refuse first fails unexpectedly.
  setAnnounced: {
    weight: 2,
    args: fc.record({ session: fc.nat(), announced: fc.boolean() }),
    run: (context, { session, announced }) => send(context, 'PUT', `/api/admin/sessions/${pick(context.ids.sessions, session)}/announced`, { announced }),
  } satisfies Operation<{ session: number; announced: boolean }>,

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

  // Changes some of the set's fields: its performers and its application are checked as they would then be, and its track
  // is only resolved when it's sent.
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
    statusRequest: (context, { set, status }) => ({ set: pick(context.ids.sets, set), status }),
    conflicts: {
      [SESSION_CANCELLED]: (body, { set }, context) => {
        expect(body.session?.status).toBe('cancelled')
        expect(body.session?.sets.map(({ id }) => id)).toContain(pick(context.ids.sets, set))
        expect(body.set).toBeNull()
      },
    },
  } satisfies Operation<{ set: number; status: string }>,

  // Moves the set to `position` among its session's sets, or last when that's past the last, the others keeping their
  // order.
  moveSet: {
    weight: 3,
    args: fc.record({ set: fc.nat(), position: Position }),
    run: async (context, { set, position }) => {
      const id = pick(context.ids.sets, set)
      const before = await send(context, 'GET', '/api/admin/sessions')
      const sessionBefore = (before.json().sessions as Session[]).find((session) => session.sets.some((other) => other.id === id))
      const response = await send(context, 'PUT', `/api/admin/sets/${id}/position`, { position })
      if (response.statusCode === 200 && sessionBefore) {
        const others = sessionBefore.sets.map((other) => other.id).filter((other) => other !== id)
        others.splice(Math.min(position, others.length), 0, id)
        expect((response.json().session as Session).sets.map((other) => other.id)).toEqual(others)
      }
      return response
    },
  } satisfies Operation<{ set: number; position: number }>,

  deleteSet: {
    weight: 1,
    args: fc.nat(),
    run: (context, set) => remove(context, `/api/admin/sets/${pick(context.ids.sets, set)}`),
    statusRequest: (context, set) => ({ deletedSet: pick(context.ids.sets, set) }),
  } satisfies Operation<number>,

  // Takes the application from its sets and sessions.
  deleteApplication: {
    weight: 1,
    args: fc.nat(),
    run: (context, application) => remove(context, `/api/admin/applications/${pick(context.ids.applications.map(({ id }) => id), application)}`),
  } satisfies Operation<number>,

  // Takes the artist out of their sets, and their applications from them.
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
  await app.register(applicationsRoutes, { store: applicationsStore(database.db), settings: applicationsSettingsStore(database.db), sessions: sessionsStore(database.db) })
  return app
}

// Empties the database, but for 4 artists, 2 collectives, an application of each, and 2 sessions of 4 hours, one of them
// announced, and the other without a date, which is the second collective's takeover, and comes from its application,
// each with 2 sets, one after the other, the first of which comes from its performer's application, so that even short
// sequences act on sets, on a collective with a takeover, on applications that sets and sessions come from, and on an
// announced session, and returns their ids, in the order they were added.
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
  const application = { dates: ['2026-11-14'], timeSlots: [], performanceTypes: [], otherPerformanceType: '', details: '' }
  const applicationRows = await database.db
    .insert(applications)
    .values([...artistIds.map((artistId) => ({ ...application, artistId })), ...collectiveIds.map((collectiveId) => ({ ...application, collectiveId }))])
    .returning({ id: applications.id, artistId: applications.artistId, collectiveId: applications.collectiveId })
  const applicationIds = applicationRows.map(({ id, artistId, collectiveId }) => ({ id, owner: (artistId ?? collectiveId)! }))
  const applicationOf = (owner: string) => applicationIds.find((candidate) => candidate.owner === owner)!.id
  const sessionRows = await database.db
    .insert(sessions)
    .values([
      { startAt: new Date('2026-11-15T02:00:00Z'), type: 'guest-mixes' as const, takeoverId: null, announced: true },
      { startAt: null, type: 'takeover' as const, takeoverId: collectiveIds[1], applicationId: applicationOf(collectiveIds[1]) },
    ].map((session) => ({ ...session, durationMinutes: 240, name: '', createdBy: 'seed' })))
    .returning({ id: sessions.id })
  const sessionIds = sessionRows.map(({ id }) => id)
  const setIds: string[] = []
  for (const sessionId of sessionIds) {
    for (const position of [0, 1]) {
      const artistId = artistIds[setIds.length % artistIds.length]
      const applicationId = position === 0 ? applicationOf(artistId) : null
      const set = { sessionId, position, durationMinutes: 60, performanceTypes: [], otherPerformanceType: '', genres: [], applicationId, createdBy: 'seed' }
      const [{ id }] = await database.db.insert(sets).values(set).returning({ id: sets.id })
      await database.db.insert(setPerformers).values({ setId: id, artistId, position: 0 })
      setIds.push(id)
    }
  }
  return { sessions: sessionIds, sets: setIds, artists: artistIds, collectives: collectiveIds, applications: applicationIds }
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

  it('hold after any sequence of requests, which never fail unexpectedly, whose 409s say what is really in the way, and which change statuses as they say', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(STEP, { maxLength: 40, size: 'max' }), async (steps) => {
        const context: Context = { app, database, cookies: await sessionCookies(), ids: await reset(database) }
        // The statuses as they are before each step, which are those the step before left.
        let before = await statuses(database)
        for (const [i, { name, args }] of steps.entries()) {
          const operation: Operation<unknown> = OPERATIONS[name] as Operation<unknown>
          const request = operation.statusRequest?.(context, args) ?? null
          const since = Date.now()
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
          const after = await statuses(database)
          expectStatuses(before, after, response.statusCode === 200 ? request : null, since, where)
          before = after
        }
      }),
      { numRuns: numberFromEnv('FC_NUM_RUNS') ?? 200, seed: numberFromEnv('FC_SEED'), path: process.env.FC_PATH },
    )
  })
})
