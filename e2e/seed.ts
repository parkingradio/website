// Fills a Parking Radio server with the development data of seed-data.ts, through its HTTP API. The end-to-end tests run
// against it (see global-setup.ts), and `npm run seed` fills the dev server with it: see "Seed data" in the README for
// what it does, and doesn't.

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import type { components, paths } from '../client/src/api/schema.d.ts'
import { addDays, quebecDateTime, quebecDayAndTime, quebecInstant } from '../client/src/quebec-time.ts'
import { SEED_ARTISTS, SEED_COLLECTIVES, SEED_SESSIONS } from './seed-data.ts'
import type { Profile, SeedApplication, SeedArtist, SeedCollective, SeedMember, SeedSession } from './seed-data.ts'

export type Credentials = { email: string; password: string }

type ArtistResponse = paths['/api/admin/artists']['post']['responses'][200]['content']['application/json']
type CollectiveResponse = paths['/api/admin/collectives']['post']['responses'][200]['content']['application/json']
type ArtistsResponse = paths['/api/admin/artists']['get']['responses'][200]['content']['application/json']
type CollectivesResponse = paths['/api/admin/collectives']['get']['responses'][200]['content']['application/json']
type ApplicationsResponse = paths['/api/admin/applications']['get']['responses'][200]['content']['application/json']
type ApplicationResponse = paths['/api/admin/applications']['post']['responses'][200]['content']['application/json']
type NewApplication = paths['/api/admin/applications']['post']['requestBody']['content']['application/json']
type ApplicationStatus = components['schemas']['ApplicationStatus']
type SessionsResponse = paths['/api/admin/sessions']['get']['responses'][200]['content']['application/json']
type SessionResponse = paths['/api/admin/sessions']['post']['responses'][200]['content']['application/json']
type NewSession = paths['/api/admin/sessions']['post']['requestBody']['content']['multipart/form-data']['session']
type NewSet = paths['/api/admin/sessions/{id}/sets']['post']['requestBody']['content']['application/json']
type ApiError = components['schemas']['ApiError']

export type SeedOptions = {
  // Where the server is, e.g. "http://localhost:3000".
  url: string
  // The admin to log in as.
  credentials: Credentials
}

// Where the seed's requests come from, as far as the server's rate limits are concerned (see
// server/src/api/client-address.ts): one address for the admin's requests, apart from the developer's browser, and one
// for each artist or collective who applies through the form, since an address can only apply a few times an hour. They're in
// 192.0.2.0/24, apart from those the tests use.
const LOGIN_ADDRESS = '192.0.2.1'
const formAddress = (nth: number) => `192.0.2.${10 + nth}`

// The token Cloudflare's test site key gives, which its test secret key accepts.
export const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

const DAY_MS = 24 * 60 * 60 * 1000

// Seeds every artist of SEED_ARTISTS who isn't there yet, with their applications, then every collective of
// SEED_COLLECTIVES that isn't there yet, then the sessions of SEED_SESSIONS, with their sets, if there are no sessions
// yet, and returns the names of the artists and collectives seeded and skipped, and how many sessions were seeded. An
// artist is there when another one has their email, whatever its case, or, for an artist without one, when another one
// without an email has their name, whatever its case, and likewise for a collective. Sessions are seeded only while
// there are none, since their days, counted from the day they're seeded, would otherwise overlap those seeded before.
export async function seed({ url, credentials }: SeedOptions): Promise<{ seeded: string[]; skipped: string[]; sessions: number }> {
  const server = await logIn(url, credentials)
  const there = new Set((await server.call<ArtistsResponse>('GET', '/api/admin/artists')).artists.map(seedKey))
  const seeded: string[] = []
  const skipped: string[] = []
  let applied = 0
  for (const artist of SEED_ARTISTS) {
    if (there.has(seedKey(artist.profile))) {
      skipped.push(artist.profile.name)
      continue
    }
    let artistId = artist.form ? undefined : await addArtist(server, artist)
    if (artist.form) await apply(server, { kind: 'artist', ...artist.profile }, artist, formAddress(applied++))
    try {
      if (artistId === undefined) {
        // Applying through the form created the artist along with their first application.
        const applied = await findApplied(server, artist)
        artistId = applied.artistId
        await setStatus(server, applied.applicationId, artist.applications[0].status)
      }
      for (const application of artist.form ? artist.applications.slice(1) : artist.applications) await addApplication(server, { artistId }, application)
    } catch (error) {
      // Otherwise every later seed would skip the artist, because they're there.
      throw new Error(`${messageOf(error)}\n${artist.profile.name} was left incomplete. To seed them again, delete them first.`, { cause: error })
    }
    seeded.push(artist.profile.name)
  }

  const artistIds = new Map((await server.call<ArtistsResponse>('GET', '/api/admin/artists')).artists.map((artist) => [seedKey(artist), artist.id]))
  const { collectives } = await server.call<CollectivesResponse>('GET', '/api/admin/collectives')
  const collectivesThere = new Set(collectives.map(seedKey))
  for (const collective of SEED_COLLECTIVES) {
    if (collectivesThere.has(seedKey(collective.profile))) {
      skipped.push(collective.profile.name)
      continue
    }
    let collectiveId = collective.form ? undefined : await addCollective(server, collective, artistIds)
    if (collective.form) await apply(server, applicant(collective, collective.form), collective, formAddress(applied++), collective.form)
    try {
      if (collectiveId === undefined) {
        // Applying through the form created the collective along with its first application.
        const applied = await findAppliedCollective(server, collective)
        collectiveId = applied.collectiveId
        await setStatus(server, applied.applicationId, collective.applications[0].status)
      }
      for (const application of collective.form ? collective.applications.slice(1) : collective.applications) {
        await addApplication(server, { collectiveId }, application)
      }
    } catch (error) {
      throw new Error(`${messageOf(error)}\n${collective.profile.name} was left incomplete. To seed it again, delete it first.`, { cause: error })
    }
    seeded.push(collective.profile.name)
  }

  const { sessions } = await server.call<SessionsResponse>('GET', '/api/admin/sessions')
  if (sessions.length > 0) return { seeded, skipped, sessions: 0 }
  const [{ artists }, { collectives: allCollectives }] = await Promise.all([
    server.call<ArtistsResponse>('GET', '/api/admin/artists'),
    server.call<CollectivesResponse>('GET', '/api/admin/collectives'),
  ])
  const collectiveIds = new Map(allCollectives.map((collective) => [seedKey(collective), collective.id]))
  // Including those the collectives were seeded with.
  const performerIds = new Map(artists.map((artist) => [seedKey(artist), artist.id]))
  for (const [i, session] of SEED_SESSIONS.entries()) {
    try {
      await addSession(server, session, performerIds, collectiveIds)
    } catch (error) {
      throw new Error(`${messageOf(error)}\nOnly ${i} of the sessions were seeded. To seed them again, delete them first.`, { cause: error })
    }
  }
  return { seeded, skipped, sessions: SEED_SESSIONS.length }
}

// What tells whether an artist, or a collective, is there already (see `seed`).
function seedKey({ email, name }: Pick<Profile, 'email' | 'name'>): string {
  return email ? `email:${email.toLowerCase()}` : `name:${name.toLowerCase()}`
}

// The `seedKey` of an artist or a collective that seed-data.ts names by their email, or by their name for those without
// one.
function seedKeyOf(emailOrName: string): string {
  return seedKey(emailOrName.includes('@') ? { email: emailOrName, name: '' } : { email: null, name: emailOrName })
}

type Server = {
  url: string
  // Sends a request with the admin's session, and returns the response's body, throwing unless it succeeded.
  call<T>(method: string, path: string, body?: object | FormData): Promise<T>
}

async function logIn(url: string, { email, password }: Credentials): Promise<Server> {
  const response = await request(url, 'POST', '/api/auth/login', { email, password }, { 'CF-Connecting-IP': LOGIN_ADDRESS })
  // Only the cookie's name and value: the rest is for browsers. Its name depends on how the server runs, e.g. it has
  // the port in it in development.
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0]
  if (!cookie) throw new Error('Logging in gave no session cookie')
  return {
    url,
    async call<T>(method: string, path: string, body?: object | FormData) {
      return (await (await request(url, method, path, body, { 'CF-Connecting-IP': LOGIN_ADDRESS, Cookie: cookie })).json()) as T
    },
  }
}

// Sends a request, and returns the response, throwing unless it succeeded. An object body is sent as JSON.
async function request(url: string, method: string, path: string, body: object | FormData | undefined, headers: Record<string, string>) {
  const json = body !== undefined && !(body instanceof FormData)
  const response = await fetch(`${url}${path}`, {
    method,
    headers: json ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: json ? JSON.stringify(body) : body,
  })
  if (!response.ok) {
    const error = ((await response.json().catch(() => null)) as ApiError | null)?.error
    throw new Error(`${method} ${path}: HTTP ${response.status}${error ? `: ${error}` : ''}`)
  }
  return response
}

// Adds the artist as an admin would, and returns their id.
async function addArtist(server: Server, artist: SeedArtist): Promise<string> {
  const form = new FormData()
  form.set('artist', JSON.stringify(artist.profile))
  if (artist.photo) form.set('photo', photo(artist.photo), 'photo.png')
  return (await server.call<ArtistResponse>('POST', '/api/admin/artists', form)).artist.id
}

// Adds the collective as an admin would, with its members: the seeded artists' ids, by `seedKey`, in `artistIds`, and
// new ones, by name, and returns its id.
async function addCollective(server: Server, collective: Extract<SeedCollective, { form?: undefined }>, artistIds: Map<string, string>): Promise<string> {
  const members = collective.members.map((member) => {
    if ('name' in member) return member
    const artist = SEED_ARTISTS.find(({ profile }) => (profile.email ?? profile.name) === member.seeded)
    const id = artist && artistIds.get(seedKey(artist.profile))
    if (!id) throw new Error(`${collective.profile.name}: ${member.seeded} isn't an artist who was seeded`)
    return { id }
  })
  const form = new FormData()
  form.set('collective', JSON.stringify({ ...collective.profile, members }))
  if (collective.photo) form.set('photo', photo(collective.photo), 'photo.png')
  return (await server.call<CollectiveResponse>('POST', '/api/admin/collectives', form)).collective.id
}

// Who a collective that applies through the form is, as the form sends it: its profile, with the artists it applies with.
function applicant(collective: SeedCollective, members: SeedMember[]) {
  return { kind: 'collective', ...collective.profile, members: members.map((member) => member.profile) }
}

// Has an artist or a collective apply through the form, from `address`, as `applicant`, with their photo, the photos of
// the collective's `members`, if any, and their first application.
async function apply(
  server: Server,
  applicant: object,
  { photo: colour, applications }: SeedArtist | SeedCollective,
  address: string,
  members: SeedMember[] = [],
): Promise<void> {
  const form = new FormData()
  form.set('artist', JSON.stringify(applicant))
  form.set('application', JSON.stringify(applicationFields(applications[0])))
  if (colour) form.set('photo', photo(colour), 'photo.png')
  // A part for each artist, up to the last one with a photo, and an empty one for an artist without a photo.
  const last = members.findLastIndex((member) => member.photo)
  for (const member of members.slice(0, last + 1)) form.append('memberPhoto', member.photo ? photo(member.photo) : new Blob(), 'photo.png')
  form.set('turnstileToken', TURNSTILE_TOKEN)
  // Without the session: artists don't have one.
  await request(server.url, 'POST', '/api/applications', form, { 'CF-Connecting-IP': address })
}

// The id of an artist who applied through the form, and of the application they sent, which the form doesn't return.
async function findApplied(server: Server, artist: SeedArtist): Promise<{ artistId: string; applicationId: string }> {
  const { artists } = await server.call<ArtistsResponse>('GET', '/api/admin/artists')
  const added = artists.find((added) => seedKey(added) === seedKey(artist.profile))
  if (!added) throw new Error(`${artist.profile.name} applied, but wasn't added`)
  return { artistId: added.id, applicationId: await firstApplication(server, `artist=${added.id}`) }
}

// The id of a collective that applied through the form, and of the application it sent, which the form doesn't return.
async function findAppliedCollective(server: Server, collective: SeedCollective): Promise<{ collectiveId: string; applicationId: string }> {
  const { collectives } = await server.call<CollectivesResponse>('GET', '/api/admin/collectives')
  const added = collectives.find((added) => seedKey(added) === seedKey(collective.profile))
  if (!added) throw new Error(`${collective.profile.name} applied, but wasn't added`)
  return { collectiveId: added.id, applicationId: await firstApplication(server, `collective=${added.id}`) }
}

// The id of the only application of whoever `query` says, e.g. "artist=<id>".
async function firstApplication(server: Server, query: string): Promise<string> {
  const { applications } = await server.call<ApplicationsResponse>('GET', `/api/admin/applications?${query}`)
  return applications[0].id
}

// Adds an application for the artist or the collective, as an admin would, with its status.
async function addApplication(server: Server, owner: { artistId: string } | { collectiveId: string }, application: SeedApplication): Promise<void> {
  const body: NewApplication = { ...applicationFields(application), ...owner }
  if (application.receivedDaysAgo !== undefined) body.receivedAt = quebecDateTime(new Date(Date.now() - application.receivedDaysAgo * DAY_MS))
  const { id } = (await server.call<ApplicationResponse>('POST', '/api/admin/applications', body)).application
  await setStatus(server, id, application.status)
}

// Gives an application its status, which is "new" until then.
async function setStatus(server: Server, id: string, status: ApplicationStatus): Promise<void> {
  if (status !== 'new') await server.call('PUT', `/api/admin/applications/${id}/status`, { status })
}

// The id of the application of the artist or the collective whose days are `days` (see `SeedApplication`), or null when
// they have none, e.g. when they were seeded on another day, from which its days were counted.
async function applicationWithDays(server: Server, owner: { artist: string } | { collective: string }, days: number[]): Promise<string | null> {
  const { applications } = await server.call<ApplicationsResponse>('GET', `/api/admin/applications?${new URLSearchParams(owner)}`)
  // The server sorts them.
  const dates = days.map(day).sort().join()
  return applications.find((application) => application.dates.join() === dates)?.id ?? null
}

// The id of the application of one of `performers` whose days are `days`, or null when none of them has one (see
// `applicationWithDays`).
async function performersApplication(server: Server, performers: { id: string }[], days: number[]): Promise<string | null> {
  for (const { id } of performers) {
    const found = await applicationWithDays(server, { artist: id }, days)
    if (found) return found
  }
  return null
}

// Adds the session and its sets as an admin would, with their statuses: its takeover's collective, in `collectiveIds`, and
// its sets' performers, in `artistIds`, each by their email, or else, for those without one, by their name (see
// `seedKey`), and the applications they come from, unless they can't be found (see `applicationWithDays`). Each set is
// given its status once it's added, and the session once its sets are, since a cancelled session can't be added to.
async function addSession(server: Server, session: SeedSession, artistIds: Map<string, string>, collectiveIds: Map<string, string>): Promise<void> {
  const takeover = session.takeover === undefined ? null : collectiveIds.get(seedKeyOf(session.takeover))
  if (takeover === undefined) throw new Error(`A session's takeover, ${session.takeover}, isn't a collective that was seeded`)
  const application = takeover && session.application ? await applicationWithDays(server, { collective: takeover }, session.application) : null
  let start: string | null = null
  if (session.when) {
    // The day in Québec, then the time there, as the admin pages take them.
    const day = addDays(quebecDayAndTime(new Date()).day, session.when.day)
    const instant = quebecInstant(day, session.when.start)
    if (!instant) throw new Error(`A session's start, ${session.when.start}, doesn't exist on ${day} in Québec`)
    start = quebecDateTime(instant)
  }
  const fields: NewSession = {
    start,
    durationMinutes: session.durationMinutes,
    type: session.type,
    takeover,
    application,
    name: session.name ?? '',
    raEvent: session.raEvent ?? null,
    description: session.description ?? '',
  }
  const form = new FormData()
  form.set('session', JSON.stringify(fields))
  if (session.flyer) form.set('flyer', photo(session.flyer), 'flyer.png')
  const { id } = (await server.call<SessionResponse>('POST', '/api/admin/sessions', form)).session

  const added = new Set<string>()
  for (const set of session.sets) {
    const performers = set.performers.map((key) => {
      const id = artistIds.get(seedKeyOf(key))
      if (!id) throw new Error(`A set's performer, ${key}, isn't an artist who was seeded`)
      return { id }
    })
    const fields: NewSet = {
      performers,
      offsetMinutes: set.offsetMinutes,
      durationMinutes: set.durationMinutes,
      performanceTypes: set.performanceTypes ?? [],
      otherPerformanceType: set.otherPerformanceType ?? '',
      genres: set.genres ?? [],
      soundcloudTrack: null,
      youtubeVideo: set.youtubeVideo ?? null,
      application: set.application ? await performersApplication(server, performers, set.application) : null,
    }
    const { sets } = (await server.call<SessionResponse>('POST', `/api/admin/sessions/${id}/sets`, fields)).session
    // The set just added, the one that wasn't there before.
    const setId = sets.find((other) => !added.has(other.id))!.id
    added.add(setId)
    if (set.status !== 'planned') await server.call('PUT', `/api/admin/sets/${setId}/status`, { status: set.status })
  }
  if (session.status !== 'planned') await server.call('PUT', `/api/admin/sessions/${id}/status`, { status: session.status })
}

function applicationFields({ days, timeSlots, performanceTypes, otherPerformanceType, details }: SeedApplication) {
  return { dates: days.map(day), timeSlots, performanceTypes, otherPerformanceType, details }
}

// The day that's `offset` days after today (before, if negative), as "YYYY-MM-DD", in local time.
export function day(offset: number): string {
  const today = new Date()
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// A photo: a square PNG of one colour, e.g. "#e4572e".
function photo(colour: string): Blob {
  const SIZE = 64
  const pixel = Buffer.from(colour.slice(1), 'hex')
  // Each row of pixels starts with its filter type, 0 for none.
  const row = Buffer.concat([Buffer.from([0]), ...Array<Buffer>(SIZE).fill(pixel)])
  const chunk = (type: string, data: Buffer) => {
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typeAndData))
    return Buffer.concat([length, typeAndData, crc])
  }
  // Width, height, 8 bits per channel, RGB, then the default compression, filtering and no interlacing.
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array<Buffer>(SIZE).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return new Blob([png], { type: 'image/png' })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// From the command line: seeds the dev server.

const ROOT = path.join(import.meta.dirname, '..')
const SEED_ADMIN = 'seed@example.com'

// Creates the seed's admin in the dev server's database, or gives them a new password if they're there already, the way
// the integration tests create theirs (see integration-tests/stack.sh).
async function seedAdmin(url: string): Promise<Credentials> {
  const created = spawnSync('npm', ['run', '--silent', 'create-admin', '-w', 'server', '--', SEED_ADMIN], { cwd: ROOT, encoding: 'utf8' })
  const token = /accept-invite\?token=([0-9a-f]+)/.exec(created.stdout)?.[1]
  if (created.status !== 0 || !token) throw new Error(`Couldn't create the seed's admin:\n${created.stdout}${created.stderr}`)
  const password = randomBytes(16).toString('hex')
  await request(url, 'POST', '/api/auth/accept-invite', { token, password }, {})
  return { email: SEED_ADMIN, password }
}

if (import.meta.main) {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    console.error('seed: there is no .env: create it from .env.example (see the README)')
    process.exit(1)
  }
  // The server would email every application sent through the form to example.com's addresses.
  if (process.env.MAIL_DOMAIN) {
    console.error('seed: MAIL_DOMAIN is set, so the server would send emails: seed without it')
    process.exit(1)
  }
  // The port the dev server listens on (see `port` in server/src/core/config.ts).
  const url = `http://localhost:${process.env.SERVER_PORT || process.env.PORT || 3000}`
  const healthy = await fetch(`${url}/healthz`).then((response) => response.ok, () => false)
  if (!healthy) {
    console.error(`seed: the dev server doesn't answer at ${url}: start it with \`npm run dev\``)
    process.exit(1)
  }
  try {
    const { seeded, skipped, sessions } = await seed({ url, credentials: await seedAdmin(url) })
    console.log(`Seeded ${seeded.length} artists and collectives, and skipped ${skipped.length} that were already there.`)
    console.log(sessions > 0 ? `Seeded ${sessions} sessions, with their sets.` : 'Seeded no sessions, since there were some already.')
  } catch (error) {
    console.error(`seed: ${messageOf(error)}`)
    process.exitCode = 1
  }
}
