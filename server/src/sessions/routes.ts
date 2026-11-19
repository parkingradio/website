import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { errorMessage } from '../api/errors.js'
import { fromBeforeTo, startRange } from '../api/formats.js'
import { ApiError, ById, Ok, Reference, Timestamp, Total, changesTo, firstIssue, objectError, zodRoutes } from '../api/schemas.js'
import { FlyerResponses, INVALID_REQUEST, readPhotoForm, readProfileForm, sendPhoto } from '../artists/photo-form.js'
import { PHOTO_MAX_BYTES } from '../artists/profile.js'
import { InvalidProfile, forgetPhoto, validatePhoto } from '../artists/store.js'
import type { Photos, SentPhoto } from '../artists/store.js'
import { NoSoundCloudCredentials } from '../radio/soundcloud-app.js'
import { effectiveDescription } from './descriptions.js'
import {
  BAD_STATUS,
  Genre,
  NO_SUCH_SESSION,
  NewSessionFields,
  PerformanceType,
  SESSION_FIELDS,
  SET_FIELDS,
  SessionFields,
  SessionType,
  SetFields,
  SetPosition,
  SetSession,
  Status,
  after,
  sessionTitle,
} from './fields.js'
import { raEventUrl, youtubeVideoUrl } from './links.js'
import { raEventContent } from './ra-event.js'
import { BrokenFields, Conflict, NoSuchReference, SESSION_CANCELLED } from './store.js'
import type { NewSet, SessionChanges, SessionsStore, SetChanges, SetRow, StatusChangedBy, StoredFlyer, StoredSession, StoredSet } from './store.js'

// Admin routes for sessions and their sets: add, view, change, mark as planned, done or cancelled, and delete them (see
// docs/design/server/sessions.md).

// A link of a session or a set, as the endpoints return it.
const Link = z.object({ id: z.string(), url: z.string() }).meta({ id: 'SessionLink' })

// The application a session or a set comes from, as the endpoints return it.
const ApplicationLink = z
  .object({ id: z.string(), receivedAt: Timestamp })
  .meta({ id: 'ApplicationLink', description: 'The application it comes from, and when it was received' })

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
export const SetBody = z
  .object({
    id: z.string(),
    performers: z.array(Reference).meta({ description: 'The artists who played, in order' }),
    durationMinutes: z.number().nullable().meta({ description: "Null while it isn't known" }),
    performanceTypes: z.array(PerformanceType),
    otherPerformanceType: z.string(),
    genres: z.array(Genre),
    soundcloudTrack: Link.nullable().meta({
      description: "SoundCloud's id for the track, and the link it was resolved from: a private track's private link must not be shown to the public",
    }),
    youtubeVideo: Link.nullable(),
    application: ApplicationLink.nullable(),
    ...Tracked,
  })
  .meta({ id: 'Set' })
type SetBody = z.infer<typeof SetBody>

// What announcing a session does, which its field and its endpoint say, so that the tools do too (see "Announced" in
// docs/design/server/sessions.md).
const WHAT_ANNOUNCING_DOES =
  "which makes it public, as an event, with its sets, and makes public the profiles and photos of its sets' performers, and of the collective whose takeover it is, with its members"

// A session, as the endpoints return it, with its sets.
export const SessionBody = z
  .object({
    id: z.string(),
    start: Timestamp.nullable().meta({ description: "Null while the session's date isn't known" }),
    end: Timestamp.nullable().meta({ description: 'Its start plus its duration. Null when its start is' }),
    durationMinutes: z.number(),
    type: SessionType,
    takeover: Reference.nullable().meta({ description: 'The collective whose takeover the session is, which only takeovers have' }),
    application: ApplicationLink.nullable(),
    name: z.string().meta({ description: 'Its own name, which replaces the one its type gives it, or empty for none: the one to send back' }),
    title: z.string().meta({ description: 'What the session is called: its name, or else the one its type gives it. Never empty' }),
    raEvent: Link.nullable(),
    description: z.string().meta({ description: 'Its own description, which replaces the one its type gives it, or empty for none: the one to send back' }),
    effectiveDescription: z.string().meta({ description: 'Its description, or else the one its type gives it, or empty when neither has one' }),
    hasFlyer: z.boolean(),
    sets: z.array(SetBody).meta({ description: 'In their order, which is the order they take place in, one after the other, cancelled ones included' }),
    ...Tracked,
    announced: z.boolean().meta({ description: `Whether it is announced, ${WHAT_ANNOUNCING_DOES}` }),
    announcedUpdatedBy: z.string().nullable(),
    announcedUpdatedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Session' })
export type SessionBody = z.infer<typeof SessionBody>

const SessionResponse = z.object({ ok: z.literal(true), session: SessionBody })

// What moving a set to another session responds: both sessions, since the one it leaves can change too.
const MovedSetResponse = z
  .object({
    ok: z.literal(true),
    session: SessionBody.meta({ description: "The set's session, which it was moved to, with its sets, as it is then" }),
    previousSession: SessionBody.meta({
      description: 'The session the set was in, with its other sets, as it is then: the same one when the set was moved to the session it was in',
    }),
  })
  .meta({ id: 'MovedSetResponse' })

// The content of a session's event on RA (see sessions/ra-event.ts).
const RaEventContent = z
  .object({
    title: z.string(),
    start: Timestamp.nullable().meta({ description: "The session's start, or null when it has none. RA takes it in Québec time, without its offset" }),
    end: Timestamp.nullable().meta({ description: "The session's end, or null when it has no start. RA takes it in Québec time, without its offset" }),
    lineup: z.string().meta({
      description:
        "One performer per line: those of its sets that aren't cancelled, in order, without repeated lines, or else OPEN JAM for a synth meetup, or its title",
    }),
    venueId: z.string().meta({ description: "Parking Radio's venue on RA" }),
    promoterIds: z.array(z.string()).meta({ description: "Parking Radio's promoter page on RA" }),
    content: z.string().meta({ description: 'Its effective description' }),
  })
  .meta({ id: 'RaEventContent' })
export type RaEventContent = z.infer<typeof RaEventContent>

// A session's flyer follows the rules of artists' photos (see `validatePhoto` in artists/store.ts), with errors in English.
const FLYER_ERRORS = {
  wrongType: 'The flyer must be a JPEG, PNG or WebP image',
  tooLarge: `The flyer is larger than ${PHOTO_MAX_BYTES / 1024 / 1024} MB`,
}
const FlyerFile = z.file().meta({
  description: `A JPEG, PNG or WebP image of up to ${PHOTO_MAX_BYTES / 1024 / 1024} MB, whose type is told from its contents. An empty file is no flyer`,
})

// What adding a session sends, as multipart/form-data, with its sets, and changing one, without them, with
// `removeFlyer`. The route reads it itself (see `readSessionForm`): only the session's fields are checked against their
// schema here.
const NewSessionForm = z.object({ session: NewSessionFields, flyer: FlyerFile.optional() })
const SessionForm = z.object({
  session: SessionFields,
  flyer: FlyerFile.optional(),
  removeFlyer: z
    .string()
    .optional()
    .meta({ description: '"true" removes the session\'s flyer, when there\'s no new one. Anything else keeps it' }),
})
// What giving a session a flyer, or replacing its flyer, sends, as multipart/form-data, which the route reads itself.
const FlyerForm = z.object({ flyer: FlyerFile })

// What changing some of a session's fields sends, as JSON, and some of a set's.
const SessionChangesBody = changesTo({
  ...SESSION_FIELDS,
  removeFlyer: z.boolean({ error: 'removeFlyer must be true or false' }).meta({ description: "`true` removes the session's flyer, and deletes it. `false` keeps it, like leaving it out" }),
})
const SetChangesBody = changesTo(SET_FIELDS)

// What's saved of a session's fields that were sent, all of them, or some of them for a change, whose others are then
// undefined, which leaves them as they are (see `changed` in sessions/store.ts).
function sessionChanges(fields: SessionFields): SessionChanges
function sessionChanges(fields: Partial<SessionFields>): Partial<SessionChanges>
function sessionChanges({ start, durationMinutes, type, takeover, application, name, raEvent, description }: Partial<SessionFields>): Partial<SessionChanges> {
  return { startAt: start, durationMinutes, type, takeoverId: takeover, applicationId: application, name, raEventId: raEvent, description }
}

// Reads the session's fields, as JSON from the "session" part, and the flyer from a request that adds or changes a
// session, and checks them against `schema`, like an artist's profile and photo (see `readProfileForm`), along with the
// "removeFlyer" field, which only changing one reads. Returns them, or the error to reply with when the request is
// malformed or invalid, with the `setIndex` of the set it's about, if it's about one of those added with the session.
async function readSessionForm<Schema extends z.ZodType>(
  request: FastifyRequest,
  schema: Schema,
): Promise<{ fields: z.output<Schema>; flyer: SentPhoto | null; removeFlyer: boolean } | Failure> {
  const sent = await readProfileForm(request, 'session', schema, { photoPart: 'flyer', remove: 'removeFlyer', errors: FLYER_ERRORS })
  if (!('error' in sent)) return { fields: sent.profile, flyer: sent.photo, removeFlyer: sent.removePhoto }
  const [field, setIndex] = sent.path ?? []
  return { status: sent.status, error: sent.error, ...(field === 'sets' && typeof setIndex === 'number' && { setIndex }) }
}

// What the 409s respond: when a session or a set would break one of the rules of sessions, what's in the way (see
// `Conflict` in sessions/store.ts), and null for the 409s that aren't about a session or a set. Deleting a collective
// that has takeovers responds with it too (see collectives/routes.ts).
export const ConflictError = ApiError.extend({
  session: SessionBody.nullable().meta({ description: "The session in the way, or the set's in the way" }),
  set: SetBody.nullable().meta({ description: 'The set in the way, if it is one' }),
}).meta({ id: 'ConflictError' })

// The errors of adding a session, which say which of the sets added with it they're about, if they're about one.
const SetIndex = z.number().int().nonnegative()
const NewSessionError = ApiError.extend({
  setIndex: SetIndex.optional().meta({ description: 'The place in `sets` of the set the error is about, from 0, only when it is about one of them' }),
}).meta({ id: 'NewSessionError' })
const NewSessionConflictError = ConflictError.extend({
  ...NewSessionError.pick({ setIndex: true }).shape,
  otherSetIndex: SetIndex.optional().meta({
    description: 'The place in `sets` of the set in the way, from 0, when it is another of them, which is not saved: `session` and `set` are then null',
  }),
}).meta({ id: 'NewSessionConflictError' })

const NO_SUCH_SESSION_ERROR: ApiError = { ok: false, error: NO_SUCH_SESSION }
const NO_SUCH_SET: ApiError = { ok: false, error: 'No such set' }

// Why a request failed, and what's in the way, when it's about a session or a set, and which of the sets added with a
// session it's about, if it's about one of them, and the one in the way, if that's another one of them.
type Failure = {
  status: 400 | 409 | 413 | 502
  error: string
  session?: StoredSession | null
  set?: StoredSet | null
  setIndex?: number
  otherSetIndex?: number
}

export function link(id: string | null, url: (id: string) => string): z.infer<typeof Link> | null {
  return id === null ? null : { id, url: url(id) }
}

function applicationLink(row: StoredSession | StoredSet): z.infer<typeof ApplicationLink> | null {
  return row.application && { id: row.application.id, receivedAt: row.application.receivedAt.toISOString() }
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

// The set `row`.
function setBody(row: StoredSet): SetBody {
  return {
    id: row.id,
    performers: row.performers,
    durationMinutes: row.durationMinutes,
    performanceTypes: row.performanceTypes,
    otherPerformanceType: row.otherPerformanceType,
    genres: row.genres,
    soundcloudTrack: row.soundcloudTrackId === null ? null : { id: row.soundcloudTrackId, url: row.soundcloudTrackUrl! },
    youtubeVideo: link(row.youtubeVideoId, youtubeVideoUrl),
    application: applicationLink(row),
    ...tracked(row),
  }
}

function sessionBody(row: StoredSession): SessionBody {
  return {
    id: row.id,
    start: row.startAt?.toISOString() ?? null,
    end: row.startAt && after(row.startAt, row.durationMinutes).toISOString(),
    durationMinutes: row.durationMinutes,
    type: row.type,
    takeover: row.takeover,
    application: applicationLink(row),
    name: row.name,
    title: sessionTitle(row),
    raEvent: link(row.raEventId, raEventUrl),
    description: row.description,
    effectiveDescription: effectiveDescription(row),
    hasFlyer: row.flyerKey !== null,
    sets: row.sets.map(setBody),
    ...tracked(row),
    announced: row.announced,
    announcedUpdatedBy: row.announcedUpdatedBy,
    announcedUpdatedAt: row.announcedUpdatedAt?.toISOString() ?? null,
  }
}

// What a 409 responds, with what's in the way (see `ConflictError`).
export function conflictBody({ error, session, set }: { error: string; session?: StoredSession | null; set?: StoredSet | null }) {
  return {
    ok: false as const,
    error,
    session: session ? sessionBody(session) : null,
    // A set in the way always comes with its session.
    set: set && session ? setBody(set) : null,
  }
}

// The sets and the sessions that come from an application, as its endpoints return them (see "Applications" in
// docs/design/server/applications.md).
const ApplicationSession = SessionBody.pick({ id: true, title: true, start: true, end: true, durationMinutes: true, status: true }).meta({ id: 'ApplicationSession' })
const ApplicationSet = SetBody.pick({ id: true, durationMinutes: true, status: true })
  .extend({ session: SessionBody.pick({ id: true, title: true, start: true }).meta({ description: "The set's session" }) })
  .meta({ id: 'ApplicationSet' })
export const ApplicationLinks = {
  sets: z
    .array(ApplicationSet)
    .meta({ description: "The sets that come from it, which only an artist's application has, in the order of the sessions, then of their sets" }),
  sessions: z
    .array(ApplicationSession)
    .meta({ description: "The sessions that come from it, which only a collective's application has, in the order of the sessions" }),
}
export type ApplicationLinks = { sets: z.infer<typeof ApplicationSet>[]; sessions: z.infer<typeof ApplicationSession>[] }

export const NO_LINKS: ApplicationLinks = { sets: [], sessions: [] }

// The sets and the sessions of `sessions`, in the order of `GET /api/admin/sessions`, that come from an application, by
// the application's id.
export function linksByApplication(sessions: StoredSession[]): Map<string, ApplicationLinks> {
  const links = new Map<string, ApplicationLinks>()
  const of = (applicationId: string) => {
    if (!links.has(applicationId)) links.set(applicationId, { sets: [], sessions: [] })
    return links.get(applicationId)!
  }
  for (const session of sessions) {
    if (session.application) {
      const { id, title, start, end, durationMinutes, status } = sessionBody(session)
      of(session.application.id).sessions.push({ id, title, start, end, durationMinutes, status })
    }
    const ofSession = { id: session.id, title: sessionTitle(session), start: session.startAt?.toISOString() ?? null }
    for (const set of session.sets) {
      if (!set.application) continue
      of(set.application.id).sets.push({ id: set.id, durationMinutes: set.durationMinutes, status: set.status, session: ofSession })
    }
  }
  return links
}

type SessionsOptions = {
  store: SessionsStore
  // Where sessions' flyers are kept, with artists' photos.
  photos: Photos
  // The id of the track a link to it on soundcloud.com leads to, through the SoundCloud app, or null when SoundCloud
  // shows no track there. Throws a NoSoundCloudCredentials until the app's credentials are entered.
  resolveTrack: (link: string) => Promise<string | null>
}

export async function sessionsRoutes(app: FastifyInstance, { store, photos, resolveTrack }: SessionsOptions) {
  // Needed by `readSessionForm`, which sets its own limits.
  await app.register(multipart)

  const api = zodRoutes(app)
  // The messages of these routes' schemas are whole sentences, which are sent as they are.
  app.setSchemaErrorFormatter(firstIssue)

  // Responds that a request failed: a 409 always has `session` and `set` (see `ConflictError`), and an error about one of
  // the sets added with a session has its `setIndex`, and the `otherSetIndex` of the one in the way, if there's one.
  function fail(reply: FastifyReply, { status, setIndex, otherSetIndex, ...failure }: Failure) {
    if (status !== 409) return reply.status(status).send({ ok: false as const, error: failure.error, setIndex })
    return reply.status(409).send({ ...conflictBody(failure), setIndex, otherSetIndex })
  }

  // Runs `save`, which saves a session or a set, and responds with the session it returns, or 404 with `notFound` when
  // it returns null, or the error it throws when it's expected. When it fails, the flyer stored for it, `newFlyer`, if
  // any, is deleted.
  function saving(reply: FastifyReply, notFound: ApiError, save: () => Promise<StoredSession | null>, newFlyer: string | null = null) {
    return savingAs(reply, notFound, save, (saved) => ({ ok: true as const, session: sessionBody(saved) }), newFlyer)
  }

  // Like `saving`, but responds with what `respond` makes of what `save` returns.
  async function savingAs<Saved, Response>(
    reply: FastifyReply,
    notFound: ApiError,
    save: () => Promise<Saved | null>,
    respond: (saved: Saved) => Response,
    newFlyer: string | null = null,
  ) {
    let saved: Saved | null
    try {
      saved = await save()
    } catch (error) {
      await forgetPhoto(photos, reply.log, newFlyer)
      if (error instanceof NoSuchReference || error instanceof BrokenFields) return fail(reply, { status: 400, error: error.message, setIndex: error.setIndex })
      if (error instanceof Conflict) {
        const { message, session, set, setIndex, otherSetIndex } = error
        return fail(reply, { status: 409, error: message, session, set, setIndex, otherSetIndex })
      }
      throw error
    }
    if (!saved) {
      await forgetPhoto(photos, reply.log, newFlyer)
      return reply.status(404).send(notFound)
    }
    return respond(saved)
  }

  // Stores the flyer that was sent, if there's one, and returns where, as a session keeps it.
  async function storeFlyer(flyer: SentPhoto | null): Promise<StoredFlyer> {
    return flyer ? { flyerKey: await photos.store(flyer, 'sessions'), flyerType: flyer.type } : { flyerKey: null, flyerType: null }
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

  // What's saved of the fields that were sent, all of them, or some of them for a change, whose others are then
  // undefined, which leaves them as they are, for the set as it was, `before`, if it's changed, or the error to respond
  // with. The track is only resolved when it's sent.
  async function setChanges(fields: SetFields, before: null): Promise<SetChanges | Failure>
  async function setChanges(fields: Partial<SetFields>, before: SetRow): Promise<Partial<SetChanges> | Failure>
  async function setChanges(fields: Partial<SetFields>, before: SetRow | null): Promise<Partial<SetChanges> | Failure> {
    const { soundcloudTrack, youtubeVideo, application, ...rest } = fields
    const changes = { ...rest, youtubeVideoId: youtubeVideo, applicationId: application }
    if (soundcloudTrack === undefined) return changes
    const track = soundcloudTrack === null ? null : await trackId(soundcloudTrack, before)
    if (typeof track === 'object' && track !== null) return track
    return { ...changes, soundcloudTrackId: track, soundcloudTrackUrl: soundcloudTrack }
  }

  function statusChangedBy(by: string): StatusChangedBy {
    return { statusUpdatedBy: by, statusUpdatedAt: new Date() }
  }

  function statusChange(status: z.infer<typeof Status>, by: string) {
    return { status, ...statusChangedBy(by) }
  }

  const StatusBody = z.strictObject({ status: Status }, { error: objectError(BAD_STATUS) })
  const BAD_ANNOUNCED = 'announced must be true or false'
  const AnnouncedBody = z.strictObject({ announced: z.boolean({ error: BAD_ANNOUNCED }) }, { error: objectError(BAD_ANNOUNCED) })

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
      if (!row) return reply.status(404).send(NO_SUCH_SESSION_ERROR)
      return { ok: true as const, session: sessionBody(row) }
    },
  )

  api.get(
    '/api/admin/sessions/:id/ra-event',
    {
      config: { admin: true, tool: { title: "Voir le contenu de l'événement RA d'une session" } },
      schema: {
        operationId: 'get_session_ra_event',
        summary: "The content of a session's event on Resident Advisor, which an admin creates there from it",
        tags: ['Sessions'],
        params: ById,
        response: { 200: z.object({ ok: z.literal(true), event: RaEventContent }), 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_SESSION_ERROR)
      return { ok: true as const, event: raEventContent(sessionBody(row)) }
    },
  )

  api.get(
    '/api/admin/sessions/:id/flyer',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "A session's flyer",
        tags: ['Sessions'],
        params: ById,
        response: { ...FlyerResponses, 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_SESSION_ERROR)
      return sendPhoto(reply, request.log, photos, { photoKey: row.flyerKey, photoType: row.flyerType }, 'session', 'flyer')
    },
  )

  api.post(
    '/api/admin/sessions',
    {
      config: { admin: true, tool: { title: 'Ajouter une session' } },
      schema: {
        operationId: 'create_session',
        summary: "Adds a session, as planned, with or without a flyer, and the sets it's given, if any, all of them or nothing",
        tags: ['Sessions'],
        multipart: NewSessionForm,
        response: { 200: SessionResponse, 400: NewSessionError, 409: NewSessionConflictError, 413: ApiError, 502: NewSessionError },
      },
    },
    async (request, reply) => {
      const sent = await readSessionForm(request, NewSessionFields)
      if ('error' in sent) return fail(reply, sent)
      const { sets: sentSets = [], ...fields } = sent.fields
      const createdBy = request.user!.email
      // Their tracks are resolved once everything that was sent is valid, before anything is stored.
      const sets: NewSet[] = []
      for (const [setIndex, set] of sentSets.entries()) {
        const saved = await setChanges(set, null)
        if ('error' in saved) return fail(reply, { ...saved, setIndex })
        sets.push({ ...saved, createdBy })
      }
      const flyer = await storeFlyer(sent.flyer)
      const session = { ...sessionChanges(fields), ...flyer, createdBy }
      // It can't be missing once it's added.
      return saving(reply, NO_SUCH_SESSION_ERROR, () => store.create(session, sets), flyer.flyerKey)
    },
  )

  // Saves `fields` to the session with the id of `request`, all of them or some of them, with `sentFlyer`, which replaces
  // its own, or none when `removeFlyer`, and responds with the session as it is then.
  async function updateSession(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    fields: Partial<SessionFields>,
    sentFlyer: SentPhoto | null,
    removeFlyer: boolean,
  ) {
    // The session's new flyer, or none if it's removed. Otherwise, the session keeps its own.
    const flyer = sentFlyer || removeFlyer ? await storeFlyer(sentFlyer) : null
    const changes = { ...sessionChanges(fields), ...flyer, updatedBy: request.user!.email, updatedAt: new Date() }
    const update = async () => {
      const changed = await store.update(request.params.id, changes)
      // The flyer the session had, which was replaced or removed, once the session is saved.
      if (changed && flyer) await forgetPhoto(photos, request.log, changed.before.flyerKey)
      return changed?.after ?? null
    }
    return saving(reply, NO_SUCH_SESSION_ERROR, update, flyer?.flyerKey)
  }

  // Not a tool: tools change sessions with PATCH, which only sends what it changes (see docs/design/server/mcp.md).
  api.put(
    '/api/admin/sessions/:id',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Replaces a session's fields, and replaces or removes its flyer, but not its status, whether it's announced, or its sets, which keep their order",
        tags: ['Sessions'],
        params: ById,
        multipart: SessionForm,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError, 413: ApiError },
      },
    },
    async (request, reply) => {
      const sent = await readSessionForm(request, SessionFields)
      if ('error' in sent) return fail(reply, sent)
      if (sent.flyer && sent.removeFlyer) return reply.status(400).send({ ok: false, error: INVALID_REQUEST.error })
      return updateSession(request, reply, sent.fields, sent.flyer, sent.removeFlyer)
    },
  )

  api.patch(
    '/api/admin/sessions/:id',
    {
      config: { admin: true, tool: { title: 'Modifier une session' } },
      schema: {
        operationId: 'update_session',
        summary: "Changes a session, only the fields it's given, or removes its flyer, but not its status, whether it's announced, or its sets, which keep their order",
        tags: ['Sessions'],
        params: ById,
        body: SessionChangesBody,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError },
      },
    },
    async (request, reply) => {
      const { removeFlyer, ...fields } = request.body
      return updateSession(request, reply, fields, null, removeFlyer === true)
    },
  )

  // Not a tool: tools can't send files (see docs/design/server/mcp.md).
  api.put(
    '/api/admin/sessions/:id/flyer',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Gives a session a flyer, or replaces its flyer, which is deleted, and changes nothing else',
        tags: ['Sessions'],
        params: ById,
        multipart: FlyerForm,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 413: ApiError },
      },
    },
    async (request, reply) => {
      // Other fields and files are ignored, but not a second flyer (see `readPhotoForm`).
      const form = await readPhotoForm(request, { photoPart: 'flyer' })
      if (form === 'malformed') return fail(reply, INVALID_REQUEST)
      if ('tooLarge' in form) return fail(reply, { status: 413, error: FLYER_ERRORS.tooLarge })
      let flyer: SentPhoto | null
      try {
        flyer = validatePhoto(form.photo, FLYER_ERRORS)
      } catch (error) {
        if (!(error instanceof InvalidProfile)) throw error
        return fail(reply, { status: 400, error: error.message })
      }
      if (!flyer) return fail(reply, { status: 400, error: 'The request has no flyer' })
      return updateSession(request, reply, {}, flyer, false)
    },
  )

  api.put(
    '/api/admin/sessions/:id/status',
    {
      config: { admin: true, tool: { title: "Changer le statut d'une session" } },
      schema: {
        operationId: 'update_session_status',
        summary: "Marks a session as planned, done or cancelled: cancelling it cancels its sets, and marking it done marks its planned sets done",
        tags: ['Sessions'],
        params: ById,
        body: StatusBody,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError },
      },
    },
    async (request, reply) => {
      const change = statusChange(request.body.status, request.user!.email)
      return saving(reply, NO_SUCH_SESSION_ERROR, () => store.setStatus(request.params.id, change))
    },
  )

  api.put(
    '/api/admin/sessions/:id/announced',
    {
      config: { admin: true, tool: { title: 'Annoncer une session, ou retirer son annonce' } },
      schema: {
        operationId: 'update_session_announced',
        summary: `Announces a session, ${WHAT_ANNOUNCING_DOES}, or un-announces it`,
        tags: ['Sessions'],
        params: ById,
        body: AnnouncedBody,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError },
      },
    },
    async (request, reply) => {
      const change = { announced: request.body.announced, announcedUpdatedBy: request.user!.email, announcedUpdatedAt: new Date() }
      return saving(reply, NO_SUCH_SESSION_ERROR, () => store.setAnnounced(request.params.id, change))
    },
  )

  api.delete(
    '/api/admin/sessions/:id',
    {
      config: { admin: true, tool: { title: 'Supprimer une session' } },
      schema: {
        operationId: 'delete_session',
        summary: 'Deletes a session, its flyer and its sets, but not their performers',
        tags: ['Sessions'],
        params: ById,
        response: { 200: Ok, 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.delete(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_SESSION_ERROR)
      // The session is gone either way.
      await forgetPhoto(photos, request.log, row.flyerKey)
      return { ok: true as const }
    },
  )

  api.post(
    '/api/admin/sessions/:id/sets',
    {
      config: { admin: true, tool: { title: 'Ajouter un set' } },
      schema: {
        operationId: 'create_set',
        summary: 'Adds a set to a session, as planned, after its other sets, and returns the session, which this can make planned again',
        tags: ['Sessions'],
        params: ById,
        body: SetFields,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError, 502: ApiError },
      },
    },
    async (request, reply) => {
      // Before the track is resolved, and again once the set is saved, in case the session changes in the meantime.
      const session = await store.get(request.params.id)
      if (!session) return reply.status(404).send(NO_SUCH_SESSION_ERROR)
      if (session.status === 'cancelled') return fail(reply, { status: 409, error: SESSION_CANCELLED, session })
      const saved = await setChanges(request.body, null)
      if ('error' in saved) return fail(reply, saved)
      const set = { ...saved, createdBy: request.user!.email }
      return saving(reply, NO_SUCH_SESSION_ERROR, () => store.addSet(session.id, set))
    },
  )

  // Saves `fields` to the set with the id of `request`, all of them or some of them, and responds with its session as it
  // is then.
  async function updateSet(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, fields: Partial<SetFields>) {
    // Before the track is resolved, which it isn't when it's the set's already.
    const before = await store.getSet(request.params.id)
    if (!before) return reply.status(404).send(NO_SUCH_SET)
    const saved = await setChanges(fields, before)
    if ('error' in saved) return fail(reply, saved)
    const changes = { ...saved, updatedBy: request.user!.email, updatedAt: new Date() }
    return saving(reply, NO_SUCH_SET, () => store.updateSet(before.id, changes))
  }

  // Not a tool: tools change sets with PATCH, which only sends what it changes (see docs/design/server/mcp.md).
  api.put(
    '/api/admin/sets/:id',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Replaces a set's fields, but not its session, its place among the session's sets, or its status, and returns its session",
        tags: ['Sessions'],
        params: ById,
        body: SetFields,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError, 502: ApiError },
      },
    },
    async (request, reply) => updateSet(request, reply, request.body),
  )

  api.patch(
    '/api/admin/sets/:id',
    {
      config: { admin: true, tool: { title: 'Modifier un set' } },
      schema: {
        operationId: 'update_set',
        summary: "Changes a set, only the fields it's given, but not its session, its place among the session's sets, or its status, and returns its session",
        tags: ['Sessions'],
        params: ById,
        body: SetChangesBody,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError, 409: ConflictError, 502: ApiError },
      },
    },
    async (request, reply) => updateSet(request, reply, request.body),
  )

  api.put(
    '/api/admin/sets/:id/status',
    {
      config: { admin: true, tool: { title: "Changer le statut d'un set" } },
      schema: {
        operationId: 'update_set_status',
        summary: 'Marks a set as planned, done or cancelled, and returns its session, which this can make done, or planned again',
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

  api.put(
    '/api/admin/sets/:id/position',
    {
      config: { admin: true, tool: { title: "Changer la place d'un set dans sa session" } },
      schema: {
        operationId: 'update_set_position',
        summary: "Moves a set to another place among its session's sets, the others keeping their order, and returns its session",
        tags: ['Sessions'],
        params: ById,
        body: SetPosition,
        response: { 200: SessionResponse, 400: ApiError, 404: ApiError },
      },
    },
    async (request, reply) => saving(reply, NO_SUCH_SET, () => store.moveSet(request.params.id, request.body.position)),
  )

  api.put(
    '/api/admin/sets/:id/session',
    {
      config: { admin: true, tool: { title: 'Déplacer un set dans une autre session' } },
      schema: {
        operationId: 'update_set_session',
        summary:
          "Moves a set to another session, after its sets, without changing its status, and returns that session, and the one it was in, whose statuses this can change",
        tags: ['Sessions'],
        params: ById,
        body: SetSession,
        response: { 200: MovedSetResponse, 400: ApiError, 404: ApiError, 409: ConflictError },
      },
    },
    async (request, reply) => {
      const by = { updatedBy: request.user!.email, updatedAt: new Date() }
      return savingAs(
        reply,
        NO_SUCH_SET,
        () => store.moveSetToSession(request.params.id, request.body.session, by),
        ({ session, previousSession }) => ({ ok: true as const, session: sessionBody(session), previousSession: sessionBody(previousSession) }),
      )
    },
  )

  api.delete(
    '/api/admin/sets/:id',
    {
      config: { admin: true, tool: { title: 'Supprimer un set' } },
      schema: {
        operationId: 'delete_set',
        summary: 'Deletes a set, but not its performers, and returns its session, which this can make done',
        tags: ['Sessions'],
        params: ById,
        response: { 200: SessionResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      // Who deleted it, and when, which its session's status gets when that makes it done.
      const by = statusChangedBy(request.user!.email)
      return saving(reply, NO_SUCH_SET, () => store.deleteSet(request.params.id, by))
    },
  )
}
