import { z } from 'zod'
import { DATE_TIME_DESCRIPTION, QUEBEC_TIME_RULE, instantWith } from '../api/formats.js'
import { OTHER_PERFORMANCE_TYPE_MAX_LENGTH, PERFORMANCE_TYPES } from '../applications/fields.js'
import { GENRES } from '../artists/profile.js'
import { raEventId, soundcloudTrackLink, youtubeVideoId } from './links.js'

// The fields of sessions and sets: the rules every session and set has to follow (see docs/design/server/sessions.md),
// as the zod schemas the server checks them with, which openapi.json is generated from. Only admins send them, so their
// errors are in English. Each error is a whole sentence, and the server answers with the first one, in the order of the
// fields.
//
// Responses are checked against the lists that sets' performance types and genres are from too, which are applications'
// and artists' (see applications/fields.ts and artists/profile.ts).

// Admins follow sessions and sets on the admin pages: every one starts as "planned", then is "done" once it's been
// played, or "cancelled". Admins can change a status to any other, except that a cancelled session only has cancelled
// sets (see sessions/store.ts).
export const STATUSES = ['planned', 'done', 'cancelled'] as const
export const BAD_STATUS = `The status must be one of ${STATUSES.join(', ')}`
export const Status = z.enum(STATUSES, { error: BAD_STATUS }).meta({ id: 'SessionStatus', description: "A session's or a set's status" })
export type Status = z.infer<typeof Status>

export const NO_SUCH_ARTIST = 'No such artist'
export const NO_SUCH_COLLECTIVE = 'No such collective'

// The longest a session or a set lasts, in minutes: 24 hours, so that a typo can't make a session overlap days of others.
// A set's offset is less than that, since it starts within its session.
const MAX_MINUTES = 24 * 60

// A value, or null, or a blank string, for none, that's sent as a string, which `parse` turns into what's kept, or null
// when it isn't one, which fails with `message`. It's trimmed first.
function orNone<T>(parse: (sent: string) => T | null, message: string, description: string) {
  return z
    .string({ error: message })
    .nullable()
    .meta({ description: `${description}. Null, or blank, for none` })
    .transform((sent, context) => {
      const trimmed = sent?.trim()
      if (!trimmed) return null
      // The NUL character is refused, rather than dropped, as parsing a link would at either end (see "Text" in
      // docs/design/server/README.md): what's kept can't have it, but what's sent can't either.
      const parsed = trimmed.includes('\0') ? null : parse(trimmed)
      if (parsed === null) {
        context.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      return parsed
    })
}

// Ids are UUIDs, whatever their case, so they're lower-cased, as the database returns them, so that the same id in two
// cases is the same artist or collective.
const lowerCase = (id: string) => id.toLowerCase()

// A number of minutes, from `min` to `max`.
function minutes(message: string, min: number, max: number) {
  return z.number({ error: message }).int(message).min(min, message).max(max, message)
}

// Free text on a single line: each run of spaces, tabs or line breaks becomes a single space, like a name's (see `line`
// in artists/profile.ts), and it's trimmed, then up to `maxLength` characters, or empty for none.
function line(maxLength: number, message: string) {
  return z
    .string({ error: message })
    .overwrite((value) => value.replace(/\s+/g, ' '))
    .trim()
    .max(maxLength, message)
    .meta({ description: `Each run of spaces, tabs or line breaks becomes a single space, and it is trimmed, then up to ${maxLength} characters. Empty for none` })
}

const START = `The start must be a date and time ${QUEBEC_TIME_RULE}, e.g. "2026-11-14T21:00-05:00", from the year 2000 to 2999, or null`
const startTime = instantWith(START)

const NAME_MAX_LENGTH = 100

// A session's fields, as admins send them, cleaned up as they're checked: links are reduced to what's kept (see
// sessions/links.ts).
export const SessionFields = z
  .object(
    {
      start: orNone(
        (sent) => {
          const parsed = startTime.safeParse(sent)
          return parsed.success ? parsed.data : null
        },
        START,
        `${DATE_TIME_DESCRIPTION}, from 2000 to 2999 in UTC`,
      ),
      durationMinutes: minutes(`The duration must be a whole number of minutes, from 1 to ${MAX_MINUTES}`, 1, MAX_MINUTES),
      takeover: orNone(lowerCase, "The takeover must be a collective's id, or null", 'The id of the collective whose takeover the session is'),
      name: line(NAME_MAX_LENGTH, `The name must be text, up to ${NAME_MAX_LENGTH} characters`),
      raEvent: orNone(raEventId, 'The RA event must be its id, or a link to it, e.g. "https://ra.co/events/6683745"', "The event's id on RA, or a link to it"),
    },
    { error: 'A session must be an object with its fields' },
  )
  .meta({ id: 'SessionFields' })
export type SessionFields = z.output<typeof SessionFields>

const NO_PERFORMER = 'A set has at least one performer'

// A performer, as it's sent: an artist, by their id. Other fields are ignored, so that the performers a set returns can
// be sent back as they are.
const SentPerformer = z
  .object({ id: z.string({ error: NO_SUCH_ARTIST }).toLowerCase() }, { error: NO_SUCH_ARTIST })
  .meta({ id: 'SentPerformer' })
export type SentPerformer = z.output<typeof SentPerformer>

// The performers, in order, at least one. Each one is only once in a set, so one that's there twice is dropped, keeping
// the first.
const Performers = z
  .array(SentPerformer, { error: NO_PERFORMER })
  .overwrite((performers) => performers.filter((performer, i) => performers.findIndex((other) => other.id === performer.id) === i))
  .min(1, NO_PERFORMER)
  .meta({ description: 'Artists, in order, at least one, once those that are there twice, whatever the case of their ids, are dropped' })

// Applications' performance types and artists' genres, with errors in English. Their schemas there have French errors,
// and the ids that openapi.json names them by, so these have none.
const BAD_PERFORMANCE_TYPE = `The performance types must be ids among ${PERFORMANCE_TYPES.join(', ')}`
export const PerformanceType = z.enum(PERFORMANCE_TYPES, { error: BAD_PERFORMANCE_TYPE })
const BAD_GENRE = "The genres must be ids of artists' genres, e.g. \"techno\""
export const Genre = z.enum(GENRES, { error: BAD_GENRE })

// A set's fields, as admins send them, cleaned up as they're checked: links are reduced to what's kept (see
// sessions/links.ts), performance types are in the order of PERFORMANCE_TYPES, and performance types and genres are
// without duplicates.
export const SetFields = z
  .object(
    {
      performers: Performers,
      offsetMinutes: minutes(`The offset must be a whole number of minutes, from 0 to ${MAX_MINUTES - 1}, or null`, 0, MAX_MINUTES - 1)
        .nullable()
        .meta({ description: "When the set starts, in minutes after its session's start. Null when that isn't known yet" }),
      durationMinutes: minutes(`The duration must be a whole number of minutes, from 1 to ${MAX_MINUTES}, or null`, 1, MAX_MINUTES)
        .nullable()
        .meta({ description: "Null when that isn't known yet, which a set with an offset can't be" }),
      performanceTypes: z
        .array(PerformanceType, { error: BAD_PERFORMANCE_TYPE })
        .overwrite((ids) => PERFORMANCE_TYPES.filter((id) => ids.includes(id)))
        .meta({ description: 'In any order, even more than once: saved in the order of the list, without duplicates' }),
      otherPerformanceType: line(OTHER_PERFORMANCE_TYPE_MAX_LENGTH, `The other performance type must be text, up to ${OTHER_PERFORMANCE_TYPE_MAX_LENGTH} characters`),
      genres: z
        .array(Genre, { error: BAD_GENRE })
        .overwrite((ids) => ids.filter((id, i) => ids.indexOf(id) === i))
        .meta({ description: 'Most important first. Those that are there twice are dropped, keeping the first' }),
      soundcloudTrack: orNone(
        soundcloudTrackLink,
        'The SoundCloud track must be a link to it on soundcloud.com, e.g. "https://soundcloud.com/parkingdotradio/3tons"',
        'A link to the track on soundcloud.com, or its private link',
      ),
      youtubeVideo: orNone(youtubeVideoId, 'The YouTube video must be a link to it, or its id', 'A link to the video on YouTube, or its id'),
    },
    { error: 'A set must be an object with its fields' },
  )
  .refine(({ offsetMinutes, durationMinutes }) => offsetMinutes === null || durationMinutes !== null, {
    message: 'A set with an offset also has a duration',
    path: ['durationMinutes'],
  })
  .meta({ id: 'SetFields' })
export type SetFields = z.output<typeof SetFields>
