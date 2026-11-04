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

// The offsets from UTC in Québec, as the instants requests send have to have them (see Times in
// docs/design/server/README.md), and the model is told (see mcp/documentation.ts). That's the rule since 2007: the
// offsets are checked against Intl's, which knows earlier ones too.
export const QUEBEC_OFFSETS = '-05:00, or -04:00 from the second Sunday of March at 2:00 to the first Sunday of November at 2:00'
// How the instants requests send are written, in the English of errors and of openapi.json: the rule, for errors, which
// says a time the clocks skip is refused too, since it has neither offset (see `dateTimeWith`).
export const IN_QUEBEC_TIME = 'in Québec time, with the offset from UTC in effect then'
export const QUEBEC_TIME_RULE = `${IN_QUEBEC_TIME} (${QUEBEC_OFFSETS}), except a time the clocks skip in spring`
export const DATE_TIME_DESCRIPTION = `A date and time, which can be left without seconds, ${IN_QUEBEC_TIME}`

const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: QUEBEC_TIME_ZONE, timeZoneName: 'longOffset' })

// Québec's offset from UTC at the instant `ms`, e.g. "-05:00". Before 1895, it isn't whole minutes, e.g. "-05:17:32".
function quebecOffset(ms: number): string {
  // "GMT-05:00", or "GMT" when it's UTC's.
  return offsetFormat.formatToParts(ms).find(({ type }) => type === 'timeZoneName')!.value.slice('GMT'.length) || '+00:00'
}

// `instant` in Québec time, to the second, with the offset from UTC in effect then, e.g. "2026-11-14T21:00:00-05:00" for
// "2026-11-15T02:00:00.000Z". Only the offset comes from Intl, and the day and time are worked out from it, which is right
// since 1895, when Québec's offsets became whole minutes: the instants requests send are kept from `EARLIEST_INSTANT`.
export function inQuebecTime(instant: Date | string): string {
  const ms = Math.floor(new Date(instant).getTime() / 1000) * 1000
  const offset = quebecOffset(ms)
  const minutes = (offset.startsWith('-') ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)))
  return `${new Date(ms + minutes * 60 * 1000).toISOString().slice(0, 19)}${offset}`
}

// An instant, as responses give it: an ISO 8601 string, which is written in Québec time (see `inQuebecTime`) whatever the
// offset a route gives it with, e.g. a Date's `toISOString`. Every instant of every response is one, which is what makes
// them all in Québec time, errors' included. It's for responses only: requests send instants that `dateTimeWith` checks,
// whose seconds can be left out.
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

// A date and time with its offset from UTC, where the seconds can be left out, e.g. "2026-03-28T10:03-04:00" or
// "2026-11-14T21:00:00.5-05:00". It isn't a `Timestamp`, whose seconds are required.
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:[0-5]\d(\.\d+)?)?(Z|[+-](\d{2}:\d{2}))$/
// A time of day, "HH:MM", from 00:00 to 23:59.
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/

// A date and time in Québec time, with the offset from UTC in effect in Québec at that instant (see `QUEBEC_OFFSETS`), as
// above, as a Date: any other offset, e.g. `Z`, is refused, and so is a time the clocks skip in spring, which neither
// offset gives back. Every instant requests send is one. `message` is the error for anything else, in the language of
// the field's other errors, e.g. French for an application's. Its year isn't checked: e.g. Postgres has no year 0, so
// callers keep it to the instants from `EARLIEST_INSTANT`, e.g. with `instantWith`.
//
// It isn't shown as `date-time`, whose seconds are required.
export function dateTimeWith(message: string) {
  return z
    .string({ error: message })
    .meta({ description: DATE_TIME_DESCRIPTION })
    .transform((sent, context) => {
      // Date.parse alone takes more than this, e.g. "2026-02-30T00:00Z" as March 2.
      const match = DATE_TIME.exec(sent)
      const valid = match && isoDate.safeParse(match[1]).success && TIME_OF_DAY.test(match[2]) && (match[6] === undefined || TIME_OF_DAY.test(match[6]))
      const date = valid ? new Date(sent) : null
      if (!date || quebecOffset(date.getTime()) !== match![5]) {
        context.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      return date
    })
}

// A date and time in Québec time, as a Date, as `dateTimeWith` takes it, from `EARLIEST_INSTANT` to `LATEST_INSTANT`,
// excluded. `message` is the error for anything else.
export function instantWith(message: string) {
  return dateTimeWith(message).refine((date) => date.getTime() >= EARLIEST_INSTANT && date.getTime() < LATEST_INSTANT, message)
}
