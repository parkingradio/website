// Applications artists send for a set at Parking Radio. An application says when the artist would like to play and
// what they'd do. Each one belongs to an artist (see artists.ts).
//
// The server checks every application against the rules below. These rules only make sure the data is valid.
// Suggestions and limits, like which dates or time slots to offer, are up to the forms. Error messages are in French,
// like for profiles, because artists will see them.

import { checkLine, checkText } from './checks.ts'
import type { FieldErrors } from './checks.ts'

export type ApplicationFields = {
  // The days the artist would like to play, as "YYYY-MM-DD", sorted. At least one. Past days are allowed.
  dates: string[]
  // The times of day that work for the artist, on any of their dates, sorted. An empty list means any time.
  timeSlots: TimeSlot[]
  // What the artist would do, e.g. "DJ" or "Performance live". Each one is up to PRESTATION_MAX_LENGTH characters. Can
  // be empty.
  prestations: string[]
  // The artist's questions or other details. Up to DETAILS_MAX_LENGTH characters. Can be empty.
  details: string
}

// A time range when the artist can play, in Québec time, e.g. from 18:00 to 22:00. Both times are "HH:MM", and the end
// is later the same day.
export type TimeSlot = { start: string; end: string }

// Admins decide on applications on the admin pages. Every application starts as "new".
export const APPLICATION_STATUSES = ['new', 'accepted', 'rejected'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

// An application, as the API returns it.
export type Application = ApplicationFields & {
  id: string
  // The artist who applied.
  artistId: string
  // When the application was created (ISO 8601), and the email of the admin who created it.
  createdAt: string
  createdBy: string
  // Who last changed the application (an admin's email), and when (ISO 8601). Null until then. Status changes don't
  // count.
  updatedBy: string | null
  updatedAt: string | null
  status: ApplicationStatus
  // Who last changed the status (an admin's email), and when (ISO 8601). Null until then.
  statusUpdatedBy: string | null
  statusUpdatedAt: string | null
}

// All the endpoints below require an admin session, and fail with 401 without one.

// `GET /api/admin/applications[?artist=<id>]`: all applications, newest first. With `artist`, only that artist's.
export type ApplicationsResponse = { ok: true; applications: Application[] }

// `GET /api/admin/applications/:id`: one application. Fails with 404 if it doesn't exist.
export type ApplicationResponse = { ok: true; application: Application }

// `POST /api/admin/applications`: creates an application for an existing artist, and returns it. Fails with 400 if
// the application isn't valid (with a message in French) or the artist doesn't exist.
export type CreateApplicationRequest = ApplicationFields & { artistId: string }

// `PUT /api/admin/applications/:id`: replaces an application's fields, and returns it. The artist and the status
// don't change. Fails with 400 if the application isn't valid, or 404 if it doesn't exist.
export type UpdateApplicationRequest = ApplicationFields

// `PUT /api/admin/applications/:id/status`: changes an application's status, and returns the application. Fails with
// 400 if the status isn't valid, or 404 if the application doesn't exist.
export type ApplicationStatusRequest = { status: ApplicationStatus }

// `DELETE /api/admin/applications/:id`: deletes an application. Fails with 404 if it doesn't exist.
export type DeleteApplicationResponse = { ok: true }

export const PRESTATION_MAX_LENGTH = 60
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

// Checks an application's fields, as they were sent or as they're being filled in a form, and returns the cleaned-up
// version to store:
// - dates and time slots are sorted, without duplicates
// - text is trimmed
// - blank prestations are dropped, and so are duplicates, ignoring case
// If they aren't valid, returns what's wrong with each field instead.
export function checkApplication(
  sent: unknown,
): { application: ApplicationFields; errors?: undefined } | { application?: undefined; errors: FieldErrors<ApplicationFields> } {
  const application: Partial<Record<keyof ApplicationFields, unknown>> = sent !== null && typeof sent === 'object' ? sent : {}
  const errors: FieldErrors<ApplicationFields> = {}

  const dates: string[] = []
  for (const date of Array.isArray(application.dates) ? application.dates : []) {
    if (typeof date !== 'string' || !isDay(date)) errors.dates = 'Une des dates est invalide.'
    else if (!dates.includes(date)) dates.push(date)
  }
  if (dates.length === 0) errors.dates ??= 'Choisis au moins une date.'

  const timeSlots = new Map<string, TimeSlot>()
  for (const slot of Array.isArray(application.timeSlots) ? application.timeSlots : []) {
    const { start, end }: Partial<Record<keyof TimeSlot, unknown>> = slot !== null && typeof slot === 'object' ? slot : {}
    if (typeof start !== 'string' || typeof end !== 'string' || !isTime(start) || !isTime(end) || start >= end) {
      errors.timeSlots = 'Une des plages horaires est invalide.'
    } else {
      timeSlots.set(`${start}-${end}`, { start, end })
    }
  }

  const prestations: string[] = []
  for (const sentPrestation of Array.isArray(application.prestations) ? application.prestations : []) {
    const prestation = checkLine(sentPrestation, 'Une prestation', PRESTATION_MAX_LENGTH, null)
    if (prestation.error !== undefined) errors.prestations ??= prestation.error
    else if (prestation.value && !prestations.some((other) => other.toLowerCase() === prestation.value.toLowerCase())) prestations.push(prestation.value)
  }

  const details = checkText(application.details, 'Le champ « Questions ou détails »', DETAILS_MAX_LENGTH, null)
  if (details.error !== undefined) errors.details = details.error

  if (Object.keys(errors).length > 0) return { errors }
  return {
    application: {
      dates: dates.sort(),
      timeSlots: [...timeSlots.keys()].sort().map((key) => timeSlots.get(key)!),
      prestations,
      details: details.value ?? '',
    },
  }
}
