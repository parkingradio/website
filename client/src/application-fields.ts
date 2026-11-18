import type { Schema } from './api/client'
import { checkLine, checkText, everyOne } from './checks'
import type { FieldErrors } from './checks'
import type { SessionStatus } from './session-fields'

// How an application is shown and checked in the browser, by the admin pages and by the "Appliquer" form alike.
//
// The forms check applications as the server does, to say what's wrong right away, with a copy of the server's rules: its
// lists, limits and messages (see server/src/applications/fields.ts), which must be changed together with these. The
// server's are the ones that count: when they disagree, the server's message shows.

export type Application = Schema<'Application'>
export type ApplicationFields = Schema<'ApplicationFields'>
export type TimeSlot = Schema<'TimeSlot'>
export type PerformanceTypeId = Schema<'PerformanceTypeId'>
export type ApplicationStatus = Schema<'ApplicationStatus'>
export type ApplicationDecision = Schema<'ApplicationDecision'>

// The performance types' names, in French, in the order of the server's list, which is the order applications list them
// in. The server emails them too (see server/src/applications/emails.ts), and they must be changed together.
const PERFORMANCE_TYPE_NAMES: Record<PerformanceTypeId, string> = {
  dj: 'DJ',
  vinyl: 'Vinyl',
  'live-performance': 'Performance Live',
  rap: 'Rap',
  'full-band': 'Full Band',
}
export const PERFORMANCE_TYPES = Object.keys(PERFORMANCE_TYPE_NAMES) as PerformanceTypeId[]

export function performanceTypeName(id: PerformanceTypeId): string {
  return PERFORMANCE_TYPE_NAMES[id]
}

// In the order applications usually go through them (see describe.ts for their names). The server works out "planned"
// and "done" from the application's sets and sessions, and only takes the others, what admins decide.
export const APPLICATION_STATUSES = everyOne<ApplicationStatus>()(['new', 'accepted', 'planned', 'done', 'rejected'])
const APPLICATION_DECISIONS = everyOne<ApplicationDecision>()(['new', 'accepted', 'rejected'])

// Whether `status` is one that admins decide, rather than one that an application's sets and sessions give it.
export function isDecision(status: ApplicationStatus): status is ApplicationDecision {
  return (APPLICATION_DECISIONS as readonly ApplicationStatus[]).includes(status)
}

// The status of an application whose decision is `decision`, and whose sets or sessions have `linked` statuses: the
// server's rule (see `applicationStatus` in server/src/applications/fields.ts), which must be changed together with it, and
// with `statusSession`.
function applicationStatus(decision: ApplicationDecision, linked: readonly SessionStatus[]): ApplicationStatus {
  if (decision === 'rejected') return 'rejected'
  if (linked.includes('planned')) return 'planned'
  if (linked.includes('done')) return 'done'
  return decision === 'accepted' || linked.length > 0 ? 'accepted' : 'new'
}

// What admins can decide about `application` that it then shows as its status (see "Status" in
// docs/design/server/applications.md), e.g. not "new" while it has sets or sessions, all of them cancelled, which keep it
// accepted. Nothing while its sets or sessions make it planned or done, which the server doesn't let it be rejected for
// either.
export function pickableDecisions({ status, sets, sessions }: Application): readonly ApplicationDecision[] {
  if (!isDecision(status)) return []
  const linked = [...sets, ...sessions].map((item) => item.status)
  return APPLICATION_DECISIONS.filter((decision) => applicationStatus(decision, linked) === decision)
}

// The session that `application`'s status comes from, when its sets or sessions give it (see `applicationStatus`): that of
// the first of them with that status, in their order, which for a set is its session, or null for a status that admins
// decide.
export function statusSession({ status, sets, sessions }: Application): Pick<Application['sessions'][number], 'id' | 'title' | 'start'> | null {
  if (isDecision(status)) return null
  return sets.find((set) => set.status === status)?.session ?? sessions.find((session) => session.status === status) ?? null
}

export const OTHER_PERFORMANCE_TYPE_MAX_LENGTH = 60
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

// Checks when an admin says an application was received, which the form sends in Québec time, with Québec's offset then
// (see `quebecDateTime`), whose format is then the server's: it can't be before the year 2000, in UTC, or later than
// `now`.
export function checkReceivedAt(receivedAt: Date, now = new Date()): string | null {
  if (receivedAt.getUTCFullYear() < 2000) return "La date de réception doit être en l'an 2000 ou après."
  if (receivedAt > now) return 'La date de réception ne peut pas être dans le futur.'
  return null
}

// Checks an application's fields as they're being filled in a form, and returns what the server would save of them:
// - dates and time slots are sorted, without duplicates
// - text is trimmed
// - performance types are in the order of PERFORMANCE_TYPES, without duplicates
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

  const otherPerformanceType = checkLine(sent.otherPerformanceType, 'La prestation « Autre »', OTHER_PERFORMANCE_TYPE_MAX_LENGTH, null)
  if (otherPerformanceType.error !== undefined) errors.otherPerformanceType = otherPerformanceType.error

  const details = checkText(sent.details, 'Le champ « Questions ou détails »', DETAILS_MAX_LENGTH, null)
  if (details.error !== undefined) errors.details = details.error

  if (Object.keys(errors).length > 0) return { errors }
  return {
    application: {
      dates: dates.sort(),
      timeSlots: [...timeSlots.keys()].sort().map((key) => timeSlots.get(key)!),
      performanceTypes: PERFORMANCE_TYPES.filter((id) => sent.performanceTypes.includes(id)),
      otherPerformanceType: otherPerformanceType.value ?? '',
      details: details.value ?? '',
    },
  }
}
