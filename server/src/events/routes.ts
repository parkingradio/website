import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { RECENT_PAST_EVENTS, fromBeforeTo, startRange } from '../api/formats.js'
import { Reference, Timestamp, firstIssue, zodRoutes } from '../api/schemas.js'
import { PublicSizes, publicSizeRoute, publicSizes, sendPublicSize } from '../artists/photo-form.js'
import type { Photos } from '../artists/store.js'
import { effectiveDescription } from '../sessions/descriptions.js'
import { after, sessionTitle } from '../sessions/fields.js'
import { lineup } from '../sessions/lineup.js'
import { isPrivateTrackLink, raEventUrl, youtubeVideoUrl } from '../sessions/links.js'
import { SessionBody, SetBody, link } from '../sessions/routes.js'
import type { StoredSession, StoredSet } from '../sessions/store.js'
import type { EventsStore } from './store.js'

// The public schedule: the events, which are the announced sessions, with their sets, and their flyers (see
// docs/design/server/events.md). Their calendar feed is in calendar.ts.

// A set of an event, as the public sees it.
const EventSet = SetBody.pick({ id: true, performers: true, durationMinutes: true, performanceTypes: true, otherPerformanceType: true, genres: true, youtubeVideo: true })
  .extend({
    cancelled: z.boolean(),
    soundcloudTrack: z
      .object({ id: z.string(), url: z.string().nullable().meta({ description: 'Null when the link is a private link, which is a secret' }) })
      .nullable(),
  })
  .meta({ id: 'EventSet' })
type EventSet = z.infer<typeof EventSet>

// An event, as the public sees it: an announced session.
const Event = SessionBody.pick({ id: true, title: true, type: true, takeover: true })
  .extend({
    start: Timestamp.meta({ description: "The session's start" }),
    end: Timestamp.meta({ description: 'Its start plus its duration' }),
    cancelled: z.boolean().meta({ description: 'Whether the session is cancelled, which it stays public as' }),
    description: z.string().meta({ description: 'Its description, or else the one its type gives it, or empty when neither has one' }),
    flyer: PublicSizes.nullable().meta({ description: 'Where the sizes of its flyer are, by width, or null when it has none' }),
    raEvent: z.string().nullable().meta({ description: 'The page of its event on RA, or null when it has none' }),
    sets: z.array(EventSet).meta({ description: 'In their order, cancelled ones included' }),
    lineup: z.array(Reference).meta({
      description: "The performers of its sets that aren't cancelled, in the sets' order then their performers', each artist once: empty when there are none",
    }),
  })
  .meta({ id: 'Event' })
export type Event = z.infer<typeof Event>

const Events = z
  .object({
    ok: z.literal(true),
    upcoming: z.array(Event).meta({ description: "Those whose end hasn't passed, the soonest first" }),
    past: z.array(Event).meta({
      description: `Those whose end has passed, the most recent first: without \`from\` and \`to\`, only the ${RECENT_PAST_EVENTS} most recent`,
    }),
  })
  .meta({ id: 'Events' })

// Where the public gets the sizes of events' flyers.
const FLYERS = '/api/events/flyers'

// The fields are listed one by one, so that nothing the admin endpoints give ends up public unless it's added here.
function eventSet(row: StoredSet): EventSet {
  return {
    id: row.id,
    performers: row.performers,
    durationMinutes: row.durationMinutes,
    performanceTypes: row.performanceTypes,
    otherPerformanceType: row.otherPerformanceType,
    genres: row.genres,
    cancelled: row.status === 'cancelled',
    soundcloudTrack:
      row.soundcloudTrackId === null ? null : { id: row.soundcloudTrackId, url: isPrivateTrackLink(row.soundcloudTrackUrl!) ? null : row.soundcloudTrackUrl },
    youtubeVideo: link(row.youtubeVideoId, youtubeVideoUrl),
  }
}

// An event always has a start (see `sessions_announced` in db/schema.ts).
export function event(row: StoredSession): Event {
  return {
    id: row.id,
    title: sessionTitle(row),
    type: row.type,
    start: row.startAt!.toISOString(),
    end: after(row.startAt!, row.durationMinutes).toISOString(),
    cancelled: row.status === 'cancelled',
    description: effectiveDescription(row),
    flyer: publicSizes(FLYERS, row.flyerKey),
    raEvent: row.raEventId === null ? null : raEventUrl(row.raEventId),
    takeover: row.takeover,
    sets: row.sets.map(eventSet),
    lineup: lineup(row.sets),
  }
}

type EventsOptions = {
  store: EventsStore
  // Where sessions' flyers are kept.
  photos: Photos
}

export async function eventsRoutes(app: FastifyInstance, { store, photos }: EventsOptions) {
  const api = zodRoutes(app)
  // The messages of these routes' schemas are whole sentences, which are sent as they are.
  app.setSchemaErrorFormatter(firstIssue)

  api.get(
    '/api/events',
    {
      config: { tool: { title: 'Voir les événements publics' } },
      schema: {
        operationId: 'list_events',
        summary: `Parking Radio's public events, which are its announced sessions, with their sets, upcoming and past: every upcoming one and the ${RECENT_PAST_EVENTS} most recent past ones, or every one that starts in a time range when one is given`,
        tags: ['Events'],
        querystring: z.object(startRange('events')).refine(...fromBeforeTo),
        response: { 200: Events },
      },
    },
    async (request) => {
      const { upcoming, past } = await store.list({ ...request.query, now: new Date() })
      return { ok: true as const, upcoming: upcoming.map(event), past: past.map(event) }
    },
  )

  api.get(
    `${FLYERS}/:image/:size`,
    publicSizeRoute('flyer', { summary: 'One of the sizes of a flyer that an event has', tags: ['Events'] }),
    (request, reply) => sendPublicSize(reply, photos, 'flyer', request.params, store.getFlyer),
  )
}
