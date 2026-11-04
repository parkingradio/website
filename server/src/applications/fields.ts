import { z } from 'zod'
import { EARLIEST_INSTANT, TIME_OF_DAY, dateTimeWith, dayWith } from '../api/formats.js'
import { line, text } from '../artists/profile.js'

// An application's fields: the lists and rules every application has to follow (see
// docs/design/server/applications.md), as the zod schemas the server checks applications with, which openapi.json is
// generated from. These rules only make sure the data is valid: suggestions and limits, like which dates or time slots
// to offer, are up to the forms. The server explains what's wrong with an application in French, because artists see
// its messages.
//
// The client has its own copy of these rules, for its forms to say what's wrong right away (see
// client/src/application-fields.ts): they must be changed together. These are the ones that count.
//
// Responses are checked against the lists below too (see applications/routes.ts), so taking a value out of one, e.g. a
// performance type, takes migrating the applications that have it, and the sets, for performance types (see
// sessions/fields.ts): otherwise, every response with one of them fails with 500.

// What an artist can do in their set. What's stored is their id, which doesn't change, so that applications can be told
// apart by what the artists would do whatever their names, e.g. once they're translated. Their names, in this order,
// are the client's (see client/src/application-fields.ts), and the application emails' (see applications/emails.ts).
export const PERFORMANCE_TYPES = ['dj', 'vinyl', 'live-performance', 'rap', 'full-band'] as const
export const PerformanceTypeId = z.enum(PERFORMANCE_TYPES, { error: "Une des prestations n'est pas dans la liste." }).meta({ id: 'PerformanceTypeId' })
export type PerformanceTypeId = z.infer<typeof PerformanceTypeId>

// Admins follow applications on the admin pages, in this order: every application starts as "new", then is "accepted"
// or "rejected", and an accepted one is "scheduled" once a date has been set with the artist, then "done" once they have
// played. This order is only a convention: admins can change a status to any other. Only admins see the error.
export const APPLICATION_STATUSES = ['new', 'accepted', 'scheduled', 'done', 'rejected'] as const
export const BAD_STATUS = `The status must be one of ${APPLICATION_STATUSES.join(', ')}`
export const ApplicationStatus = z.enum(APPLICATION_STATUSES, { error: BAD_STATUS }).meta({ id: 'ApplicationStatus' })
export type ApplicationStatus = z.infer<typeof ApplicationStatus>

export const OTHER_PERFORMANCE_TYPE_MAX_LENGTH = 60
const DETAILS_MAX_LENGTH = 2000

const NO_DATE = 'Choisissez au moins une date.'
const BAD_SLOT = 'Une des plages horaires est invalide.'

const time = z.string({ error: BAD_SLOT }).regex(TIME_OF_DAY, BAD_SLOT)

// A time range when the artist can play, in Québec time, e.g. from 18:00 to 22:00. The end is later the same day.
export const TimeSlot = z
  .object({ start: time, end: time }, { error: BAD_SLOT })
  .refine(({ start, end }) => start < end, BAD_SLOT)
  .meta({ id: 'TimeSlot', description: 'In Québec time, ending later the same day' })
export type TimeSlot = z.infer<typeof TimeSlot>

// An application's fields, as they're sent, by artists and by admins alike, in the order they're checked in, which is the
// order of their errors: the server answers with the first. They're cleaned up as they're checked: dates and time slots
// are sorted, without duplicates, performance types are in the order of PERFORMANCE_TYPES, without duplicates, and text
// is trimmed. Anything that isn't an object gets the error of the dates, which it doesn't have.
export const ApplicationFields = z
  .object(
    {
      // Past days are allowed, e.g. to import old applications.
      dates: z
        .array(dayWith('Une des dates est invalide.'), { error: NO_DATE })
        .overwrite((dates) => [...new Set(dates)].sort())
        .min(1, NO_DATE)
        .meta({ description: 'Saved sorted, without duplicates. Past days are allowed' }),
      // An empty list means any time.
      timeSlots: z
        .array(TimeSlot, { error: 'Les plages horaires sont invalides.' })
        .overwrite((slots) => {
          const unique = new Map(slots.map((slot) => [`${slot.start}-${slot.end}`, slot]))
          return [...unique.keys()].sort().map((key) => unique.get(key)!)
        })
        .meta({ description: 'Saved sorted, without duplicates. None means any time' }),
      performanceTypes: z
        .array(PerformanceTypeId, { error: 'Les prestations sont invalides.' })
        .overwrite((ids) => PERFORMANCE_TYPES.filter((id) => ids.includes(id)))
        .meta({ description: 'In any order, even more than once: saved in the order of the list, without duplicates' }),
      otherPerformanceType: line('La prestation « Autre »', OTHER_PERFORMANCE_TYPE_MAX_LENGTH, 'La prestation « Autre » est invalide.', { canBeEmpty: true }),
      details: text('Le champ « Questions ou détails »', DETAILS_MAX_LENGTH, 'Le champ « Questions ou détails » est invalide.', {
        canBeEmpty: true,
      }),
    },
    { error: NO_DATE },
  )
  .meta({ id: 'ApplicationFields' })
export type ApplicationFields = z.output<typeof ApplicationFields>

const BAD_RECEIVED_AT = 'La date de réception est invalide.'

// When an admin says an artist sent an application: a date and time with its offset from UTC (see
// `dateTimeWith` in api/formats.ts), from the year 2000, in UTC, like every instant requests send, that isn't in the
// future, as a Date.
export const ReceivedAt = dateTimeWith(BAD_RECEIVED_AT)
  .refine((receivedAt) => receivedAt.getTime() >= EARLIEST_INSTANT, "La date de réception doit être en l'an 2000 ou après.")
  .refine((receivedAt) => receivedAt.getTime() <= Date.now(), 'La date de réception ne peut pas être dans le futur.')
  .meta({ description: 'A date and time with its offset from UTC, which can be left without seconds. From the year 2000, in UTC, and not in the future' })
