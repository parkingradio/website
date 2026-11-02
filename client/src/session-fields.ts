import type { Schema } from './api/client'
import { OTHER_PRESTATION_MAX_LENGTH, PRESTATIONS, isDay, isTime } from './application-fields'
import type { PrestationId } from './application-fields'
import type { GenreId } from './artist-profile'
import { checkLine, everyOne } from './checks'
import type { FieldErrors } from './checks'
import { quebecDateTime, quebecDayAndTime, quebecInstant, quebecInstantFrom } from './quebec-time'
import { isSoundcloudTrackLink, raEventId, youtubeVideoId } from './session-links'

// How sessions and sets are checked in the browser, by the admin pages, and how their forms' times of day become what the
// server takes (see docs/design/client/admin/sessions.md).
//
// The forms check sessions and sets as the server does, to say what's wrong right away, with a copy of the server's rules
// (see server/src/sessions/fields.ts), which must be changed together with these. Their messages are in French, unlike
// the server's. The server's are the ones that count: when they disagree, the server's message shows. The rules that
// involve other sessions or sets, e.g. that they don't overlap, are only the server's, but whether a set fits in its
// session is checked here too, since its times are worked out from the session's.

export type Session = Schema<'Session'>
// A set, as the endpoints return it. Not `Set`, which is JavaScript's.
export type StudioSet = Schema<'Set'>
export type SessionStatus = Schema<'SessionStatus'>
export type SessionFields = Schema<'SessionFields'>
export type SetFields = Schema<'SetFields'>
// An artist or a collective, by their id and name, as sessions and sets name them.
export type Reference = Schema<'Reference'>

// In the order sessions and sets go through them (see describe.ts for their names).
export const STATUSES = everyOne<SessionStatus>()(['planned', 'done', 'cancelled'])

const NAME_MAX_LENGTH = 100
// The longest a session or a set lasts, in minutes. A set's offset is less than that.
const MAX_MINUTES = 24 * 60
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
// date isn't known yet (`undated`), its takeover's collective as it's shown, and the rest as it's typed.
export type SessionFormValues = {
  undated: boolean
  day: string
  start: string
  end: string
  duration: Duration
  // The day and times the form opened with, e.g. a session's, and what they stood for: each one left as it was stands for
  // what it stood for, even when a time happens twice and the one meant is the second (see `sessionTimes`).
  opened?: { day: string; start: string; end: string; startAt: Date; durationMinutes: number }
  takeover: Reference | null
  name: string
  raEvent: string
}

export const EMPTY_SESSION_FORM: SessionFormValues = {
  undated: false,
  day: '',
  start: '',
  end: '',
  duration: EMPTY_DURATION,
  takeover: null,
  name: '',
  raEvent: '',
}

// A session as the form shows it, to change it.
export function sessionFormValues(session: Session): SessionFormValues {
  const values = {
    ...EMPTY_SESSION_FORM,
    duration: durationOf(session.durationMinutes),
    takeover: session.takeover,
    name: session.name,
    raEvent: session.raEvent?.url ?? '',
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

// Checks a session as it's being filled in the form, with its `times` if they're worked out already, and returns what
// the server would be sent, or what's wrong with each field instead. The start is sent with Québec's offset from UTC,
// and the link as it's typed, but trimmed, or null for none.
export function checkSession(
  form: SessionFormValues,
  times = sessionTimes(form),
): { fields: SessionFields; errors?: undefined } | { fields?: undefined; errors: FieldErrors<SessionFormValues> } {
  const errors: FieldErrors<SessionFormValues> = 'errors' in times ? { ...times.errors } : {}
  const name = checkLine(form.name, 'Le nom', NAME_MAX_LENGTH, null)
  if (name.error) errors.name = name.error
  const raEvent = form.raEvent.trim()
  if (raEvent && !raEventId(raEvent)) errors.raEvent = "Le lien de l'événement RA est invalide, p. ex. « https://ra.co/events/6683745 »."
  if (Object.keys(errors).length > 0 || 'errors' in times) return { errors }
  return {
    fields: {
      start: times.start && quebecDateTime(times.start),
      durationMinutes: times.durationMinutes,
      takeover: form.takeover?.id ?? null,
      name: name.value!,
      raEvent: raEvent || null,
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
  prestations: PrestationId[]
  otherPrestation: string
  genres: GenreId[]
  soundcloudTrack: string
  youtubeVideo: string
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
  prestations: [],
  otherPrestation: '',
  genres: [],
  soundcloudTrack: '',
  youtubeVideo: '',
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
    prestations: set.prestations,
    otherPrestation: set.otherPrestation,
    genres: set.genres,
    soundcloudTrack: set.soundcloudTrack?.url ?? '',
    youtubeVideo: set.youtubeVideo?.url ?? '',
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

type SetPlace = { offsetMinutes: number | null; durationMinutes: number | null }

// Where a set is in `session`, from its times in Québec time, or its offset and duration (see "Times" in
// docs/design/client/admin/sessions.md), if it fits in the session, or what's wrong with them instead. `within` says when
// the session is, e.g. "de 21 h à 1 h", for the error of a set that doesn't fit.
export function setPlace(form: SetFormValues, session: SessionPlace, within: string): SetPlace | { errors: FieldErrors<SetFormValues> } {
  const outside = `Le set doit avoir lieu pendant la session, ${within}.`
  const longer = `Le set ne peut pas durer plus longtemps que la session, ${within}.`
  if (form.unplaced) {
    const durationMinutes = minutesOf(form.duration)
    if (durationMinutes === undefined || durationMinutes === 0) return { errors: { duration: 'La durée est invalide.' } }
    if (durationMinutes !== null && durationMinutes > session.durationMinutes) return { errors: { duration: longer } }
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
  const startField = session.start === null ? 'offset' : 'start'
  const endField = session.start === null ? 'duration' : 'end'
  if (place.offsetMinutes > MAX_MINUTES - 1 || place.offsetMinutes >= session.durationMinutes) return { errors: { [startField]: outside } }
  if (place.offsetMinutes + place.durationMinutes > session.durationMinutes) return { errors: { [endField]: outside } }
  return place
}

// Checks a set of `session` as it's being filled in the form (see `setPlace` for `within`), with its `place` if it's
// worked out already, and returns what the server would be sent, or what's wrong with each field instead. Links are sent
// as they're typed, but trimmed, or null for none.
export function checkSet(
  form: SetFormValues,
  session: SessionPlace,
  within: string,
  place = setPlace(form, session, within),
): { fields: SetFields; errors?: undefined } | { fields?: undefined; errors: FieldErrors<SetFormValues> } {
  const errors: FieldErrors<SetFormValues> = {}
  if (form.performers.length === 0) errors.performers = 'Choisissez au moins un artiste.'
  if ('errors' in place) Object.assign(errors, place.errors)
  const otherPrestation = checkLine(form.otherPrestation, 'La prestation « Autre »', OTHER_PRESTATION_MAX_LENGTH, null)
  if (otherPrestation.error) errors.otherPrestation = otherPrestation.error
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
      prestations: PRESTATIONS.filter((id) => form.prestations.includes(id)),
      otherPrestation: otherPrestation.value!,
      genres: form.genres,
      soundcloudTrack: soundcloudTrack || null,
      youtubeVideo: youtubeVideo || null,
    },
  }
}
