import { z } from 'zod'
import { Day, dayWith } from './api-formats.js'
import { line, text } from './artist-profile.js'

// An application's fields: the lists and rules every application has to follow (see docs/design/server/artists.md), as
// the zod schemas the server checks applications with, which openapi.json is generated from. These rules only make sure
// the data is valid: suggestions and limits, like which dates or time slots to offer, are up to the forms. The server
// explains what's wrong with an application in French, because artists see its messages.
//
// The client has its own copy of these rules, for its forms to say what's wrong right away (see
// client/src/application-fields.ts): they must be changed together. These are the ones that count.
//
// Responses are checked against the lists below too (see routes/applications.ts), so taking a value out of one, e.g. a
// prestation, takes migrating the applications that have it: otherwise, every response with one of them fails with 500.

// What an artist can do in their set. What's stored is their id, which doesn't change, so that applications can be told
// apart by what the artists would do whatever their names, e.g. once they're translated. Their names, in this order,
// are the client's (see client/src/application-fields.ts), and the application emails' (see application-emails.ts).
const PRESTATIONS = ['dj', 'vinyl', 'live-performance', 'rap', 'full-band'] as const
export const PrestationId = z.enum(PRESTATIONS, { error: "Une des prestations n'est pas dans la liste." }).meta({ id: 'PrestationId' })
export type PrestationId = z.infer<typeof PrestationId>

// Admins follow applications on the admin pages, in this order: every application starts as "new", then is "accepted"
// or "rejected", and an accepted one is "scheduled" once a date has been set with the artist, then "done" once they have
// played. This order is only a convention: admins can change a status to any other. Only admins see the error.
export const APPLICATION_STATUSES = ['new', 'accepted', 'scheduled', 'done', 'rejected'] as const
export const BAD_STATUS = `The status must be one of ${APPLICATION_STATUSES.join(', ')}`
export const ApplicationStatus = z.enum(APPLICATION_STATUSES, { error: BAD_STATUS }).meta({ id: 'ApplicationStatus' })
export type ApplicationStatus = z.infer<typeof ApplicationStatus>

const OTHER_PRESTATION_MAX_LENGTH = 60
const DETAILS_MAX_LENGTH = 2000

const NO_DATE = 'Choisissez au moins une date.'
const BAD_SLOT = 'Une des plages horaires est invalide.'

// A time of day, "HH:MM", from 00:00 to 23:59.
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const time = z.string({ error: BAD_SLOT }).regex(TIME, BAD_SLOT)

// A time range when the artist can play, in Québec time, e.g. from 18:00 to 22:00. The end is later the same day.
export const TimeSlot = z
  .object({ start: time, end: time }, { error: BAD_SLOT })
  .refine(({ start, end }) => start < end, BAD_SLOT)
  .meta({ id: 'TimeSlot', description: 'In Québec time, ending later the same day' })
export type TimeSlot = z.infer<typeof TimeSlot>

// An application's fields, as they're sent, by artists and by admins alike, in the order they're checked in, which is the
// order of their errors: the server answers with the first. They're cleaned up as they're checked: dates and time slots
// are sorted, without duplicates, prestations are in the order of PRESTATIONS, without duplicates, and text is trimmed.
// Anything that isn't an object gets the error of the dates, which it doesn't have.
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
      prestations: z
        .array(PrestationId, { error: 'Les prestations sont invalides.' })
        .overwrite((ids) => PRESTATIONS.filter((id) => ids.includes(id)))
        .meta({ description: 'In any order, even more than once: saved in the order of the list, without duplicates' }),
      otherPrestation: line('La prestation « Autre »', OTHER_PRESTATION_MAX_LENGTH, 'La prestation « Autre » est invalide.', { canBeEmpty: true }),
      details: text('Le champ « Questions ou détails »', DETAILS_MAX_LENGTH, 'Le champ « Questions ou détails » est invalide.', {
        canBeEmpty: true,
      }),
    },
    { error: NO_DATE },
  )
  .meta({ id: 'ApplicationFields' })
export type ApplicationFields = z.output<typeof ApplicationFields>

const BAD_RECEIVED_AT = 'La date de réception est invalide.'

// When an admin says an artist sent an application: a date and time with its offset from UTC, e.g.
// "2026-03-28T14:03:00Z" or "2026-03-28T10:03-04:00", that isn't in the future, as a Date. It isn't a `Timestamp`,
// whose seconds are required.
export const ReceivedAt = z
  .string({ error: BAD_RECEIVED_AT })
  .meta({ format: 'date-time', description: 'A date and time with its offset from UTC, which can be left without seconds. Not in the future' })
  .transform((sent, context) => {
    // Date.parse alone takes more than this, e.g. "2026-02-30T00:00Z" as March 2.
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:[0-5]\d(\.\d+)?)?(Z|[+-](\d{2}:\d{2}))$/.exec(sent)
    const valid = match && Day.safeParse(match[1]).success && TIME.test(match[2]) && (match[6] === undefined || TIME.test(match[6]))
    const receivedAt = new Date(sent)
    // Postgres has no year 0, which is 1 BC, e.g. for "0001-01-01T00:00+01:00".
    if (!valid || receivedAt.getUTCFullYear() < 1) {
      context.addIssue({ code: 'custom', message: BAD_RECEIVED_AT })
      return z.NEVER
    }
    if (receivedAt.getTime() > Date.now()) {
      context.addIssue({ code: 'custom', message: 'La date de réception ne peut pas être dans le futur.' })
      return z.NEVER
    }
    return receivedAt
  })
