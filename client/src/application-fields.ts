import type { Schema } from './api/client'
import { checkLine, checkText, everyOne } from './checks'
import type { FieldErrors } from './checks'

// How an application is shown and checked in the browser, by the admin pages and by the "Appliquer" form alike.
//
// The forms check applications as the server does, to say what's wrong right away, with a copy of the server's rules: its
// lists, limits and messages (see server/src/applications/fields.ts), which must be changed together with these. The
// server's are the ones that count: when they disagree, the server's message shows.

export type Application = Schema<'Application'>
export type ApplicationFields = Schema<'ApplicationFields'>
export type TimeSlot = Schema<'TimeSlot'>
export type PrestationId = Schema<'PrestationId'>
export type ApplicationStatus = Schema<'ApplicationStatus'>

// The prestations' names, in French, in the order of the server's list, which is the order applications list them in.
// The server emails them too (see server/src/applications/emails.ts), and they must be changed together.
const PRESTATION_NAMES: Record<PrestationId, string> = {
  dj: 'DJ',
  vinyl: 'Vinyl',
  'live-performance': 'Performance Live',
  rap: 'Rap',
  'full-band': 'Full Band',
}
export const PRESTATIONS = Object.keys(PRESTATION_NAMES) as PrestationId[]

export function prestationName(id: PrestationId): string {
  return PRESTATION_NAMES[id]
}

// In the order applications usually go through them (see describe.ts for their names).
export const APPLICATION_STATUSES = everyOne<ApplicationStatus>()(['new', 'accepted', 'scheduled', 'done', 'rejected'])

export const OTHER_PRESTATION_MAX_LENGTH = 60
export const DETAILS_MAX_LENGTH = 2000

// Whether `value` is a "YYYY-MM-DD" day that exists (not e.g. 2026-02-30).
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

// Whether `value` is a "HH:MM" time of day, from 00:00 to 23:59.
export function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

// Checks when an admin says an application was received, which the form sends as an ISO 8601 date and time (see
// `toISOString`), whose format is then the server's: it can't be before year 1, or later than `now`.
export function checkReceivedAt(receivedAt: Date, now = new Date()): string | null {
  // Postgres has no year 0, which is 1 BC, e.g. for "0001-01-01T00:00+01:00".
  if (receivedAt.getUTCFullYear() < 1) return 'La date de réception est invalide.'
  if (receivedAt > now) return 'La date de réception ne peut pas être dans le futur.'
  return null
}

// Checks an application's fields as they're being filled in a form, and returns what the server would save of them:
// - dates and time slots are sorted, without duplicates
// - text is trimmed
// - prestations are in the order of PRESTATIONS, without duplicates
// If they aren't valid, returns what's wrong with each field instead, for the form to show each error by its field.
export function checkApplication(
  sent: ApplicationFields,
): { application: ApplicationFields; errors?: undefined } | { application?: undefined; errors: FieldErrors<ApplicationFields> } {
  const errors: FieldErrors<ApplicationFields> = {}

  const dates: string[] = []
  for (const date of sent.dates) {
    if (!isDay(date)) errors.dates = 'Une des dates est invalide.'
    else if (!dates.includes(date)) dates.push(date)
  }
  if (dates.length === 0) errors.dates ??= 'Choisissez au moins une date.'

  const timeSlots = new Map<string, TimeSlot>()
  for (const { start, end } of sent.timeSlots) {
    if (!isTime(start) || !isTime(end) || start >= end) errors.timeSlots = 'Une des plages horaires est invalide.'
    else timeSlots.set(`${start}-${end}`, { start, end })
  }

  const otherPrestation = checkLine(sent.otherPrestation, 'La prestation « Autre »', OTHER_PRESTATION_MAX_LENGTH, null)
  if (otherPrestation.error !== undefined) errors.otherPrestation = otherPrestation.error

  const details = checkText(sent.details, 'Le champ « Questions ou détails »', DETAILS_MAX_LENGTH, null)
  if (details.error !== undefined) errors.details = details.error

  if (Object.keys(errors).length > 0) return { errors }
  return {
    application: {
      dates: dates.sort(),
      timeSlots: [...timeSlots.keys()].sort().map((key) => timeSlots.get(key)!),
      prestations: PRESTATIONS.filter((id) => sent.prestations.includes(id)),
      otherPrestation: otherPrestation.value ?? '',
      details: details.value ?? '',
    },
  }
}
