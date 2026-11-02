import { z } from 'zod'

// The formats of the API's dates and times, as zod schemas (see api/schemas.ts). They're in a module of their own,
// which only needs zod, so that the database's schema, which uses the rules of applications (see
// applications/fields.ts), doesn't load what the routes need.

// A date and time, as an ISO 8601 string. It's checked like `z.iso.datetime`, which openapi.json would show as a long
// regular expression: only its format, `date-time`, is shown instead.
const isoDateTime = z.iso.datetime({ offset: true })
export const Timestamp = z
  .string()
  .refine((value) => isoDateTime.safeParse(value).success, 'Invalid date and time')
  .meta({ format: 'date-time' })

// A day, "YYYY-MM-DD", that exists. It's checked like `z.iso.date`, and shown as only its format, `date`, like `Timestamp`.
// `message` is the error for anything else, e.g. in French where artists see it.
const isoDate = z.iso.date()
export function dayWith(message: string) {
  return z
    .string({ error: message })
    .refine((value) => isoDate.safeParse(value).success, message)
    .meta({ format: 'date' })
}
export const Day = dayWith('Invalid date')

// A date and time with its offset from UTC, where the seconds can be left out, e.g. "2026-03-28T14:03:00Z" or
// "2026-03-28T10:03-04:00". It isn't a `Timestamp`, whose seconds are required.
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:[0-5]\d(\.\d+)?)?(Z|[+-](\d{2}:\d{2}))$/
// A time of day, "HH:MM", from 00:00 to 23:59.
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/

// A date and time with its offset from UTC, as above, as a Date. `message` is the error for anything else, e.g. in French
// where artists see it.
export function dateTimeWith(message: string) {
  return z
    .string({ error: message })
    .meta({ format: 'date-time', description: 'A date and time with its offset from UTC, which can be left without seconds' })
    .transform((sent, context) => {
      // Date.parse alone takes more than this, e.g. "2026-02-30T00:00Z" as March 2.
      const match = DATE_TIME.exec(sent)
      const valid = match && isoDate.safeParse(match[1]).success && TIME_OF_DAY.test(match[2]) && (match[6] === undefined || TIME_OF_DAY.test(match[6]))
      const date = new Date(sent)
      // Postgres has no year 0, which is 1 BC, e.g. for "0001-01-01T00:00+01:00".
      if (!valid || date.getUTCFullYear() < 1) {
        context.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      return date
    })
}
