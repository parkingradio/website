import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { multipartBody } from '../api/test-multipart.js'
import { sessionCookies } from '../admins/test-sessions.js'
import type { TestDatabase } from '../db/test-database.js'
import type { TrackRead } from './soundcloud.js'
import type { TrackState } from './track-states.js'
import { resetRotation, rotationTestApp } from './test-rotation.js'
import type { RotationTestApp } from './test-rotation.js'
import type { TrackReads } from './track-reads.js'

// Property-based tests of what the rotation of sets makes public (see "The rotation of sets" in
// docs/design/server/radio.md, and "What's public" in events.md), against a real database: random sequences of changes to
// the rotation, its sets, their sessions and their tracks, and of time passing, after each of which `GET /api/on-air` must
// only give sets that are in the rotation and can be played, never a private link, and must give one whenever there's
// one, as the admin endpoint does. The rules of what's on air themselves are tested on their own, in rotation.test.ts.
//
// FC_SEED and FC_PATH replay a failure, as fast-check prints them, and FC_NUM_RUNS changes how many sequences are tried,
// 20 by default, since the rules carry most of the weight.

const HOUR = 60 * 60 * 1000
const SESSIONS = 2
const SETS_PER_SESSION = 3

// What SoundCloud says of each track, by link, which the operations change.
const states = new Map<string, TrackState>()
const readTrack = async (link: string): Promise<TrackRead> => {
  const state = states.get(link) ?? 'playable'
  return { state, durationMs: state === 'missing' ? null : HOUR, secretToken: /\/(s-[^/]+)$/.exec(link)?.[1] ?? null }
}
let testApp: RotationTestApp
let database: TestDatabase
let app: FastifyInstance
let reads: TrackReads

beforeAll(async () => {
  testApp = await rotationTestApp(readTrack)
  ;({ database, app, reads } = testApp)
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

function numberFromEnv(name: string): number | undefined {
  return process.env[name] ? Number(process.env[name]) : undefined
}

async function request(method: string, url: string, payload?: object) {
  return app.inject({ method: method as 'GET', url, payload, cookies: await sessionCookies() })
}

// What each run starts from: sessions of sets, each with a private track and a video, all announced, and an empty
// rotation.
type World = { sessions: string[]; sets: string[]; links: string[] }

async function setUp(): Promise<World> {
  await resetRotation(testApp)
  states.clear()
  const artist = JSON.stringify({ name: 'Ana', country: 'CA', city: '', genres: [], bio: '', links: {}, phone: '', email: null })
  const created = await app.inject({ method: 'POST', url: '/api/admin/artists', ...multipartBody({ artist }), cookies: await sessionCookies() })
  const performer = created.json().artist.id
  const world: World = { sessions: [], sets: [], links: [] }
  for (let s = 0; s < SESSIONS; s++) {
    const sets = Array.from({ length: SETS_PER_SESSION }, (_, i) => ({
      performers: [{ id: performer }],
      durationMinutes: 60,
      performanceTypes: [],
      otherPerformanceType: '',
      genres: [],
      soundcloudTrack: `https://soundcloud.com/parking/set-${s}-${i}/s-SeCrEt${s}${i}`,
      youtubeVideo: `vid${s}${i}`.padEnd(11, 'x'),
      application: null,
    }))
    const session = JSON.stringify({ start: `2026-10-0${s + 1}T21:00-04:00`, durationMinutes: 600, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '', sets })
    const response = await app.inject({ method: 'POST', url: '/api/admin/sessions', ...multipartBody({ session }), cookies: await sessionCookies() })
    const added = response.json().session as { id: string; sets: { id: string; soundcloudTrack: { url: string } }[] }
    await request('PUT', `/api/admin/sessions/${added.id}/announced`, { announced: true })
    world.sessions.push(added.id)
    for (const set of added.sets) {
      world.sets.push(set.id)
      world.links.push(set.soundcloudTrack.url)
    }
  }
  return world
}

const set = fc.nat(SESSIONS * SETS_PER_SESSION - 1)
const session = fc.nat(SESSIONS - 1)

// The operations, as plain data, which `run` sends.
const operation = fc.oneof(
  fc.record({ kind: fc.constant('rotation' as const), sets: fc.uniqueArray(set, { maxLength: SESSIONS * SETS_PER_SESSION }) }),
  fc.record({ kind: fc.constant('status' as const), set, status: fc.constantFrom('planned', 'done', 'cancelled') }),
  fc.record({ kind: fc.constant('announced' as const), session, announced: fc.boolean() }),
  fc.record({ kind: fc.constant('video' as const), set, removed: fc.boolean() }),
  fc.record({ kind: fc.constant('delete' as const), set }),
  fc.record({ kind: fc.constant('track' as const), set, state: fc.constantFrom<TrackState>('playable', 'preview', 'missing', 'blocked') }),
  fc.record({ kind: fc.constant('time' as const), minutes: fc.integer({ min: 1, max: 6 * 60 }) }),
)
type Operation = typeof operation extends fc.Arbitrary<infer T> ? T : never

async function run(world: World, op: Operation) {
  switch (op.kind) {
    case 'rotation':
      return request('PUT', '/api/admin/radio/rotation', { sets: op.sets.map((i) => world.sets[i]) })
    case 'status':
      return request('PUT', `/api/admin/sets/${world.sets[op.set]}/status`, { status: op.status })
    case 'announced':
      return request('PUT', `/api/admin/sessions/${world.sessions[op.session]}/announced`, { announced: op.announced })
    case 'video':
      return request('PATCH', `/api/admin/sets/${world.sets[op.set]}`, { youtubeVideo: op.removed ? null : `vid${op.set}`.padEnd(11, 'y') })
    case 'delete':
      return request('DELETE', `/api/admin/sets/${world.sets[op.set]}`)
    case 'track':
      states.set(world.links[op.set], op.state)
      // Every track is due to be read again.
      await database.db.execute(sql`update soundcloud_track_reads set read_at = read_at - interval '2 hours'`)
      await reads.readDue()
      return null
    case 'time':
      await database.db.execute(sql`update radio_rotation set on_air_started_at = on_air_started_at - ${`${op.minutes} minutes`}::interval`)
      return null
  }
}

// The sets of the rotation that can be played, worked out from the tables, apart from the server's own rules.
async function playable(): Promise<Set<string>> {
  const { rows } = await database.db.execute<{ id: string }>(sql`
    select sets.id from rotation_sets
      join sets on sets.id = rotation_sets.set_id
      join sessions on sessions.id = sets.session_id
      join soundcloud_track_reads reads on reads.track_id = sets.soundcloud_track_id and reads.link = sets.soundcloud_track_url
    where sets.status <> 'cancelled' and sets.youtube_video_id is not null and sessions.announced and reads.state = 'playable'`)
  return new Set(rows.map(({ id }) => id))
}

describe('what the rotation of sets makes public', () => {
  it('is only ever sets of the rotation that can be played, without private links, and one whenever there is one', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(operation, { minLength: 1, maxLength: 15 }), async (operations) => {
        const world = await setUp()
        for (const op of operations) {
          const response = await run(world, op)
          if (response) expect([200, 400, 404, 409], `${JSON.stringify(op)}: ${response.body}`).toContain(response.statusCode)

          const onAir = await app.inject({ method: 'GET', url: '/api/on-air?upcoming=20' })
          expect(onAir.statusCode, onAir.body).toBe(200)
          expect(onAir.body).not.toContain('SeCrEt')
          const { current, upcoming } = onAir.json() as { current: { set: { id: string } } | null; upcoming: { set: { id: string } }[] }
          const allowed = await playable()
          for (const { set: given } of [...(current ? [current] : []), ...upcoming]) expect(allowed, JSON.stringify(op)).toContain(given.id)
          expect(current !== null, JSON.stringify(op)).toBe(allowed.size > 0)
          const rotation = (await request('GET', '/api/admin/radio/rotation')).json()
          expect(rotation.current?.setId ?? null).toBe(current?.set.id ?? null)
        }
      }),
      { numRuns: numberFromEnv('FC_NUM_RUNS') ?? 20, seed: numberFromEnv('FC_SEED'), path: process.env.FC_PATH },
    )
  })
})
