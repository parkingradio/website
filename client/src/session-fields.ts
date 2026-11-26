import type { Schema } from './api/client'
import { OTHER_PERFORMANCE_TYPE_MAX_LENGTH, PERFORMANCE_TYPES, isDay, isTime } from './application-fields'
import type { PerformanceTypeId } from './application-fields'
import type { GenreId } from './artist-profile'
import { checkLine, checkText, everyOne } from './checks'
import type { FieldErrors } from './checks'
import { addDays, daysBetween, quebecDateTime, quebecDayAndTime, quebecInstant, quebecInstants } from './quebec-time'
import { isSoundcloudTrackLink, youtubeVideoId, youtubeVideoUrl } from './session-links'
import { TIME_SLOTS } from './time-slots'
import type { TimeSlot, TimeSlotId } from './time-slots'

// How sessions and sets are checked in the browser, by the admin pages, and how their forms' times of day become what the
// server takes (see docs/design/client/admin/sessions.md).
//
// The forms check sessions and sets as the server does, to say what's wrong right away, with a copy of the server's rules
// (see server/src/sessions/fields.ts), which must be changed together with these. Their messages are in French, unlike
// the server's. The server's are the ones that count: when they disagree, the server's message shows. The rules that
// involve other sessions or sets, e.g. that sessions don't overlap, are only the server's. Whether a session's sets add up
// to more than it isn't checked: the server allows it, and the lists of its sets say so.

export type Session = Schema<'Session'>
// A set, as the endpoints return it. Not `Set`, which is JavaScript's.
export type StudioSet = Schema<'Set'>
export type SessionStatus = Schema<'SessionStatus'>
export type SessionType = Schema<'SessionType'>
// A session's fields, as adding one sends them without its sets, and as changing one sends them.
export type SessionFields = Omit<Schema<'NewSessionFields'>, 'sets'>
export type SetFields = Schema<'SetFields'>
// An artist or a collective, by their id and name, as sessions and sets name them.
export type Reference = Schema<'Reference'>
// An event on RA, by its id and the link to its page, as sessions give it.
export type RaEventLink = Schema<'SessionLink'>
// The application a session or a set comes from, by its id and when it was received, as they give it.
export type ApplicationLink = Schema<'ApplicationLink'>
// Who an application belongs to, by their id.
type ApplicationOwner = Pick<Schema<'Application'>, 'id' | 'artistId' | 'collectiveId'>
// Who the applications a session or a set can come from belong to, or null when they couldn't be loaded, which leaves
// checking them to the server.
export type ApplicationOwners = ApplicationOwner[] | null

// Whether an application can be that of a set of `performers`, or of a takeover of the collective `takeover` (see
// "Applications" in docs/design/server/sessions.md).
export const isPerformersApplication = (application: ApplicationOwner, performers: { id: string }[]) =>
  performers.some(({ id }) => id === application.artistId)
export const isCollectivesApplication = (application: ApplicationOwner, takeover: { id: string } | null) =>
  takeover !== null && application.collectiveId === takeover.id

const NOT_THE_SETS_APPLICATION = "La candidature doit être celle d'un des artistes du set\u00a0: choisissez-en une autre, ou «\u00a0Aucune candidature\u00a0»."
const NOT_THE_SESSIONS_APPLICATION = 'La candidature doit être celle du collectif du takeover\u00a0: choisissez-en une autre, ou «\u00a0Aucune candidature\u00a0».'
const ANNOUNCED_HAS_A_DATE = "Une session annoncée a une date\u00a0: retirez d'abord son annonce."

// In the order sessions and sets go through them (see describe.ts for their names).
export const STATUSES = everyOne<SessionStatus>()(['planned', 'done', 'cancelled'])

// In the order the session form offers them (see describe.ts for their names).
export const SESSION_TYPES = everyOne<SessionType>()(['guest-mixes', 'live-performance', 'takeover', 'synth-meetup', 'other'])

const NAMES: Record<Exclude<SessionType, 'takeover' | 'other'>, string> = {
  'guest-mixes': 'GUEST MIXES',
  'live-performance': 'LIVE PERFORMANCE',
  'synth-meetup': 'SYNTH MEETUPS',
}

// The name a session of `type` is given, from the name of the collective whose takeover it is, for a takeover, or null
// for a session of type "other", which has its own, or for a takeover until its collective is known. The session form
// shows it, before the server gives it as part of the session's title (see `sessionTitle` in
// server/src/sessions/fields.ts).
export function typeName(type: SessionType, takeover: Pick<Reference, 'name'> | null): string | null {
  if (type === 'takeover') return takeover && `${takeover.name.toUpperCase()} TAKEOVER`
  return type === 'other' ? null : NAMES[type]
}

// The description each type of session gives it, unless it has its own, or "" for none: a copy of the server's
// DEFAULT_DESCRIPTIONS (see server/src/sessions/descriptions.ts), which must be changed together with it. The session form
// shows it, before the server gives it as part of the session's `effectiveDescription`.
const STREAMED = 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC'
export const TYPE_DESCRIPTIONS: Record<SessionType, string> = {
  'guest-mixes': STREAMED,
  'live-performance': STREAMED,
  takeover: STREAMED,
  'synth-meetup': `SYNTH MEETUPS

Rencontres hebdomadaires de création sonore et audiovisuelle

MANDAT

• Désacraliser l'accès aux contextes de diffusion.

• Partager le savoir concernant les pratiques de création temps-réel numériques.

• Favoriser les processus collaboratifs.

• Archiver les pratiques éphémères.

LE PLAFOND

Vous êtes invitez à tester du contenu visuel, audio réactif ou pas, conçu pour notre plafond.

Voici comment:

Le plafond lumineux regroupe près de 5000 LEDs adressables pour former un "écran".
Ainsi, la création de contenu est simplifié; nul besoin de savoir programmer.

Une approche temps-réel est priorisée afin de rapprocher les artistes de leur médium et de sa diffusion.

En gros, l'artiste se pointe au parking avec son laptop et shoot ses visuels direct dans le plafond en format vidéo. Il suffit d'envoyer de la vidéo au système via réseau en utilisant NDI. La vidéo sera automatiquement redimensionnée (240 x 228 pixels) pour couvrir la surface.`,
  other: '',
}

const NAME_MAX_LENGTH = 100
export const DESCRIPTION_MAX_LENGTH = 5000
// Sessions take place within the years 2000 to 2999, in UTC: they start in them, and end by the start of 3000. So a
// duration, a session's or a set's, is at most the time from the start of 2000 to the start of 3000.
const EARLIEST = Date.parse('2000-01-01T00:00:00Z')
const LATEST = Date.parse('3000-01-01T00:00:00Z')
const MINUTE_MS = 60 * 1000
const MAX_MINUTES = (LATEST - EARLIEST) / MINUTE_MS

// A number of hours and minutes as a form has it: two numbers as they're typed, which are empty while they're not filled.
export type Duration = { hours: string; minutes: string }

const EMPTY_DURATION: Duration = { hours: '', minutes: '' }

export function durationOf(minutes: number | null): Duration {
  return minutes === null ? EMPTY_DURATION : { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) }
}

// The minutes of a duration, or null when it's left empty, or undefined when it isn't whole hours and minutes, or is
// longer than any can be. Either number can be left empty, for none.
export function minutesOf({ hours, minutes }: Duration): number | null | undefined {
  if (!hours.trim() && !minutes.trim()) return null
  const parse = (value: string, max: number) => (!value.trim() ? 0 : /^\d+$/.test(value.trim()) && Number(value) <= max ? Number(value) : undefined)
  const h = parse(hours, Infinity)
  const m = parse(minutes, 59)
  return h === undefined || m === undefined || h * 60 + m > MAX_MINUTES ? undefined : h * 60 + m
}

// The minutes between two instants, which are whole minutes since the forms' times are.
function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MINUTE_MS)
}

// `minutes` after `start`, in minutes that actually pass.
function after(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * MINUTE_MS)
}

const SKIPPED = "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été."

const YEARS = 'Une session a lieu entre les années 2000 et 2999.'

// What's wrong with the days ("YYYY-MM-DD") and the times ("HH:MM") a session starts and ends at, if they're missing or
// aren't days and times. Browsers let years have more than 4 digits, which aren't days.
function checkDaysAndTimes({ day, start, endDay, end }: SessionFormValues): FieldErrors<SessionFormValues> {
  const errors: FieldErrors<SessionFormValues> = {}
  if (!day) errors.day = 'Choisissez la date de début.'
  else if (!isDay(day)) errors.day = 'La date de début est invalide.'
  if (!start) errors.start = "Indiquez l'heure de début."
  else if (!isTime(start)) errors.start = "L'heure de début est invalide."
  if (!endDay) errors.endDay = 'Choisissez la date de fin.'
  else if (!isDay(endDay)) errors.endDay = 'La date de fin est invalide.'
  if (!end) errors.end = "Indiquez l'heure de fin."
  else if (!isTime(end)) errors.end = "L'heure de fin est invalide."
  return errors
}

// Sessions.

// A session as the form has it: the days and times it starts and ends at in Québec time, as "YYYY-MM-DD" and "HH:MM", or
// its duration when its date isn't known yet (`undated`), its type, or null until it's picked, its takeover's collective
// as it's shown, which it keeps while another type is picked, but only a takeover sends, the application it comes from,
// likewise, and the rest as it's typed.
export type SessionFormValues = {
  undated: boolean
  // The day it starts, and the last one it had that was a day, which the day it ends keeps its distance from, even when
  // the day it starts is cleared in between (see `startChanges`).
  day: string
  lastDay: string
  start: string
  endDay: string
  end: string
  duration: Duration
  // The days and times the form opened with, e.g. a session's, and what they stood for: its start or its end left as it
  // was stands for what it stood for, even when a time happens twice and the one meant is the second (see `sessionTimes`).
  opened?: { day: string; start: string; endDay: string; end: string; startAt: Date; endAt: Date }
  type: SessionType | null
  takeover: Reference | null
  application: ApplicationLink | null
  name: string
  raEvent: RaEventLink | null
  description: string
}

export const EMPTY_SESSION_FORM: SessionFormValues = {
  undated: false,
  day: '',
  lastDay: '',
  start: '',
  endDay: '',
  end: '',
  duration: EMPTY_DURATION,
  type: null,
  takeover: null,
  application: null,
  name: '',
  raEvent: null,
  description: '',
}

// A session as the form shows it, to change it.
export function sessionFormValues(session: Session): SessionFormValues {
  const values = {
    ...EMPTY_SESSION_FORM,
    duration: durationOf(session.durationMinutes),
    type: session.type,
    takeover: session.takeover,
    application: session.application,
    name: session.name,
    raEvent: session.raEvent,
    description: session.description,
  }
  if (session.start === null) return { ...values, undated: true }
  const startAt = new Date(session.start)
  const endAt = after(startAt, session.durationMinutes)
  const start = quebecDayAndTime(startAt)
  const end = quebecDayAndTime(endAt)
  const shown = { day: start.day, start: start.time, endDay: end.day, end: end.time }
  return { ...values, ...shown, lastDay: start.day, opened: { ...shown, startAt, endAt } }
}

type SessionTimes = { start: Date | null; durationMinutes: number }

// When a session starts, or null when its date isn't known yet, and how long it lasts, from the days and times it starts
// and ends at, in Québec time, or its duration (see "Times" in docs/design/client/admin/sessions.md), or what's wrong
// with them instead.
export function sessionTimes(form: SessionFormValues): SessionTimes | { errors: FieldErrors<SessionFormValues> } {
  if (form.undated) {
    const durationMinutes = minutesOf(form.duration)
    if (durationMinutes === null) return { errors: { duration: 'Indiquez la durée de la session.' } }
    if (durationMinutes === undefined || durationMinutes < 1) return { errors: { duration: 'La durée est invalide.' } }
    return { start: null, durationMinutes }
  }
  const { day, start, endDay, end, opened } = form
  const errors = checkDaysAndTimes(form)
  if (Object.keys(errors).length > 0) return { errors }

  const startAt = opened && opened.day === day && opened.start === start ? opened.startAt : quebecInstant(day, start)
  if (!startAt) errors.start = SKIPPED
  else if (startAt.getTime() < EARLIEST || startAt.getTime() >= LATEST) errors.day = YEARS
  const ends = opened && opened.endDay === endDay && opened.end === end ? [opened.endAt] : quebecInstants(endDay, end)
  if (ends.length === 0) errors.end = SKIPPED
  if (!startAt || Object.keys(errors).length > 0) return { errors }
  // When the clocks show it twice, the first of the two that's after the start.
  const endAt = ends.find((instant) => instant > startAt)
  if (!endAt) return { errors: { end: 'La fin doit être après le début.' } }
  if (endAt.getTime() > LATEST) return { errors: { endDay: YEARS } }
  return { start: startAt, durationMinutes: minutesBetween(startAt, endAt) }
}

// What changing the day (`day`) or the time (`start`) a session starts at changes in the form `form`. Once the start's
// day is a day, the end's day keeps its distance in days from the last day the start had, or takes the start's day
// while it's empty. Once the start is a day and a time the clocks show, an empty end time is filled in, with its day, as
// long after it as the duration, e.g. that of a session whose date wasn't known (see "The session form" in
// docs/design/client/admin/sessions.md).
export function startChanges(form: SessionFormValues, changes: Partial<Pick<SessionFormValues, 'day' | 'start'>>): Partial<SessionFormValues> {
  const result: Partial<SessionFormValues> = { ...changes }
  const day = changes.day ?? form.day
  if (changes.day !== undefined && isDay(day)) {
    result.lastDay = day
    if (!form.endDay) result.endDay = day
    else if (isDay(form.endDay) && isDay(form.lastDay)) result.endDay = addDays(form.endDay, daysBetween(form.lastDay, day))
  }
  const start = changes.start ?? form.start
  const lasts = minutesOf(form.duration)
  const startAt = !form.end && lasts && isDay(day) && isTime(start) ? quebecInstant(day, start) : null
  if (startAt) {
    const end = quebecDayAndTime(after(startAt, lasts!))
    Object.assign(result, { endDay: end.day, end: end.time })
  }
  return result
}

// How long `slot` lasts, in minutes.
function slotMinutes({ start, end }: TimeSlot): number {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  return minutes(end) - minutes(start)
}

// What picking `slot` changes in `form`: its times, with the end on the start's day, which is empty while the start has
// none, or only the duration while the session's date isn't known (see "The session form" in
// docs/design/client/admin/sessions.md).
export function slotChanges(form: SessionFormValues, slot: TimeSlot): Partial<SessionFormValues> {
  if (form.undated) return { duration: durationOf(slotMinutes(slot)) }
  return { start: slot.start, end: slot.end, endDay: form.day }
}

// The time slot whose times are the start's and the end's, with the end on the start's day, or null, e.g. while the
// session's date isn't known.
export function pickedSlot({ undated, day, start, endDay, end }: SessionFormValues): TimeSlotId | null {
  if (undated || endDay !== day) return null
  return TIME_SLOTS.find((slot) => slot.start === start && slot.end === end)?.id ?? null
}

// Checks a session as it's being filled in the form, with its `times` if they're worked out already, who the
// `applications` it can come from belong to, and whether it's `announced`, which it has to have a date for, and returns
// what the server would be sent, or what's wrong with each field instead. The start is sent with Québec's offset from
// UTC, and the event on RA by its id.
export function checkSession(
  form: SessionFormValues,
  times = sessionTimes(form),
  applications: ApplicationOwners = null,
  announced = false,
): { fields: SessionFields; errors?: undefined } | { fields?: undefined; errors: FieldErrors<SessionFormValues> } {
  const errors: FieldErrors<SessionFormValues> = 'errors' in times ? { ...times.errors } : {}
  if (announced && form.undated) errors.undated = ANNOUNCED_HAS_A_DATE
  if (form.type === null) errors.type = 'Choisissez le type de la session.'
  const takeover = form.type === 'takeover' ? form.takeover : null
  if (form.type === 'takeover' && !takeover) errors.takeover = 'Choisissez le collectif du takeover.'
  const application = form.type === 'takeover' ? form.application : null
  const owner = applications?.find(({ id }) => id === application?.id)
  if (takeover && owner && !isCollectivesApplication(owner, takeover)) errors.application = NOT_THE_SESSIONS_APPLICATION
  const name = checkLine(form.name, 'Le nom', NAME_MAX_LENGTH, form.type === 'other' ? 'Indiquez le nom de la session.' : null)
  if (name.error) errors.name = name.error
  // Each \r\n or \r becomes \n, as the server has it, but its spaces and line breaks are kept.
  const description = checkText(form.description.replace(/\r\n?/g, '\n'), 'La description', DESCRIPTION_MAX_LENGTH, null)
  if (description.error) errors.description = description.error
  // A missing type is one of the errors already: checking it again tells the compiler that there's one.
  if (Object.keys(errors).length > 0 || 'errors' in times || form.type === null) return { errors }
  return {
    fields: {
      start: times.start && quebecDateTime(times.start),
      durationMinutes: times.durationMinutes,
      type: form.type,
      takeover: takeover?.id ?? null,
      application: application?.id ?? null,
      name: name.value!,
      raEvent: form.raEvent?.id ?? null,
      description: description.value!,
    },
  }
}

// Sets.

// A set as the form has it: its performers as they're shown, its duration, empty while it isn't known, and the rest as
// it's typed. Its place among its session's sets isn't in its form: it's changed in the list of sets.
export type SetFormValues = {
  performers: Reference[]
  duration: Duration
  performanceTypes: PerformanceTypeId[]
  otherPerformanceType: string
  genres: GenreId[]
  soundcloudTrack: string
  youtubeVideo: string
  // The application it comes from.
  application: ApplicationLink | null
}

// A set as far as its form goes, which a set that's saved is, and so is one that's listed in a new session's form (see
// `ListedSet`).
export type SetValues = Pick<StudioSet, 'performers' | 'performanceTypes' | 'otherPerformanceType' | 'genres' | 'application' | 'durationMinutes'> & {
  soundcloudTrack: { url: string } | null
  youtubeVideo: { url: string } | null
}

const EMPTY_SET_FORM: SetFormValues = {
  performers: [],
  duration: EMPTY_DURATION,
  performanceTypes: [],
  otherPerformanceType: '',
  genres: [],
  soundcloudTrack: '',
  youtubeVideo: '',
  application: null,
}

// A set as the form shows it, to change it.
export function setFormValues(set: SetValues): SetFormValues {
  return {
    performers: set.performers,
    duration: durationOf(set.durationMinutes),
    performanceTypes: set.performanceTypes,
    otherPerformanceType: set.otherPerformanceType,
    genres: set.genres,
    soundcloudTrack: set.soundcloudTrack?.url ?? '',
    youtubeVideo: set.youtubeVideo?.url ?? '',
    application: set.application,
  }
}

// How long a new set lasts by default, which goes after the other sets of a session of `durationMinutes`: an hour, or
// what's left of the session after its sets, cancelled ones included, if that's less, or null when they fill it. A
// session whose duration is null, since its times aren't known yet, is never filled.
export function newSetDuration({ durationMinutes, sets }: { durationMinutes: number | null; sets: Pick<StudioSet, 'durationMinutes'>[] }): number | null {
  if (durationMinutes === null) return 60
  const left = durationMinutes - setsMinutes(sets)
  return left > 0 ? Math.min(60, left) : null
}

// What a new set of a session of `durationMinutes` with `sets` starts with (see `newSetDuration`).
export function newSetFormValues(session: Parameters<typeof newSetDuration>[0]): SetFormValues {
  return { ...EMPTY_SET_FORM, duration: durationOf(newSetDuration(session)) }
}

// Checks a set as it's being filled in the form, and who the `applications` it can come from belong to, and returns
// what the server would be sent, or what's wrong with each field instead. Links are sent as they're typed, but trimmed,
// or null for none.
export function checkSet(
  form: SetFormValues,
  applications: ApplicationOwners = null,
): { fields: SetFields; errors?: undefined } | { fields?: undefined; errors: FieldErrors<SetFormValues> } {
  const errors: FieldErrors<SetFormValues> = {}
  if (form.performers.length === 0) errors.performers = 'Choisissez au moins un artiste.'
  const owner = applications?.find(({ id }) => id === form.application?.id)
  if (owner && !isPerformersApplication(owner, form.performers)) errors.application = NOT_THE_SETS_APPLICATION
  const durationMinutes = minutesOf(form.duration)
  if (durationMinutes === undefined || durationMinutes === 0) errors.duration = 'La durée est invalide.'
  const otherPerformanceType = checkLine(form.otherPerformanceType, 'La prestation « Autre »', OTHER_PERFORMANCE_TYPE_MAX_LENGTH, null)
  if (otherPerformanceType.error) errors.otherPerformanceType = otherPerformanceType.error
  const soundcloudTrack = form.soundcloudTrack.trim()
  if (soundcloudTrack && !isSoundcloudTrackLink(soundcloudTrack)) {
    errors.soundcloudTrack = 'Le lien SoundCloud doit mener à la piste sur soundcloud.com, p. ex. « https://soundcloud.com/parkingdotradio/3tons ».'
  }
  const youtubeVideo = form.youtubeVideo.trim()
  if (youtubeVideo && !youtubeVideoId(youtubeVideo)) errors.youtubeVideo = 'Le lien YouTube est invalide : collez le lien de la vidéo, ou son identifiant.'

  if (Object.keys(errors).length > 0 || durationMinutes === undefined) return { errors }
  return {
    fields: {
      performers: form.performers.map(({ id }) => ({ id })),
      durationMinutes,
      // In the order of the list, like the server keeps them.
      performanceTypes: PERFORMANCE_TYPES.filter((id) => form.performanceTypes.includes(id)),
      otherPerformanceType: otherPerformanceType.value!,
      genres: form.genres,
      soundcloudTrack: soundcloudTrack || null,
      youtubeVideo: youtubeVideo || null,
      application: form.application?.id ?? null,
    },
  }
}

// How long `sets` last together, which a session's sets are meant to do no longer than it: an unknown duration counts
// for nothing, and cancelled sets count too, since they keep their place (see "Sets' order" in
// docs/design/server/sessions.md).
export function setsMinutes(sets: Pick<StudioSet, 'durationMinutes'>[]): number {
  return sets.reduce((sum, set) => sum + (set.durationMinutes ?? 0), 0)
}

// A set listed in a new session's form, to be added with it (see "A new session's sets" in
// docs/design/client/admin/sessions.md): what the server will be sent of it, with its performers and its application as
// they're shown.
export type ListedSet = Omit<SetFields, 'performers' | 'application'> & { performers: Reference[]; application: ApplicationLink | null }

// The set that a set's form, `form`, sends as `fields`, as it's listed.
export function listedSet(fields: SetFields, form: Pick<SetFormValues, 'performers' | 'application'>): ListedSet {
  return { ...fields, performers: form.performers, application: form.application }
}

// What the server is sent of a listed set.
export function listedSetFields({ performers, application, ...fields }: ListedSet): SetFields {
  return { ...fields, performers: performers.map(({ id }) => ({ id })), application: application?.id ?? null }
}

// From an application (see "From an application" in docs/design/client/admin/sessions.md).

// An application, as a set or a session that comes from it gives it.
export const applicationLink = ({ id, receivedAt }: Pick<ApplicationLink, 'id' | 'receivedAt'>): ApplicationLink => ({ id, receivedAt })

// The application whose id is `id`, among `applications`, and its artist, among `artists`, for an artist's, or null for a
// collective's. Null when there's no such application, or undefined when it can't be told, since the applications, or
// the artists for an artist's, couldn't be loaded (null).
export function findApplication(
  id: string,
  applications: Schema<'Application'>[] | null,
  artists: Reference[] | null,
): { application: Schema<'Application'>; artist: Reference | null } | null | undefined {
  if (applications === null) return undefined
  const application = applications.find((application) => application.id === id)
  if (!application) return null
  if (application.artistId === null) return { application, artist: null }
  if (artists === null) return undefined
  // It's there, unless it was deleted, with the application, since the applications were loaded.
  const artist = artists.find((artist) => artist.id === application.artistId)
  return artist ? { application, artist: { id: artist.id, name: artist.name } } : null
}

// What a set filled in from an artist's application has: its artist, as its only performer, its performance types and
// "autre", and the application itself.
export function setValuesFromApplication(
  application: Pick<Schema<'Application'>, 'id' | 'receivedAt' | 'performanceTypes' | 'otherPerformanceType'>,
  artist: Reference,
): Pick<SetFormValues, 'performers' | 'performanceTypes' | 'otherPerformanceType' | 'application'> {
  const { performanceTypes, otherPerformanceType } = application
  return { performers: [artist], performanceTypes, otherPerformanceType, application: applicationLink(application) }
}

// A set listed in a new session's form, filled in from an artist's application, whose duration isn't known yet.
export function listedSetFromApplication(application: Parameters<typeof setValuesFromApplication>[0], artist: Reference): ListedSet {
  return {
    ...setValuesFromApplication(application, artist),
    durationMinutes: null,
    genres: [],
    soundcloudTrack: null,
    youtubeVideo: null,
  }
}

// A listed set as a set is shown and changed, planned. Its links are as they were typed, which its form checked, but a
// video's is shown as YouTube's, since it can be its id.
export function shownSet(set: ListedSet): SetValues & Pick<StudioSet, 'status'> {
  const videoId = set.youtubeVideo && youtubeVideoId(set.youtubeVideo)
  return {
    ...set,
    soundcloudTrack: set.soundcloudTrack === null ? null : { url: set.soundcloudTrack },
    youtubeVideo: videoId ? { url: youtubeVideoUrl(videoId) } : null,
    status: 'planned',
  }
}
