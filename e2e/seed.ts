// Fills a Parking Radio server with the development data of seed-data.ts, through its HTTP API. The end-to-end tests run
// against it (see global-setup.ts), and `npm run seed` fills the dev server with it: see "Seed data" in the README for
// what it does, and doesn't.

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import type { components, paths } from '../client/src/api/schema.d.ts'
import { SEED_ARTISTS } from './seed-data.ts'
import type { Profile, SeedApplication, SeedArtist } from './seed-data.ts'

export type Credentials = { email: string; password: string }

type ArtistResponse = paths['/api/admin/artists']['post']['responses'][200]['content']['application/json']
type ArtistsResponse = paths['/api/admin/artists']['get']['responses'][200]['content']['application/json']
type ApplicationsResponse = paths['/api/admin/applications']['get']['responses'][200]['content']['application/json']
type ApplicationResponse = paths['/api/admin/applications']['post']['responses'][200]['content']['application/json']
type NewApplication = paths['/api/admin/applications']['post']['requestBody']['content']['application/json']
type ApplicationStatus = components['schemas']['ApplicationStatus']
type ApiError = components['schemas']['ApiError']

export type SeedOptions = {
  // Where the server is, e.g. "http://localhost:3000".
  url: string
  // The admin to log in as.
  credentials: Credentials
}

// Where the seed's requests come from, as far as the server's rate limits are concerned (see
// server/src/api/client-address.ts): one address for the admin's requests, apart from the developer's browser, and one
// for each artist who applies through the form, since an address can only apply a few times an hour. They're in
// 192.0.2.0/24, apart from those the tests use.
const LOGIN_ADDRESS = '192.0.2.1'
const formAddress = (nth: number) => `192.0.2.${10 + nth}`

// The token Cloudflare's test site key gives, which its test secret key accepts.
const TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

const DAY_MS = 24 * 60 * 60 * 1000

// Seeds every artist of SEED_ARTISTS who isn't there yet, with their applications, and returns the names of those seeded
// and skipped. An artist is there when another one has their email, whatever its case, or, for an artist without one,
// when another one without an email has their name, whatever its case.
export async function seed({ url, credentials }: SeedOptions): Promise<{ seeded: string[]; skipped: string[] }> {
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
    if (artist.form) await apply(server, artist, formAddress(applied++))
    try {
      if (artistId === undefined) {
        // Applying through the form created the artist along with their first application.
        const applied = await findApplied(server, artist)
        artistId = applied.artistId
        await setStatus(server, applied.applicationId, artist.applications[0].status)
      }
      for (const application of artist.form ? artist.applications.slice(1) : artist.applications) await addApplication(server, artistId, application)
    } catch (error) {
      // Otherwise every later seed would skip the artist, because they're there.
      throw new Error(`${messageOf(error)}\n${artist.profile.name} was left incomplete. To seed them again, delete them first.`, { cause: error })
    }
    seeded.push(artist.profile.name)
  }
  return { seeded, skipped }
}

// What tells whether an artist is there already (see `seed`).
function seedKey({ email, name }: Pick<Profile, 'email' | 'name'>): string {
  return email ? `email:${email.toLowerCase()}` : `name:${name.toLowerCase()}`
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

// Has the artist apply through the form, from `address`, with their first application.
async function apply(server: Server, artist: SeedArtist, address: string): Promise<void> {
  const form = new FormData()
  form.set('artist', JSON.stringify(artist.profile))
  form.set('application', JSON.stringify(applicationFields(artist.applications[0])))
  if (artist.photo) form.set('photo', photo(artist.photo), 'photo.png')
  form.set('turnstileToken', TURNSTILE_TOKEN)
  // Without the session: artists don't have one.
  await request(server.url, 'POST', '/api/applications', form, { 'CF-Connecting-IP': address })
}

// The id of an artist who applied through the form, and of the application they sent, which the form doesn't return.
async function findApplied(server: Server, artist: SeedArtist): Promise<{ artistId: string; applicationId: string }> {
  const { artists } = await server.call<ArtistsResponse>('GET', '/api/admin/artists')
  const added = artists.find((added) => seedKey(added) === seedKey(artist.profile))
  if (!added) throw new Error(`${artist.profile.name} applied, but wasn't added`)
  const { applications } = await server.call<ApplicationsResponse>('GET', `/api/admin/applications?artist=${added.id}`)
  return { artistId: added.id, applicationId: applications[0].id }
}

// Adds an application for the artist, as an admin would, with its status.
async function addApplication(server: Server, artistId: string, application: SeedApplication): Promise<void> {
  const body: NewApplication = { ...applicationFields(application), artistId }
  if (application.receivedDaysAgo !== undefined) body.receivedAt = new Date(Date.now() - application.receivedDaysAgo * DAY_MS).toISOString()
  const { id } = (await server.call<ApplicationResponse>('POST', '/api/admin/applications', body)).application
  await setStatus(server, id, application.status)
}

// Gives an application its status, which is "new" until then.
async function setStatus(server: Server, id: string, status: ApplicationStatus): Promise<void> {
  if (status !== 'new') await server.call('PUT', `/api/admin/applications/${id}/status`, { status })
}

function applicationFields({ days, timeSlots, prestations, otherPrestation, details }: SeedApplication) {
  return { dates: days.map(day), timeSlots, prestations, otherPrestation, details }
}

// The day that's `offset` days after today (before, if negative), as "YYYY-MM-DD", in local time.
function day(offset: number): string {
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
    const { seeded, skipped } = await seed({ url, credentials: await seedAdmin(url) })
    console.log(`Seeded ${seeded.length} artists, and skipped ${skipped.length} who were already there.`)
  } catch (error) {
    console.error(`seed: ${messageOf(error)}`)
    process.exitCode = 1
  }
}
