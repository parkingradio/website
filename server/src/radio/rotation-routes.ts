import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ApiError, Timestamp, Total, firstIssue, objectError, zodRoutes } from '../api/schemas.js'
import { Event, EventSet, eventSet } from '../events/routes.js'
import { sessionTitle } from '../sessions/fields.js'
import { youtubeVideoUrl } from '../sessions/links.js'
import { SetBody, link, soundcloudTrackLink } from '../sessions/routes.js'
import type { StoredSession, StoredSet } from '../sessions/store.js'
import { SKIP_REASONS, fromHead, isOnAir, upcoming } from './rotation.js'
import { RotationRefused } from './rotation-store.js'
import type { Rotation, RotationStore, SetWithTrack } from './rotation-store.js'
import type { SoundCloudApp } from './soundcloud-app.js'
import type { TrackStreams } from './streams.js'
import type { TrackReads } from './track-reads.js'

// The radio's rotation of sets: what's on air on it, where to stream its sets from, and the admin endpoints that show
// and change it (see "The rotation of sets" in docs/design/server/radio.md).

// How many of the sets that come next `GET /api/on-air` gives at most.
const MAX_UPCOMING = 1000
// How long changing the rotation waits for the tracks that are due to be read, e.g. those of the sets it adds, before it
// responds, and asking for a set that can be added waits for its track.
const READ_NEW_TRACKS_MS = 8 * 1000

const SkipReason = z.enum(SKIP_REASONS).meta({ id: 'RotationSkipReason' })

// A set on the radio, as the public sees it: as its event gives it, with a few of its event's fields.
const OnAirSet = EventSet.extend({
  session: Event.pick({ id: true, title: true, start: true, takeover: true }).meta({ description: "Its session's id, title, start and takeover, as its event gives them" }),
}).meta({ id: 'OnAirSet' })
type OnAirSet = z.infer<typeof OnAirSet>

const DurationMs = z.number().int().positive().meta({ description: "How long it lasts, in milliseconds: its track's length" })

const OnAirNow = z
  .object({
    ok: z.literal(true),
    current: z
      .object({ set: OnAirSet, startedAt: Timestamp, durationMs: DurationMs })
      .nullable()
      .meta({ description: 'The set on air, or null when the radio is off air' }),
    upcoming: z.array(z.object({ set: OnAirSet, startsAt: Timestamp, durationMs: DurationMs })).meta({
      description: 'The sets that come next, each with when it goes on air if nothing changes until then. Empty when the radio is off air',
    }),
  })
  .meta({ id: 'OnAirNow' })

const SetStream = z.object({ ok: z.literal(true), url: z.string(), expiresAt: Timestamp }).meta({ id: 'SetStream' })

// A set of the rotation, or one that can be added to it, as the admin endpoints give it.
const RotationCandidate = SetBody.pick({ id: true, performers: true, genres: true, soundcloudTrack: true, youtubeVideo: true })
  .extend({ session: z.object({ id: z.string(), title: z.string(), start: Timestamp.nullable() }) })
  .meta({ id: 'RotationCandidate' })
type RotationCandidate = z.infer<typeof RotationCandidate>

// One of them, with what was read of its track: as it is in the rotation, or as it would be once added.
const RotationCandidateWithTrack = RotationCandidate.extend({
  durationMs: z.number().int().positive().nullable().meta({ description: "Its track's length, in milliseconds, as last read, or null when it hasn't been read" }),
  readError: z.string().nullable().meta({ description: 'Why the last read of its track failed, or null' }),
  skipped: z.array(SkipReason).meta({ description: "Why it's skipped, or empty when it isn't" }),
}).meta({ id: 'RotationCandidateWithTrack' })
type RotationCandidateWithTrack = z.infer<typeof RotationCandidateWithTrack>

const RotationSet = RotationCandidateWithTrack.extend({
  startsAt: Timestamp.nullable().meta({
    description: 'When it goes on air next, if nothing changes until then, or, for the set on air, when it went on air. Null when it is skipped, or the radio is off air',
  }),
}).meta({ id: 'RotationSet' })

const RadioRotation = z
  .object({
    ok: z.literal(true),
    updatedBy: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
    current: z.object({ setId: z.string(), startedAt: Timestamp }).nullable().meta({ description: 'The set on air, or null when the radio is off air' }),
    sets: z.array(RotationSet).meta({ description: 'In order, from the play head: the set on air, or, off air, where the radio comes back on air' }),
  })
  .meta({ id: 'RadioRotation' })
type RadioRotation = z.infer<typeof RadioRotation>

// Sets' ids are UUIDs, which are the same whatever their case.
const SetId = z.string().toLowerCase()

const RotationRequest = z.strictObject(
  {
    sets: z
      .array(SetId, { error: '`sets` must be a list of the ids of sets' })
      .meta({ description: 'The ids of the sets, in order, from the play head: the first that is not skipped is on air' }),
  },
  { error: objectError('The rotation must be an object with its `sets`') },
)

const RotationError = ApiError.extend({
  setIndex: z.number().int().nonnegative().optional().meta({ description: 'The place in `sets` of the set the error is about, from 0' }),
  reasons: z.array(SkipReason).optional().meta({ description: "Why the set can't be added to the rotation" }),
}).meta({ id: 'RotationError' })

const UPCOMING_ERROR = `\`upcoming\` must be a whole number from 0 to ${MAX_UPCOMING}`
const NOT_IN_ROTATION = { ok: false as const, error: 'Not a set of the rotation that can be played' }
const NOT_A_CANDIDATE = { ok: false as const, error: 'Not a set that can be added to the rotation' }

function onAirSet({ set, session }: { set: StoredSet; session: StoredSession }): OnAirSet {
  // Its session is announced, so it has a start (see `sessions_announced` in db/schema.ts).
  return { ...eventSet(set), session: { id: session.id, title: sessionTitle(session), start: session.startAt!.toISOString(), takeover: session.takeover } }
}

// The fields are listed one by one, so that a field added to sets doesn't end up here unless it's added.
function candidate({ set, session }: { set: StoredSet; session: StoredSession }): RotationCandidate {
  return {
    id: set.id,
    performers: set.performers,
    genres: set.genres,
    soundcloudTrack: soundcloudTrackLink(set),
    youtubeVideo: link(set.youtubeVideoId, youtubeVideoUrl),
    session: { id: session.id, title: sessionTitle(session), start: session.startAt?.toISOString() ?? null },
  }
}

// A set of the rotation, or one that can be added to it, with what was read of its track.
function withTrack(entry: SetWithTrack): RotationCandidateWithTrack {
  return { ...candidate(entry), durationMs: entry.durationMs, readError: entry.read?.error ?? null, skipped: [...entry.skipped] }
}

const iso = (time: number) => new Date(time).toISOString()

// The rotation as the admin endpoints give it, from its play head, with when each set goes on air next.
function rotationResponse(rotation: Rotation): RadioRotation {
  const { saved } = rotation
  const startsAt = new Map<string, number>()
  if (isOnAir(saved)) {
    startsAt.set(saved.setId, saved.startedAt)
    for (const { entry, startsAt: at } of upcoming(rotation.entries, saved)) startsAt.set(entry.setId, at)
  }
  return {
    ok: true,
    updatedBy: rotation.updatedBy,
    updatedAt: rotation.updatedAt?.toISOString() ?? null,
    current: isOnAir(saved) ? { setId: saved.setId, startedAt: iso(saved.startedAt) } : null,
    sets: fromHead(rotation.entries, saved).map((entry) => ({
      ...withTrack(entry),
      startsAt: startsAt.has(entry.set.id) ? iso(startsAt.get(entry.set.id)!) : null,
    })),
  }
}

type RotationOptions = {
  soundcloud: SoundCloudApp
  store: RotationStore
  reads: TrackReads
  // Shared with the playlist.
  streams: TrackStreams
}

export async function rotationRoutes(app: FastifyInstance, { soundcloud, store, reads, streams }: RotationOptions) {
  const api = zodRoutes(app)
  // The messages of these routes' schemas are whole sentences, which are sent as they are.
  app.setSchemaErrorFormatter(firstIssue)

  api.get(
    '/api/on-air',
    {
      config: { tool: { title: 'Voir ce qui joue à la radio' } },
      schema: {
        operationId: 'get_on_air',
        summary: "What's on air on the radio's rotation of sets, and what comes next",
        tags: ['Radio'],
        querystring: z.object({
          upcoming: z
            .string({ error: UPCOMING_ERROR })
            .regex(/^\d+$/, UPCOMING_ERROR)
            .refine((count) => Number(count) <= MAX_UPCOMING, UPCOMING_ERROR)
            .optional()
            .meta({ description: `How many of the sets that come next to give, from 0 to ${MAX_UPCOMING}, around the rotation as many times as it takes. Without it, one round` }),
        }),
        response: { 200: OnAirNow },
      },
    },
    async (request) => {
      const rotation = await store.onAir(Date.now())
      const { saved } = rotation
      if (!isOnAir(saved)) return { ok: true as const, current: null, upcoming: [] }
      // What's on air is always a set of the rotation that isn't skipped, which has a length (see `onAirAt`).
      const onAir = rotation.entries.find(({ setId }) => setId === saved.setId)!
      const count = request.query.upcoming === undefined ? undefined : Number(request.query.upcoming)
      return {
        ok: true as const,
        current: { set: onAirSet(onAir), startedAt: iso(saved.startedAt), durationMs: onAir.durationMs! },
        upcoming: upcoming(rotation.entries, saved, count).map(({ entry, startsAt }) => ({
          set: onAirSet(entry),
          startsAt: iso(startsAt),
          durationMs: entry.durationMs!,
        })),
      }
    },
  )

  api.get(
    '/api/radio/sets/:id/stream',
    {
      schema: {
        summary: 'Where to stream a set of the rotation of sets from',
        tags: ['Radio'],
        params: z.object({ id: SetId }),
        response: { 200: SetStream, 404: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const rotation = await store.load()
      // Any set of the rotation that isn't skipped, not only the one on air (see "On air" in docs/design/server/radio.md).
      const found = rotation.entries.find(({ setId, skipped }) => setId === request.params.id && skipped.length === 0)
      if (!found) return reply.status(404).send(NOT_IN_ROTATION)
      try {
        // A set that isn't skipped was read through the link it has, which gives its secret, if it's private.
        const { url, expiresAt } = await streams(await soundcloud.client(), found.trackId!, found.read!.secretToken)
        return { ok: true as const, url, expiresAt: iso(expiresAt) }
      } catch (error) {
        request.log.error(error, 'Failed to get a stream from SoundCloud')
        return reply.status(502).send({ ok: false, error: 'This set cannot be played right now' })
      }
    },
  )

  api.get(
    '/api/admin/radio/rotation',
    {
      config: { admin: true, tool: { title: 'Voir la rotation de la radio' } },
      schema: {
        operationId: 'get_rotation',
        summary:
          "The radio's rotation of sets, in order, from the set on air, or, off air, from where the radio comes back on air, with when each set goes on air next, and the sets that are skipped, and why",
        tags: ['Radio'],
        response: { 200: RadioRotation },
      },
    },
    async () => rotationResponse(await store.onAir(Date.now())),
  )

  api.put(
    '/api/admin/radio/rotation',
    {
      config: { admin: true, tool: { title: 'Changer la rotation de la radio' } },
      schema: {
        operationId: 'update_rotation_sets',
        summary:
          "Makes the radio's rotation of sets these sets, in this order, from the set to have on air: the first that isn't skipped goes on air right away, from its start, unless it's the set already on air, which goes on. So the rotation, as `get_rotation` gives it, changes nothing, and taking out its first set puts the next one on air. Read it again just before changing it: the set on air moves along as sets end, and sending a rotation read before then puts its first set back on air, from its start. Then reads the tracks of the sets it adds that are due to be read, e.g. those not read within the hour by `get_rotation_candidate`. That can put the first of them on air then. Returns the rotation",
        tags: ['Radio'],
        body: RotationRequest,
        response: { 200: RadioRotation, 400: RotationError, 409: RotationError },
      },
    },
    async (request, reply) => {
      let changed: Rotation
      try {
        changed = await store.replace(request.body.sets, request.user!.email)
      } catch (error) {
        if (!(error instanceof RotationRefused)) throw error
        const { status, message, setIndex, reasons } = error
        return reply.status(status).send({ ok: false, error: message, setIndex, reasons })
      }
      request.log.info({ sets: request.body.sets.length, by: request.user!.email }, 'Changed the rotation of sets of the radio')
      // Once it's saved, rather than while it holds the sessions' lock (see `replace`).
      await reads.readDue(READ_NEW_TRACKS_MS)
      return rotationResponse(await store.afterReads(changed, Date.now()))
    },
  )

  api.get(
    '/api/admin/radio/rotation/candidates',
    {
      config: { admin: true, tool: { title: "Voir les sets qu'on peut ajouter à la rotation" } },
      schema: {
        operationId: 'list_rotation_candidates',
        summary: "The sets that can be added to the radio's rotation of sets, and aren't in it, the most recent session first",
        tags: ['Radio'],
        response: { 200: z.object({ ok: z.literal(true), total: Total, sets: z.array(RotationCandidate) }) },
      },
    },
    async () => {
      const sets = (await store.candidates()).map(candidate)
      return { ok: true as const, total: sets.length, sets }
    },
  )

  api.get(
    '/api/admin/radio/rotation/candidates/:id',
    {
      config: { admin: true, tool: { title: "Voir un set qu'on peut ajouter à la rotation" } },
      schema: {
        operationId: 'get_rotation_candidate',
        summary:
          "A set that can be added to the radio's rotation of sets, as it would be once added: its track's length, and why it would be skipped, if it would. First reads its track from SoundCloud when it's due to be read, e.g. when it hasn't been read within the hour, which can take a few seconds",
        tags: ['Radio'],
        params: z.object({ id: SetId }),
        response: { 200: z.object({ ok: z.literal(true), set: RotationCandidateWithTrack }), 404: ApiError },
      },
    },
    async (request, reply) => {
      const found = await store.candidate(request.params.id)
      if (!found) return reply.status(404).send(NOT_A_CANDIDATE)
      await reads.readIfDue(found.track, READ_NEW_TRACKS_MS)
      // As it is once its track is read, unless it can't be added anymore meanwhile, e.g. because it was just added.
      const read = await store.candidate(request.params.id)
      return read ? { ok: true as const, set: withTrack(read) } : reply.status(404).send(NOT_A_CANDIDATE)
    },
  )
}
