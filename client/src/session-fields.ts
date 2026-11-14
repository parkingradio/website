import type { Schema } from './api/client'
import { OTHER_PERFORMANCE_TYPE_MAX_LENGTH, PERFORMANCE_TYPES, isDay, isTime } from './application-fields'
import type { PerformanceTypeId } from './application-fields'
import type { GenreId } from './artist-profile'
import { checkLine, checkText, everyOne } from './checks'
import type { FieldErrors } from './checks'
import { quebecDateTime, quebecDayAndTime, quebecInstant, quebecInstantFrom } from './quebec-time'
import { isSoundcloudTrackLink, youtubeVideoId } from './session-links'

// How sessions and sets are checked in the browser, by the admin pages, and how their forms' times of day become what the
// server takes (see docs/design/client/admin/sessions.md).
//
// The forms check sessions and sets as the server does, to say what's wrong right away, with a copy of the server's rules
// (see server/src/sessions/fields.ts), which must be changed together with these. Their messages are in French, unlike
// the server's. The server's are the ones that count: when they disagree, the server's message shows. The rules that
// involve other sessions or sets, e.g. that sessions don't overlap, are only the server's. Whether a set fits in its
// session, or overlaps another set, isn't checked: the server allows it, and its session's page marks it.

export type Session = Schema<'Session'>
// A set, as the endpoints return it. Not `Set`, which is JavaScript's.
export type StudioSet = Schema<'Set'>
export type SessionStatus = Schema<'SessionStatus'>
export type SessionType = Schema<'SessionType'>
export type SessionFields = Schema<'SessionFields'>
export type SetFields = Schema<'SetFields'>
// An artist or a collective, by their id and name, as sessions and sets name them.
export type Reference = Schema<'Reference'>
// An event on RA, by its id and the link to its page, as sessions give it.
export type RaEvent = Schema<'SessionLink'>
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
// The longest a session or a set lasts, in minutes. A set's offset is less than that.
const MAX_MINUTES = 24 * 60
const LONGEST = 'Un set dure au plus 24 heures.'
// Sessions start from 2000 to 2999, in UTC.
const EARLIEST = Date.parse('2000-01-01T00:00:00Z')
const LATEST = Date.parse('3000-01-01T00:00:00Z')
const MINUTE_MS = 60 * 1000

// A number of hours and minutes as a form has it: two numbers as they're typed, which are empty while they're not filled.
export type Duration = { hours: string; minutes: string }

const EMPTY_DURATION: Duration = { hours: '', minutes: '' }

export function durationOf(minutes: number | null): Duration {
  return minutes === null ? EMPTY_DURATION : { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) }
}

// The minutes of a duration, or null when it's left empty, or undefined when it isn't whole hours and minutes. Either
// number can be left empty, for none.
export function minutesOf({ hours, minutes }: Duration): number | null | undefined {
  if (!hours.trim() && !minutes.trim()) return null
  const parse = (value: string, max: number) => (!value.trim() ? 0 : /^\d+$/.test(value.trim()) && Number(value) <= max ? Number(value) : undefined)
  const h = parse(hours, 99)
  const m = parse(minutes, 59)
  return h === undefined || m === undefined ? undefined : h * 60 + m
}

// The minutes between two instants, which are whole minutes since the forms' times are.
function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MINUTE_MS)
}

// `minutes` after `start`, in minutes that actually pass.
export function after(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * MINUTE_MS)
}

const SKIPPED = "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été."

// What's wrong with a start and an end time ("HH:MM"), if they're missing or aren't times.
function checkStartEnd<T extends { start: string; end: string }>({ start, end }: T): FieldErrors<T> {
  const errors: FieldErrors<T> = {}
  if (!start) errors.start = "Indiquez l'heure de début."
  else if (!isTime(start)) errors.start = "L'heure de début est invalide."
  if (!end) errors.end = "Indiquez l'heure de fin."
  else if (!isTime(end)) errors.end = "L'heure de fin est invalide."
  return errors
}

// Sessions.

// A session as the form has it: its day and times in Québec time, as "YYYY-MM-DD" and "HH:MM", or its duration when its
// date isn't known yet (`undated`), its type, or null until it's picked, its takeover's collective as it's shown, which
// it keeps while another type is picked, but only a takeover sends, the application it comes from, likewise, and the rest
// as it's typed.
export type SessionFormValues = {
  undated: boolean
  day: string
  start: string
  end: string
  duration: Duration
  // The day and times the form opened with, e.g. a session's, and what they stood for: each one left as it was stands for
  // what it stood for, even when a time happens twice and the one meant is the second (see `sessionTimes`).
  opened?: { day: string; start: string; end: string; startAt: Date; durationMinutes: number }
  type: SessionType | null
  takeover: Reference | null
  application: ApplicationLink | null
  name: string
  raEvent: RaEvent | null
  description: string
}

export const EMPTY_SESSION_FORM: SessionFormValues = {
  undated: false,
  day: '',
  start: '',
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
  const start = quebecDayAndTime(startAt)
  const shown = { day: start.day, start: start.time, end: quebecDayAndTime(after(startAt, session.durationMinutes)).time }
  return { ...values, ...shown, opened: { ...shown, startAt, durationMinutes: session.durationMinutes } }
}

type SessionTimes = { start: Date | null; durationMinutes: number }

// When a session starts, or null when its date isn't known yet, and how long it lasts, from its day and times, in Québec
// time, or its duration (see "Times" in docs/design/client/admin/sessions.md), or what's wrong with them instead.
export function sessionTimes(form: SessionFormValues): SessionTimes | { errors: FieldErrors<SessionFormValues> } {
  if (form.undated) {
    const durationMinutes = minutesOf(form.duration)
    if (durationMinutes === null) return { errors: { duration: 'Indiquez la durée de la session.' } }
    if (durationMinutes === undefined || durationMinutes < 1) return { errors: { duration: 'La durée est invalide.' } }
    if (durationMinutes > MAX_MINUTES) return { errors: { duration: 'Une session dure au plus 24 heures.' } }
    return { start: null, durationMinutes }
  }
  const { day, start, end, opened } = form
  const keptStart = opened && opened.day === day && opened.start === start
  if (keptStart && opened.end === end) return { start: opened.startAt, durationMinutes: opened.durationMinutes }
  const errors: FieldErrors<SessionFormValues> = {}
  // Browsers let years have more than 4 digits, which aren't days.
  if (!day) errors.day = 'Choisissez le jour de la session.'
  else if (!isDay(day)) errors.day = 'La date est invalide.'
  Object.assign(errors, checkStartEnd(form))
  if (Object.keys(errors).length > 0) return { errors }

  const startAt = keptStart ? opened.startAt : quebecInstant(day, start)
  if (!startAt) return { errors: { start: SKIPPED } }
  const endAt = quebecInstantFrom(startAt, end)
  if (!endAt) return { errors: { end: SKIPPED } }
  if (startAt.getTime() < EARLIEST || startAt.getTime() >= LATEST) return { errors: { day: 'Une session a lieu entre les années 2000 et 2999.' } }
  const durationMinutes = minutesBetween(startAt, endAt)
  // More than a day across a change of the clocks, from a time to the same time the next day.
  if (durationMinutes > MAX_MINUTES) return { errors: { end: 'Une session dure au plus 24 heures.' } }
  return { start: startAt, durationMinutes }
}

// The end time of a session that starts at `start` ("HH:MM") on `day` and lasts `minutes`, as Québec's clocks show it, or
// as they would if they didn't change, while the day isn't known.
export function endTimeAfter(day: string, start: string, minutes: number): string {
  const startAt = isDay(day) ? quebecInstant(day, start) : null
  if (startAt) return quebecDayAndTime(after(startAt, minutes)).time
  const [hours, mins] = start.split(':').map(Number)
  const total = (hours * 60 + mins + minutes) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Checks a session as it's being filled in the form, with its `times` if they're worked out already, and who the
// `applications` it can come from belong to, and returns what the server would be sent, or what's wrong with each field
// instead. The start is sent with Québec's offset from UTC, and the event on RA by its id.
export function checkSession(
  form: SessionFormValues,
  times = sessionTimes(form),
  applications: ApplicationOwners = null,
): { fields: SessionFields; errors?: undefined } | { fields?: undefined; errors: FieldErrors<SessionFormValues> } {
  const errors: FieldErrors<SessionFormValues> = 'errors' in times ? { ...times.errors } : {}
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

// A set as the form has it: its performers as they're shown, its place in its session, and the rest as it's typed. Its
// place is its start and end times in Québec time, as "HH:MM", in a session with a date, or its start, as hours and
// minutes after its session's start (`offset`), and its `duration`, in a session without one, or only its duration when
// its place isn't known yet (`unplaced`).
export type SetFormValues = {
  performers: Reference[]
  unplaced: boolean
  start: string
  end: string
  offset: Duration
  duration: Duration
  // The times the form opened with in a session with a date, e.g. a set's, and what they stood for: each one left as it
  // was stands for what it stood for, even when a time happens twice and the one meant is the second (see `setPlace`).
  opened?: { start: string; end: string; offsetMinutes: number; durationMinutes: number }
  performanceTypes: PerformanceTypeId[]
  otherPerformanceType: string
  genres: GenreId[]
  soundcloudTrack: string
  youtubeVideo: string
  // The application it comes from.
  application: ApplicationLink | null
}

// The session a set is in, as far as its place goes.
type SessionPlace = Pick<Session, 'start' | 'durationMinutes'>

const EMPTY_SET_FORM: SetFormValues = {
  performers: [],
  unplaced: false,
  start: '',
  end: '',
  offset: EMPTY_DURATION,
  duration: EMPTY_DURATION,
  performanceTypes: [],
  otherPerformanceType: '',
  genres: [],
  soundcloudTrack: '',
  youtubeVideo: '',
  application: null,
}

// A set's place as the form shows it: in a session with a date, the times it starts and ends, which stand for its offset
// and duration while they're unchanged.
function placeValues(session: SessionPlace, offsetMinutes: number, durationMinutes: number): Partial<SetFormValues> {
  if (session.start === null) return { offset: durationOf(offsetMinutes), duration: durationOf(durationMinutes) }
  const startAt = after(new Date(session.start), offsetMinutes)
  const shown = { start: quebecDayAndTime(startAt).time, end: quebecDayAndTime(after(startAt, durationMinutes)).time }
  return { ...shown, opened: { ...shown, offsetMinutes, durationMinutes } }
}

// A set of `session` as the form shows it, to change it.
export function setFormValues(set: StudioSet, session: SessionPlace): SetFormValues {
  const values: SetFormValues = {
    ...EMPTY_SET_FORM,
    performers: set.performers,
    performanceTypes: set.performanceTypes,
    otherPerformanceType: set.otherPerformanceType,
    genres: set.genres,
    soundcloudTrack: set.soundcloudTrack?.url ?? '',
    youtubeVideo: set.youtubeVideo?.url ?? '',
    application: set.application,
  }
  // A set with an offset has a duration.
  if (set.offsetMinutes === null || set.durationMinutes === null) return { ...values, unplaced: true, duration: durationOf(set.durationMinutes) }
  return { ...values, ...placeValues(session, set.offsetMinutes, set.durationMinutes) }
}

// What a new set of `session` starts with: when the last of its sets that isn't cancelled and whose place is known ends,
// or at its start when there's none, for an hour, or until the session ends if that's sooner, or without times when
// its sets fill it.
export function newSetFormValues(session: SessionPlace & Pick<Session, 'sets'>): SetFormValues {
  const ends = session.sets.filter((set) => set.status !== 'cancelled' && set.offsetMinutes !== null).map((set) => set.offsetMinutes! + set.durationMinutes!)
  const offsetMinutes = Math.max(0, ...ends)
  const durationMinutes = Math.min(60, session.durationMinutes - offsetMinutes)
  if (durationMinutes <= 0) return EMPTY_SET_FORM
  return { ...EMPTY_SET_FORM, ...placeValues(session, offsetMinutes, durationMinutes) }
}

export type SetPlace = { offsetMinutes: number | null; durationMinutes: number | null }

// Where a set is in `session`, from its times in Québec time, or its offset and duration (see "Times" in
// docs/design/client/admin/sessions.md), or what's wrong with them instead. It doesn't have to be within the session.
export function setPlace(form: SetFormValues, session: SessionPlace): SetPlace | { errors: FieldErrors<SetFormValues> } {
  if (form.unplaced) {
    const durationMinutes = minutesOf(form.duration)
    if (durationMinutes === undefined || durationMinutes === 0) return { errors: { duration: 'La durée est invalide.' } }
    if (durationMinutes !== null && durationMinutes > MAX_MINUTES) return { errors: { duration: LONGEST } }
    return { offsetMinutes: null, durationMinutes }
  }

  let place: { offsetMinutes: number; durationMinutes: number }
  if (session.start === null) {
    const offsetMinutes = minutesOf(form.offset)
    const durationMinutes = minutesOf(form.duration)
    const errors: FieldErrors<SetFormValues> = {}
    if (offsetMinutes === null) errors.offset = 'Indiquez quand le set commence.'
    else if (offsetMinutes === undefined) errors.offset = 'Le début est invalide.'
    if (durationMinutes === null) errors.duration = 'Indiquez la durée du set.'
    else if (durationMinutes === undefined || durationMinutes === 0) errors.duration = 'La durée est invalide.'
    if (Object.keys(errors).length > 0) return { errors }
    place = { offsetMinutes: offsetMinutes!, durationMinutes: durationMinutes! }
  } else {
    const { opened } = form
    const keptStart = opened?.start === form.start
    if (keptStart && opened.end === form.end) place = opened
    else {
      const errors = checkStartEnd(form)
      if (Object.keys(errors).length > 0) return { errors }
      const sessionStart = new Date(session.start)
      const startAt = keptStart ? after(sessionStart, opened.offsetMinutes) : quebecInstantFrom(sessionStart, form.start, { inclusive: true })
      if (!startAt) return { errors: { start: SKIPPED } }
      const endAt = quebecInstantFrom(startAt, form.end)
      if (!endAt) return { errors: { end: SKIPPED } }
      place = { offsetMinutes: minutesBetween(sessionStart, startAt), durationMinutes: minutesBetween(startAt, endAt) }
    }
  }
  // Hours and minutes can be typed past these, and times of day can be up to 25 hours apart the night the clocks go back.
  if (place.offsetMinutes > MAX_MINUTES - 1) return { errors: { [session.start === null ? 'offset' : 'start']: 'Un set commence au plus 23 h 59 après le début de la session.' } }
  if (place.durationMinutes > MAX_MINUTES) return { errors: { [session.start === null ? 'duration' : 'end']: LONGEST } }
  return place
}

// Checks a set of `session` as it's being filled in the form, with its `place` if it's worked out already, and who the
// `applications` it can come from belong to, and returns what the server would be sent, or what's wrong with each field
// instead. Links are sent as they're typed, but trimmed, or null for none.
export function checkSet(
  form: SetFormValues,
  session: SessionPlace,
  place = setPlace(form, session),
  applications: ApplicationOwners = null,
): { fields: SetFields; errors?: undefined } | { fields?: undefined; errors: FieldErrors<SetFormValues> } {
  const errors: FieldErrors<SetFormValues> = {}
  if (form.performers.length === 0) errors.performers = 'Choisissez au moins un artiste.'
  const owner = applications?.find(({ id }) => id === form.application?.id)
  if (owner && !isPerformersApplication(owner, form.performers)) errors.application = NOT_THE_SETS_APPLICATION
  if ('errors' in place) Object.assign(errors, place.errors)
  const otherPerformanceType = checkLine(form.otherPerformanceType, 'La prestation « Autre »', OTHER_PERFORMANCE_TYPE_MAX_LENGTH, null)
  if (otherPerformanceType.error) errors.otherPerformanceType = otherPerformanceType.error
  const soundcloudTrack = form.soundcloudTrack.trim()
  if (soundcloudTrack && !isSoundcloudTrackLink(soundcloudTrack)) {
    errors.soundcloudTrack = 'Le lien SoundCloud doit mener à la piste sur soundcloud.com, p. ex. « https://soundcloud.com/parkingdotradio/3tons ».'
  }
  const youtubeVideo = form.youtubeVideo.trim()
  if (youtubeVideo && !youtubeVideoId(youtubeVideo)) errors.youtubeVideo = 'Le lien YouTube est invalide : collez le lien de la vidéo, ou son identifiant.'

  if (Object.keys(errors).length > 0 || 'errors' in place) return { errors }
  return {
    fields: {
      performers: form.performers.map(({ id }) => ({ id })),
      offsetMinutes: place.offsetMinutes,
      durationMinutes: place.durationMinutes,
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
