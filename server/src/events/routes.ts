import type { FastifyInstance } from 'fastify'
import { decodeHTML } from 'entities'
import { z } from 'zod'
import { Day, TIME_OF_DAY, fromBeforeTo, instantIn, startRange } from '../api/formats.js'
import { ApiError, Timestamp, firstIssue, zodRoutes } from '../api/schemas.js'
import { cached } from '../core/cache.js'
import { RA_ORIGIN, RA_PROMOTER_ID } from './ra.js'

// Events are managed on Resident Advisor, under Parking Radio's promoter page. RA has no public API, so
// this uses the GraphQL endpoint that ra.co itself calls. It isn't documented and could change. We don't
// normally favour calling private APIs, but this is the only way to implement what we need. We try to
// mitigate the brittleness of the setup by validating our expectations of what GraphQL returns and failing
// loudly when they are not satisfied.

// How many past events the response has without `from` and `to`, the most recent.
const RECENT_PAST_EVENTS = 20
// RA only returns 10 upcoming events, and 50 past ones, unless asked for more, so ask for far more than we ever schedule
// at once, and than we've ever had, which is about 150 a year. Getting that many back fails the fetch, since the list is
// then probably cut short.
const UPCOMING_EVENTS_LIMIT = 100
const PAST_EVENTS_LIMIT = 2000
const CACHE_TTL_MS = 2 * 60 * 1000

const RA_QUERY = `
  query ($id: ID!, $upcomingLimit: Int, $pastLimit: Int) {
    promoter(id: $id) {
      contentUrl
      upcoming: events(type: LATEST, limit: $upcomingLimit) { ...event }
      past: events(type: PREVIOUS, limit: $pastLimit) { ...event }
    }
  }
  fragment event on Event {
    id
    title
    startTime
    endTime
    contentUrl
    venue { name area { name ianaTimeZone } }
    lineup
    artists { name }
    images { filename type }
  }
`

// The API's response (see docs/design/server/events.md). It checks no more than RaResponse does, e.g. its strings are
// plain strings, so that every answer from RA that RaResponse accepts makes a valid response, rather than failing with
// 500.
const Event = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.enum(['synth-meetup', 'other']),
    start: Timestamp,
    end: Timestamp.nullable(),
    venue: z.string().nullable(),
    city: z.string().nullable(),
    lineup: z.array(z.string()),
    url: z.string(),
    flyer: z.string().nullable(),
  })
  .meta({ id: 'Event' })
type Event = z.infer<typeof Event>

const Events = z
  .object({
    promoterUrl: z.string(),
    upcoming: z.array(Event).meta({ description: 'The soonest first' }),
    past: z.array(Event).meta({ description: `The most recent first: without \`from\` and \`to\`, only the ${RECENT_PAST_EVENTS} most recent` }),
  })
  .meta({ id: 'Events' })
type Events = z.infer<typeof Events>

// RA gives local times, without an offset, e.g. "2026-09-25T18:00:00.000", which are cut to the minute: whatever follows
// is ignored. The day and the time have to exist, e.g. not February 30, rather than roll over.
const raLocalTime = z
  .string()
  .transform((time) => time.slice(0, 16))
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .refine((time) => Day.safeParse(time.slice(0, 10)).success && TIME_OF_DAY.test(time.slice(11)), 'Invalid local date and time'),
  )

// RA's response is checked against these schemas rather than trusted. Anything that doesn't match fails
// the whole fetch, even a single event, so that the page shows an error and we get it fixed rather than
// silently showing an incomplete list. Fields we can do without are defaulted instead of rejected.
const RaEvent = z.object({
  id: z.string(),
  title: z.string(),
  startTime: raLocalTime,
  endTime: raLocalTime.nullish(),
  // Checked to be a path, so that the URLs built from it always point at RA.
  contentUrl: z.string().startsWith('/'),
  venue: z
    .object({ name: z.string(), area: z.object({ name: z.string(), ianaTimeZone: z.string().nullish() }).nullish() })
    .nullish(),
  // The event page's free-text "Line-up" section: one act per line, with tagged RA artists wrapped in
  // <artist id="…">Name</artist>.
  lineup: z.string().nullish(),
  artists: z.array(z.object({ name: z.string() })).nullish().transform((artists) => artists ?? []),
  images: z.array(z.object({ filename: z.string(), type: z.string() })).nullish().transform((images) => images ?? []),
})
type RaEvent = z.infer<typeof RaEvent>

const RaResponse = z.object({
  data: z.object({
    promoter: z.object({
      contentUrl: z.string().startsWith('/'),
      upcoming: z.array(RaEvent),
      past: z.array(RaEvent),
    }),
  }),
})

async function fetchFromRa(): Promise<Events> {
  const response = await fetch(`${RA_ORIGIN}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: `${RA_ORIGIN}/promoters/${RA_PROMOTER_ID}`,
    },
    body: JSON.stringify({
      query: RA_QUERY,
      variables: { id: RA_PROMOTER_ID, upcomingLimit: UPCOMING_EVENTS_LIMIT, pastLimit: PAST_EVENTS_LIMIT },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`RA responded with ${response.status}`)

  const body: unknown = await response.json()
  const parsed = RaResponse.safeParse(body)
  if (!parsed.success) {
    throw new Error(`Unexpected RA response: ${z.prettifyError(parsed.error)}\n${JSON.stringify(body).slice(0, 500)}`)
  }
  const { promoter } = parsed.data.data
  if (promoter.upcoming.length >= UPCOMING_EVENTS_LIMIT) {
    throw new Error(`RA returned ${promoter.upcoming.length} upcoming events, some are probably missing`)
  }
  if (promoter.past.length >= PAST_EVENTS_LIMIT) {
    throw new Error(`RA returned ${promoter.past.length} past events, some are probably missing`)
  }

  const upcoming = promoter.upcoming.map(toEvent)
  const upcomingIds = new Set(upcoming.map((event) => event.id))
  return {
    promoterUrl: RA_ORIGIN + promoter.contentUrl,
    upcoming: byStart(upcoming, 1),
    // Should RA's lists change while it answers, an event isn't both upcoming and past.
    past: byStart(promoter.past.map(toEvent).filter((event) => !upcomingIds.has(event.id)), -1),
  }
}

// `events` by start, the soonest first, or the most recent first when `direction` is -1.
function byStart(events: Event[], direction: 1 | -1): Event[] {
  return events.toSorted((a, b) => direction * (Date.parse(a.start) - Date.parse(b.start)))
}

// RA's local times are read in the time zone of the event's venue, or in Québec's when RA doesn't say, since that's where
// Parking Radio's events are (see `instantIn` for the times the clocks skip or show twice).
function toEvent(event: RaEvent): Event {
  const instant = (local: string) => instantIn(event.venue?.area?.ianaTimeZone, local).toISOString()
  return {
    id: event.id,
    title: event.title,
    category: categorize(event.title),
    start: instant(event.startTime),
    end: event.endTime ? instant(event.endTime) : null,
    venue: event.venue?.name ?? null,
    city: event.venue?.area?.name ?? null,
    lineup: parseLineup(event),
    url: RA_ORIGIN + event.contentUrl,
    flyer: event.images.find((image) => image.type === 'FLYERFRONT')?.filename ?? null,
  }
}

// RA has no notion of event categories, so they're derived from the titles Parking Radio gives its events
// on RA (e.g. "SYNTH MEETUPS").
function categorize(title: string): Event['category'] {
  return /\bsynth meetups?\b/i.test(title) ? 'synth-meetup' : 'other'
}

// The lines of the event's Line-up text, or its tagged artists when it has none.
function parseLineup(event: RaEvent): string[] {
  // Strip the tags before decoding, so that an escaped "&lt;" in a name isn't mistaken for a tag.
  const lines = decodeHTML((event.lineup ?? '').replace(/<[^>]*>/g, ''))
    .split('\n')
    // RA leaves non-breaking spaces after tagged artists, which trim() handles.
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.length > 0 ? [...new Set(lines)] : event.artists.map((artist) => artist.name)
}

export async function eventsRoutes(app: FastifyInstance) {
  const api = zodRoutes(app)
  // The messages of these routes' schemas are whole sentences, which are sent as they are.
  app.setSchemaErrorFormatter(firstIssue)

  // The outcome of the last fetch from RA, successful or not, kept for CACHE_TTL_MS so that RA is asked at
  // most that often. Failures are kept too, so that a broken RA isn't retried on every request. A failure
  // is never papered over with an older list: the page must show that something is wrong.
  const fetchEvents = cached(
    () =>
      fetchFromRa().catch((error: unknown) => {
        app.log.error(error, 'Failed to fetch events from Resident Advisor')
        return null
      }),
    (_outcome, startedAt) => startedAt + CACHE_TTL_MS,
  )

  api.get(
    '/api/events',
    {
      config: { tool: { title: 'Voir les événements' } },
      schema: {
        operationId: 'list_events',
        summary: `Parking Radio's events on Resident Advisor, upcoming and past: every upcoming one and the ${RECENT_PAST_EVENTS} most recent past ones, or every one that starts in a time range when one is given`,
        tags: ['Events'],
        querystring: z.object(startRange('events')).refine(...fromBeforeTo),
        response: { 200: Events, 502: ApiError },
      },
    },
    async (request, reply) => {
      const events = await fetchEvents()
      if (!events) return reply.status(502).send({ ok: false, error: 'Events are unavailable right now' })
      const { from, to } = request.query
      if (!from && !to) return { ...events, past: events.past.slice(0, RECENT_PAST_EVENTS) }
      const inRange = (event: Event) => (!from || Date.parse(event.start) >= from.getTime()) && (!to || Date.parse(event.start) < to.getTime())
      return { ...events, upcoming: events.upcoming.filter(inRange), past: events.past.filter(inRange) }
    },
  )
}
