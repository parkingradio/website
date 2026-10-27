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
