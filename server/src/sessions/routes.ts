import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { errorMessage } from '../api/errors.js'
import { fromBeforeTo, startRange } from '../api/formats.js'
import { ApiError, ById, Ok, Reference, Timestamp, Total, firstIssue, zodRoutes } from '../api/schemas.js'
import { NoSoundCloudCredentials } from '../radio/soundcloud-app.js'
import { BAD_STATUS, Genre, PerformanceType, SessionFields, SetFields, Status } from './fields.js'
import { raEventUrl, youtubeVideoUrl } from './links.js'
import { Conflict, NoSuchReference, SESSION_CANCELLED } from './store.js'
import type { SessionsStore, SetChanges, SetRow, StoredSession, StoredSet } from './store.js'

// Admin routes for sessions and their sets: add, view, change, mark as planned, done or cancelled, and delete them (see
// docs/design/server/sessions.md).

// A link of a session or a set, as the endpoints return it.
const Link = z.object({ id: z.string(), url: z.string() }).meta({ id: 'SessionLink' })

// Who added a session or a set, and when, who last changed it, and its status, as the endpoints return them.
const Tracked = {
  createdAt: Timestamp,
  createdBy: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: Timestamp.nullable(),
  status: Status,
  statusUpdatedBy: z.string().nullable(),
  statusUpdatedAt: Timestamp.nullable(),
}

// A set, as the endpoints return it: its fields, as they were saved, and what the server knows of it.
const SetBody = z
  .object({
    id: z.string(),
    performers: z.array(Reference).meta({ description: 'The artists who played, in order' }),
    offsetMinutes: z.number().nullable(),
    durationMinutes: z.number().nullable(),
    start: Timestamp.nullable().meta({ description: "Its session's start plus its offset. Null when either is" }),
    end: Timestamp.nullable().meta({ description: 'Its start plus its duration. Null when its start is' }),
    performanceTypes: z.array(PerformanceType),
    otherPerformanceType: z.string(),
    genres: z.array(Genre),
    soundcloudTrack: Link.nullable().meta({
      description: "SoundCloud's id for the track, and the link it was resolved from: a private track's private link must not be shown to the public",
    }),
    youtubeVideo: Link.nullable(),
    ...Tracked,
  })
  .meta({ id: 'Set' })
type SetBody = z.infer<typeof SetBody>

// A session, as the endpoints return it, with its sets.
const SessionBody = z
  .object({
    id: z.string(),
    start: Timestamp.nullable().meta({ description: "Null while the session's date isn't known" }),
    end: Timestamp.nullable().meta({ description: 'Its start plus its duration. Null when its start is' }),
    durationMinutes: z.number(),
    takeover: Reference.nullable().meta({ description: 'The collective whose takeover the session is' }),
    name: z.string(),
    raEvent: Link.nullable(),
    sets: z.array(SetBody).meta({ description: 'By offset, then by when they were added, those without an offset last' }),
    ...Tracked,
  })
  .meta({ id: 'Session' })
type SessionBody = z.infer<typeof SessionBody>

const SessionResponse = z.object({ ok: z.literal(true), session: SessionBody })

// What the 409s respond: when a session or a set would break one of the rules of sessions, what's in the way (see
// `Conflict` in sessions/store.ts), and null for the 409s that aren't about a session or a set.
const ConflictError = ApiError.extend({
  session: SessionBody.nullable().meta({ description: "The session in the way, or the set's in the way" }),
  set: SetBody.nullable().meta({ description: 'The set in the way, if it is one' }),
}).meta({ id: 'ConflictError' })

const NO_SUCH_SESSION: ApiError = { ok: false, error: 'No such session' }
const NO_SUCH_SET: ApiError = { ok: false, error: 'No such set' }

// Why a request failed, and what's in the way, when it's about a session or a set.
type Failure = { status: 400 | 409 | 502; error: string; session?: StoredSession | null; set?: StoredSet | null }

function link(id: string | null, url: (id: string) => string): z.infer<typeof Link> | null {
  return id === null ? null : { id, url: url(id) }
}

const MINUTE_MS = 60 * 1000

// `minutes` after `date`, in minutes that actually pass.
function after(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS)
}

// The fields are listed one by one, so that a column added to a table doesn't end up in the API unless it's added here.
function tracked(row: StoredSession | StoredSet) {
  return {
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    status: row.status,
    statusUpdatedBy: row.statusUpdatedBy,
    statusUpdatedAt: row.statusUpdatedAt?.toISOString() ?? null,
  }
}

function setBody(row: StoredSet, sessionStart: Date | null): SetBody {
  const start = sessionStart === null || row.offsetMinutes === null ? null : after(sessionStart, row.offsetMinutes)
  return {
    id: row.id,
    performers: row.performers,
    offsetMinutes: row.offsetMinutes,
    durationMinutes: row.durationMinutes,
    start: start?.toISOString() ?? null,
    // A set with an offset has a duration.
    end: start && after(start, row.durationMinutes!).toISOString(),
    performanceTypes: row.performanceTypes,
    otherPerformanceType: row.otherPerformanceType,
    genres: row.genres,
    soundcloudTrack: row.soundcloudTrackId === null ? null : { id: row.soundcloudTrackId, url: row.soundcloudTrackUrl! },
    youtubeVideo: link(row.youtubeVideoId, youtubeVideoUrl),
    ...tracked(row),
  }
}

function sessionBody(row: StoredSession): SessionBody {
  return {
    id: row.id,
    start: row.startAt?.toISOString() ?? null,
    end: row.startAt && after(row.startAt, row.durationMinutes).toISOString(),
    durationMinutes: row.durationMinutes,
    takeover: row.takeover,
    name: row.name,
    raEvent: link(row.raEventId, raEventUrl),
    sets: row.sets.map((set) => setBody(set, row.startAt)),
    ...tracked(row),
  }
}

type SessionsOptions = {
  store: SessionsStore
  // The id of the track a link to it on soundcloud.com leads to, through the SoundCloud app, or null when SoundCloud
  // shows no track there. Throws a NoSoundCloudCredentials until the app's credentials are entered.
  resolveTrack: (link: string) => Promise<string | null>
}

export async function sessionsRoutes(app: FastifyInstance, { store, resolveTrack }: SessionsOptions) {
  const api = zodRoutes(app)
  // The messages of these routes' schemas are whole sentences, which are sent as they are.
  app.setSchemaErrorFormatter(firstIssue)

  // Responds that a request failed: a 409 always has `session` and `set` (see `ConflictError`).
  function fail(reply: FastifyReply, { status, error, session, set }: Failure) {
    if (status !== 409) return reply.status(status).send({ ok: false as const, error })
    return reply.status(409).send({
      ok: false as const,
      error,
      session: session ? sessionBody(session) : null,
      set: set ? setBody(set, session?.startAt ?? null) : null,
    })
  }

  // Runs `save`, which saves a session or a set, and responds with the session it returns, or 404 with `notFound` when
  // it returns null, or the error it throws when it's expected.
  async function saving(reply: FastifyReply, notFound: ApiError, save: () => Promise<StoredSession | null>) {
    let saved: StoredSession | null
    try {
      saved = await save()
    } catch (error) {
      if (error instanceof NoSuchReference) return fail(reply, { status: 400, error: error.message })
      if (error instanceof Conflict) return fail(reply, { status: 409, error: error.message, session: error.session, set: error.set })
      throw error
    }
    if (!saved) return reply.status(404).send(notFound)
    return { ok: true as const, session: sessionBody(saved) }
  }

  // The id of the track `link` leads to: the track of the set as it was, `before`, when that's its link, or else the one
  // SoundCloud resolves it to. Or the error to respond with.
  async function trackId(link: string, before: SetRow | null): Promise<string | Failure> {
    if (link === before?.soundcloudTrackUrl) return before.soundcloudTrackId!
    try {
      return (await resolveTrack(link)) ?? { status: 400, error: 'SoundCloud shows no track at this link' }
    } catch (error) {
      if (error instanceof NoSoundCloudCredentials) return { status: 409, error: error.message }
      app.log.error(error, 'Failed to resolve a track through SoundCloud')
      return { status: 502, error: `The track cannot be resolved through SoundCloud: ${errorMessage(error)}` }
    }
  }

  // What's saved of the fields that were sent, for the set as it was, `before`, if it's changed, or the error to respond
  // with.
  async function setChanges(fields: SetFields, before: SetRow | null): Promise<SetChanges | Failure> {
    const { soundcloudTrack, youtubeVideo, ...rest } = fields
    const track = soundcloudTrack === null ? null : await trackId(soundcloudTrack, before)
    if (typeof track === 'object' && track !== null) return track
    return { ...rest, soundcloudTrackId: track, soundcloudTrackUrl: soundcloudTrack, youtubeVideoId: youtubeVideo }
  }

  function sessionChanges({ start, durationMinutes, takeover, name, raEvent }: SessionFields) {
    return { startAt: start, durationMinutes, takeoverId: takeover, name, raEventId: raEvent }
  }

  function statusChange(status: z.infer<typeof Status>, by: string) {
    return { status, statusUpdatedBy: by, statusUpdatedAt: new Date() }
  }

  const StatusBody = z.object({ status: Status }, { error: BAD_STATUS })

  api.get(
    '/api/admin/sessions',
    {
      config: { admin: true, tool: { title: 'Lister les sessions' } },
      schema: {
        operationId: 'list_sessions',
        summary:
          "Every session, or those with a set an artist played, or a collective's takeovers, only those that start in a time range when one is given, the most recent first",
        tags: ['Sessions'],
        querystring: z
          .object({
            artist: z
              .string({ error: 'The artist must be a single id' })
              .optional()
              .meta({ description: 'Only the sessions with a set this artist played, with all their sets. Not with `takeover`' }),
            takeover: z
              .string({ error: 'The takeover must be a single id' })
              .optional()
              .meta({ description: "Only this collective's takeovers. Not with `artist`" }),
            ...startRange('sessions', '. Leaves out those without a start'),
          })
          .refine((query) => query.artist === undefined || query.takeover === undefined, 'Only one of artist and takeover can be given')
          .refine(...fromBeforeTo),
        response: { 200: z.object({ ok: z.literal(true), total: Total, sessions: z.array(SessionBody) }) },
      },
    },
    async (request) => {
      const sessions = (await store.list(request.query)).map(sessionBody)
      return { ok: true as const, total: sessions.length, sessions }
    },
  )

  api.get(
    '/api/admin/sessions/:id',
    {
      config: { admin: true, tool: { title: 'Voir une session' } },
      schema: {
        operationId: 'get_session',
        summary: 'A session, with its sets',
        tags: ['Sessions'],
        params: ById,
        response: { 200: SessionResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_SESSION)
      return { ok: true as const, session: sessionBody(row) }
    },
  )

  api.post(
    '/api/admin/sessions',
    {
      config: { admin: true, tool: { title: 'Ajouter une session' } },
      schema: {
        operationId: 'create_session',
        summary: 'Adds a session, as planned, without sets',
        tags: ['Sessions'],
        body: SessionFields,
        response: { 200: SessionResponse, 400: ApiError, 409: ConflictError },
      },
    },
    async (request, reply) => {
      const session = { ...sessionChanges(request.body), createdBy: request.user!.email }
      // It can't be missing once it's added.
      return saving(reply, NO_SUCH_SESSION, () => store.create(session))
    },
  )

  api.put(
    '/api/admin/sessions/:id',
    {
      config: { admin: true, tool: { title: 'Modifier une session' } },
      schema: {
        operationId: 'update_session',
        summary: 'Changes a session, but not its status or its sets, which move with its start',
        tags: ['Sessions'],
        params: ById,
        body: SessionFields,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError },
      },
    },
    async (request, reply) => {
      const changes = { ...sessionChanges(request.body), updatedBy: request.user!.email, updatedAt: new Date() }
      return saving(reply, NO_SUCH_SESSION, () => store.update(request.params.id, changes))
    },
  )

  api.put(
    '/api/admin/sessions/:id/status',
    {
      config: { admin: true, tool: { title: "Changer le statut d'une session" } },
      schema: {
        operationId: 'update_session_status',
        summary: "Marks a session as planned, done or cancelled, and its sets as cancelled when it's cancelled",
        tags: ['Sessions'],
        params: ById,
        body: StatusBody,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError },
      },
    },
    async (request, reply) => {
      const change = statusChange(request.body.status, request.user!.email)
      return saving(reply, NO_SUCH_SESSION, () => store.setStatus(request.params.id, change))
    },
  )

  api.delete(
    '/api/admin/sessions/:id',
    {
      config: { admin: true, tool: { title: 'Supprimer une session' } },
      schema: {
        operationId: 'delete_session',
        summary: 'Deletes a session and its sets, but not their performers',
        tags: ['Sessions'],
        params: ById,
        response: { 200: Ok, 404: ApiError },
      },
    },
    async (request, reply) => {
      if (!(await store.delete(request.params.id))) return reply.status(404).send(NO_SUCH_SESSION)
      return { ok: true as const }
    },
  )

  api.post(
    '/api/admin/sessions/:id/sets',
    {
      config: { admin: true, tool: { title: 'Ajouter un set' } },
      schema: {
        operationId: 'create_set',
        summary: 'Adds a set to a session, as planned, and returns the session',
        tags: ['Sessions'],
        params: ById,
        body: SetFields,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError, 502: ApiError },
      },
    },
    async (request, reply) => {
      // Before the track is resolved, and again once the set is saved, in case the session changes in the meantime.
      const session = await store.get(request.params.id)
      if (!session) return reply.status(404).send(NO_SUCH_SESSION)
      if (session.status === 'cancelled') return fail(reply, { status: 409, error: SESSION_CANCELLED, session })
      const saved = await setChanges(request.body, null)
      if ('error' in saved) return fail(reply, saved)
      const set = { ...saved, createdBy: request.user!.email }
      return saving(reply, NO_SUCH_SESSION, () => store.addSet(session.id, set))
    },
  )

  api.put(
    '/api/admin/sets/:id',
    {
      config: { admin: true, tool: { title: 'Modifier un set' } },
      schema: {
        operationId: 'update_set',
        summary: 'Changes a set, but not its session or its status, and returns its session',
        tags: ['Sessions'],
        params: ById,
        body: SetFields,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError, 502: ApiError },
      },
    },
    async (request, reply) => {
      // Before the track is resolved, which it isn't when it's the set's already.
      const before = await store.getSet(request.params.id)
      if (!before) return reply.status(404).send(NO_SUCH_SET)
      const saved = await setChanges(request.body, before)
      if ('error' in saved) return fail(reply, saved)
      const changes = { ...saved, updatedBy: request.user!.email, updatedAt: new Date() }
      return saving(reply, NO_SUCH_SET, () => store.updateSet(before.id, changes))
    },
  )

  api.put(
    '/api/admin/sets/:id/status',
    {
      config: { admin: true, tool: { title: "Changer le statut d'un set" } },
      schema: {
        operationId: 'update_set_status',
        summary: 'Marks a set as planned, done or cancelled, and returns its session',
        tags: ['Sessions'],
        params: ById,
        body: StatusBody,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError },
      },
    },
    async (request, reply) => {
      const change = statusChange(request.body.status, request.user!.email)
      return saving(reply, NO_SUCH_SET, () => store.setSetStatus(request.params.id, change))
    },
  )

  api.delete(
    '/api/admin/sets/:id',
    {
      config: { admin: true, tool: { title: 'Supprimer un set' } },
      schema: {
        operationId: 'delete_set',
        summary: 'Deletes a set, but not its performers',
        tags: ['Sessions'],
        params: ById,
        response: { 200: Ok, 404: ApiError },
      },
    },
    async (request, reply) => {
      if (!(await store.deleteSet(request.params.id))) return reply.status(404).send(NO_SUCH_SET)
      return { ok: true as const }
    },
  )
}
