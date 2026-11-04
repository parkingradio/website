import { z } from 'zod'

// The formats of the API's dates and times, as zod schemas (see api/schemas.ts). They're in a module of their own,
// which only needs zod, so that the database's schema, which uses the rules of applications (see
// applications/fields.ts), doesn't load what the routes need.

// Québec's time zone, where Parking Radio is (see Times in docs/design/server/README.md). America/Montreal is only a link
// to it.
const QUEBEC_TIME_ZONE = 'America/Toronto'

// The instants that requests can send, e.g. a session's start: from the year 2000, in UTC, when Québec's offsets are
// whole minutes, as `inQuebecTime` needs, to 2999, which is plenty, and keeps years at 4 digits, even a day later, at a
// session's end.
export const EARLIEST_INSTANT = Date.parse('2000-01-01T00:00:00Z')
export const LATEST_INSTANT = Date.parse('3000-01-01T00:00:00Z')

const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: QUEBEC_TIME_ZONE, timeZoneName: 'longOffset' })

// `instant` in Québec time, to the second, with the offset from UTC in effect then, e.g. "2026-11-14T21:00:00-05:00" for
// "2026-11-15T02:00:00.000Z". Only the offset comes from Intl, and the day and time are worked out from it, which is right
// since 1895, when Québec's offsets became whole minutes: the instants requests send are kept from `EARLIEST_INSTANT`.
export function inQuebecTime(instant: Date | string): string {
  const ms = Math.floor(new Date(instant).getTime() / 1000) * 1000
  // "GMT-05:00", or "GMT" when it's UTC's.
  const offset = offsetFormat.formatToParts(ms).find(({ type }) => type === 'timeZoneName')!.value.slice('GMT'.length) || '+00:00'
  const minutes = (offset.startsWith('-') ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)))
  return `${new Date(ms + minutes * 60 * 1000).toISOString().slice(0, 19)}${offset}`
}

// An instant, as responses give it: an ISO 8601 string, which is written in Québec time (see `inQuebecTime`) whatever the
// offset a route gives it with, e.g. a Date's `toISOString`. Every instant of every response is one, which is what makes
// them all in Québec time, errors' included. It's for responses only: `overwrite` runs when a value is parsed too, which
// requests have to be able to send with any offset (see `dateTimeWith`).
//
// It's checked like `z.iso.datetime`, which openapi.json would show as a long regular expression: only its format,
// `date-time`, is shown instead.
const isoDateTime = z.iso.datetime({ offset: true })
export const Timestamp = z
  .string()
  .refine((value) => isoDateTime.safeParse(value).success, { message: 'Invalid date and time', abort: true })
  .overwrite(inQuebecTime)
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
// where artists see it. Its year isn't checked: e.g. Postgres has no year 0, so callers keep it to the instants from
// `EARLIEST_INSTANT`, e.g. with `instantWith`.
export function dateTimeWith(message: string) {
  return z
    .string({ error: message })
    .meta({ format: 'date-time', description: 'A date and time with its offset from UTC, which can be left without seconds' })
    .transform((sent, context) => {
      // Date.parse alone takes more than this, e.g. "2026-02-30T00:00Z" as March 2.
      const match = DATE_TIME.exec(sent)
      const valid = match && isoDate.safeParse(match[1]).success && TIME_OF_DAY.test(match[2]) && (match[6] === undefined || TIME_OF_DAY.test(match[6]))
      if (!valid) {
        context.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      return new Date(sent)
    })
}

// A date and time with its offset from UTC, as a Date, from `EARLIEST_INSTANT` to `LATEST_INSTANT`, excluded. `message`
// is the error for anything else.
export function instantWith(message: string) {
  return dateTimeWith(message).refine((date) => date.getTime() >= EARLIEST_INSTANT && date.getTime() < LATEST_INSTANT, message)
}
