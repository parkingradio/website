import type { FeatureId } from '../../api/client'
import { performanceTypeName } from '../../application-fields'
import type { Application, ApplicationStatus } from '../../application-fields'
import { countryName, countryOptions, genreName } from '../../artist-profile'
import type { Artist, ArtistLinks, GenreId } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { QUEBEC_TIME_ZONE, quebecDayAndTime } from '../../quebec-time'
import type { Session, SessionStatus, StudioSet } from '../../session-fields'
import type { ComboboxOption } from '../../combobox'
import { compareText } from './list'

// How the admin sections show what the API returns, search it and sort it.

// A session's status, the same in the plural, e.g. for the filters of the list of sessions, and a set's.
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = { planned: 'planifiée', done: 'jouée', cancelled: 'annulée' }
export const SESSION_STATUS_PLURALS: Record<SessionStatus, string> = { planned: 'planifiées', done: 'jouées', cancelled: 'annulées' }
export const SET_STATUS_LABELS: Record<SessionStatus, string> = { planned: 'planifié', done: 'joué', cancelled: 'annulé' }

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'nouvelle',
  accepted: 'retenue',
  scheduled: 'planifiée',
  done: 'faite',
  rejected: 'refusée',
}
// The same, in the plural, e.g. for the filters of the applications list.
export const STATUS_PLURALS: Record<ApplicationStatus, string> = {
  new: 'nouvelles',
  accepted: 'retenues',
  scheduled: 'planifiées',
  done: 'faites',
  rejected: 'refusées',
}

// What each feature flag is: its name, and what turning it on does (see docs/design/server/features.md).
export const FEATURE_LABELS: Record<FeatureId, { name: string; description: string }> = {}

// What an app that's allowed a scope can do, as the page where admins allow it says it, in plain words (see
// docs/design/server/oauth.md): a sentence, then what's left out of it, listed under it. For `admin`, that's what the MCP
// server's tools leave out (see docs/design/server/mcp.md).
export const SCOPE_DESCRIPTIONS: Record<string, { text: string; except: string[] }> = {
  admin: {
    text: 'Il pourra faire tout ce que vous faites dans les pages admin, sauf\u00a0:',
    except: [
      'gérer les admins et les applications connectées',
      'voir ou ajouter des photos',
      'changer la connexion SoundCloud',
      'voir ou changer les features de la page Configuration',
      "choisir les destinataires de l'envoi des candidatures par e-mail",
    ],
  },
}

export { countryName, genreName } from '../../artist-profile'

// What's shown in place of what an artist's profile leaves out, which only admins can do (see `checkProfile`), e.g. for
// artists who applied through the original Google Form.
export const MISSING = '-'

// Every country, by name, for picking one, after "Pays inconnu", which leaves the country out.
export const COUNTRY_OPTIONS = [{ key: '', label: 'Pays inconnu' }, ...countryOptions()]

// E.g. "DJ, Vinyl, autre : synthé modulaire", or "" when there's none.
export function describePerformanceTypes({ performanceTypes, otherPerformanceType }: Pick<Application, 'performanceTypes' | 'otherPerformanceType'>): string {
  return [...performanceTypes.map(performanceTypeName), ...(otherPerformanceType ? [`autre : ${otherPerformanceType}`] : [])].join(', ')
}

// The address of an artist's or a collective's photo. The photo can change while its address stays the same, so the
// address changes with them to get the browser to load it again. The server ignores it.
export function photoUrl(of: 'artists' | 'collectives', { id, updatedAt, createdAt }: { id: string; updatedAt: string | null; createdAt: string }): string {
  return `/api/admin/${of}/${id}/photo?v=${encodeURIComponent(updatedAt ?? createdAt)}`
}

// The name of an artist's country, or "" when it's left out.
export function countryOf({ country }: { country: string }): string {
  return country && countryName(country)
}

// E.g. "Québec, Canada", or only the city or the country, when the other one is left out.
export function place(artist: { city: string; country: string }): string {
  return [artist.city, countryOf(artist)].filter(Boolean).join(', ') || MISSING
}

// Sorts places by city, then country, for the lists. What's left out comes first.
export function comparePlaces(a: { city: string; country: string }, b: { city: string; country: string }): number {
  return compareText(a.city, b.city) || compareText(countryOf(a), countryOf(b))
}

// E.g. "techno, ambient", most important first.
export function genreNames(genres: GenreId[]): string {
  return genres.map(genreName).join(', ') || MISSING
}

// Which of the two an entry of the list of artists and collectives is.
export type EntryKind = 'artist' | 'collective'

export const KIND_LABELS: Record<EntryKind, string> = { artist: 'artiste', collective: 'collectif' }

// The address of an entry's page.
export function entryPath(kind: EntryKind, id: string): string {
  return kind === 'collective' ? `/admin/artistes/collectifs/${id}` : `/admin/artistes/${id}`
}

// A collective's genres, which are its members' (see docs/design/client/admin/artistes.md): every member's first genre,
// in the order of the members, then every member's second genre, and so on, each one once. Members who aren't in
// `artists` have none.
export function membersGenres(members: { id: string }[], artists: Map<string, Artist>): GenreId[] {
  const lists = members.map((member) => artists.get(member.id)?.genres ?? [])
  const genres: GenreId[] = []
  for (let rank = 0; lists.some((list) => rank < list.length); rank++) {
    for (const genre of lists.map((list) => list[rank])) {
      if (genre && !genres.includes(genre)) genres.push(genre)
    }
  }
  return genres
}

// The names of a collective's genres, from its `members`' (see `membersGenres`), or null when they're unknown, e.g.
// because its members couldn't be loaded.
export function collectiveGenreNames(collective: Collective, members: Artist[] | null): string | null {
  return members && genreNames(membersGenres(collective.members, new Map(members.map((artist) => [artist.id, artist]))))
}

// Who an application is for: an artist or a collective.
export type Owner = { kind: EntryKind; id: string }

// There's always one of them (see docs/design/server/applications.md).
export function applicationOwner({ artistId, collectiveId }: { artistId: string | null; collectiveId: string | null }): Owner {
  return collectiveId !== null ? { kind: 'collective', id: collectiveId } : { kind: 'artist', id: artistId! }
}

// What tells an artist or a collective apart from others with the same name, in the lists they're picked from: their
// email, or else where they're from, or else the names of the `others` they're with, i.e. an artist's collectives, or a
// collective's artists.
function detailOf(
  { email, city, country }: { email: string | null; city: string; country: string },
  others: { name: string }[],
): string | null {
  if (email) return email
  if (city || country) return place({ city, country })
  return others.map((other) => other.name).join(', ') || null
}

// An artist, or a collective, as an option of the lists they're picked from, keyed by their id, with what tells them apart
// from others with the same name.
export function artistOption(artist: Artist): ComboboxOption {
  return { key: artist.id, label: artist.name, detail: detailOf(artist, artist.collectives) }
}

export function collectiveOption(collective: Collective): ComboboxOption {
  return { key: collective.id, label: collective.name, detail: detailOf(collective, collective.members) }
}

// What an artist or a collective is searched by, in the lists: their `names`, how to reach them, where they're from, their
// genres and the profile names of their links, but not their bio or description, which would match too many searches.
// Their phone number is there with its digits only too, so that it's found however it's typed.
function searchFields(
  names: string[],
  { email, phone, city, country, links }: { email: string | null; phone: string; city: string; country: string; links: ArtistLinks },
  genres: GenreId[],
): string[] {
  return [...names, email, phone, phone.replace(/\D/g, ''), city, countryOf({ country }), ...genres.map(genreName), ...Object.values(links)].filter(
    (field): field is string => Boolean(field),
  )
}

// What a collective is searched by, with its artists' names and `genres`.
function collectiveSearchFields(collective: Collective, genres: GenreId[]): string[] {
  return searchFields([collective.name, ...collective.members.map((member) => member.name)], collective, genres)
}

// An artist or a collective, as the lists show, search and sort them. A collective's genres are null when they're
// unknown, i.e. when the artists couldn't be loaded.
export type Entry = { kind: EntryKind; id: string; name: string; city: string; country: string; genres: GenreId[] | null; searchFields: string[] }

export function artistEntry(artist: Artist): Entry {
  return { ...artist, kind: 'artist', searchFields: searchFields([artist.name], artist, artist.genres) }
}

// A collective, whose genres are those of its members among `artists`, or unknown when they couldn't be loaded (null).
export function collectiveEntry(collective: Collective, artists: Map<string, Artist> | null): Entry {
  const genres = artists && membersGenres(collective.members, artists)
  return { ...collective, kind: 'collective', genres, searchFields: collectiveSearchFields(collective, genres ?? []) }
}

// Instants, in Québec time, like everything the admin pages show (see docs/design/client/admin/layout.md).
export const dateFormat = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeZone: QUEBEC_TIME_ZONE })
export const dateTimeFormat = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: QUEBEC_TIME_ZONE })
// Days are "YYYY-MM-DD", which are read as midnight UTC, so they're formatted in UTC to be the same day wherever this
// runs. The lists' search relies on the day, the month written out and the year being next to each other, in that
// order (see search in list.ts).
const dayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortDayFormat = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// E.g. "mercredi 7 octobre 2026".
export function formatDay(day: string): string {
  return dayFormat.format(new Date(day))
}

// E.g. "7 oct. 2026".
export function formatShortDay(day: string): string {
  return shortDayFormat.format(new Date(day))
}

// E.g. "Aurore, sa photo et ses candidatures".
function enumerate(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} et ${items.at(-1)}` : (items[0] ?? '')
}

// What deleting an artist or a collective named `name` deletes with them: their photo if they have one, and their
// applications, by how many there are (`count`), unless it's known that there are none, e.g. "Aurore, sa photo et ses
// candidatures (2)".
export function deletedWith(name: string, hasPhoto: boolean, count: number | null): string {
  return enumerate([name, ...(hasPhoto ? ['sa photo'] : []), ...(count === 0 ? [] : [`ses candidatures${count ? ` (${count})` : ''}`])])
}

// "Ajouté par X le ...", or the like: who did something and when, if anyone did.
export function byWhom(verb: string, who: string | null, when: string | null): string | null {
  if (!who || !when) return null
  return `${verb} par ${who} le ${dateTimeFormat.format(new Date(when))}.`
}

// Who added an artist or a collective, or that they applied by themselves, e.g. "collectif, ajouté par …".
export function addedBy(kind: string, { createdBy, createdAt }: { createdBy: string | null; createdAt: string }): string {
  return `${kind}, ${byWhom('ajouté', createdBy, createdAt) ?? `inscrit par le formulaire «\u00a0appliquer\u00a0» le ${dateFormat.format(new Date(createdAt))}.`}`
}

// Sessions' and sets' days and times, which are in Québec time, whatever the browser's time zone (see quebec-time.ts),
// and their names (see docs/design/client/admin/sessions.md).
const quebecDayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: QUEBEC_TIME_ZONE })
// The lists' search relies on the day, the month written out and the year being next to each other, in that order (see
// search in list.ts).
const longQuebecDayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: QUEBEC_TIME_ZONE })

// What's shown in place of the day of a session whose date isn't known yet.
const UNDATED = 'date à déterminer'

// E.g. "sam. 14 nov. 2026", the day of `instant` (ISO 8601) in Québec.
function formatQuebecDay(instant: string): string {
  return quebecDayFormat.format(new Date(instant))
}

// E.g. "samedi 14 novembre 2026".
export function formatLongQuebecDay(instant: string): string {
  return longQuebecDayFormat.format(new Date(instant))
}

// E.g. "21 h", or "21 h 30", for `minutes` (of a day, or of a duration).
function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h${minutes % 60 === 0 ? '' : ` ${String(minutes % 60).padStart(2, '0')}`}`
}

// E.g. "21 h", or "21 h 30", the time of `instant` in Québec.
function formatQuebecTime(instant: string): string {
  const [hours, minutes] = quebecDayAndTime(new Date(instant)).time.split(':').map(Number)
  return hoursAndMinutes(hours * 60 + minutes)
}

// E.g. "1 h", "1 h 30" or "45 min".
export function formatDuration(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : hoursAndMinutes(minutes)
}

// How long after its session's start a set starts, in a session without a date, e.g. "+0 h", "+1 h" or "+1 h 30".
function formatOffset(minutes: number): string {
  return `+${hoursAndMinutes(minutes)}`
}

// Whether an instant is on a later day than another, in Québec.
function laterDay(start: string, end: string): boolean {
  return quebecDayAndTime(new Date(start)).day !== quebecDayAndTime(new Date(end)).day
}

type SessionTimes = Pick<Session, 'start' | 'end' | 'durationMinutes'>

// E.g. "sam. 14 nov. 2026", or "date à déterminer".
export function sessionDay({ start }: Pick<Session, 'start'>): string {
  return start === null ? UNDATED : formatQuebecDay(start)
}

// E.g. "samedi 14 novembre 2026", or "date à déterminer".
export function sessionLongDay({ start }: Pick<Session, 'start'>): string {
  return start === null ? UNDATED : formatLongQuebecDay(start)
}

// E.g. "21 h – 1 h", or how long a session without a date lasts, e.g. "4 h".
export function sessionHours({ start, end, durationMinutes }: SessionTimes): string {
  return start === null || end === null ? formatDuration(durationMinutes) : `${formatQuebecTime(start)} – ${formatQuebecTime(end)}`
}

// E.g. "de 21 h à 1 h le lendemain", or "qui dure 4 h" for a session without a date.
export function sessionWithin({ start, end, durationMinutes }: SessionTimes): string {
  if (start === null || end === null) return `qui dure ${formatDuration(durationMinutes)}`
  return `de ${formatQuebecTime(start)} à ${formatQuebecTime(end)}${laterDay(start, end) ? ' le lendemain' : ''}`
}

// E.g. "samedi 14 novembre 2026, de 21 h à 1 h le lendemain", or "date à déterminer".
export function sessionWhen(session: SessionTimes): string {
  return session.start === null ? UNDATED : `${sessionLongDay(session)}, ${sessionWithin(session)}`
}

// What a session is called: its name, or else its takeover, or else its day.
export function sessionTitle(session: Pick<Session, 'name' | 'takeover' | 'start'>): string {
  if (session.name) return session.name
  if (session.takeover) return `Takeover de ${session.takeover.name}`
  return session.start === null ? 'Session sans date' : `Session du ${formatLongQuebecDay(session.start)}`
}

// A session as it's named along with others, with its day after its name or its takeover, e.g. "HAUTE RIVE TAKEOVER, sam.
// 14 nov. 2026".
export function sessionName(session: Pick<Session, 'name' | 'takeover' | 'start'>): string {
  return session.name || session.takeover ? `${sessionTitle(session)}, ${sessionDay(session)}` : sessionTitle(session)
}

// E.g. "21 h – 22 h", "+0 h – +1 h" in a session without a date, or "horaire à déterminer (1 h)" for a set whose place
// isn't known.
export function setHours(set: Pick<StudioSet, 'start' | 'end' | 'offsetMinutes' | 'durationMinutes'>): string {
  if (set.start !== null && set.end !== null) return `${formatQuebecTime(set.start)} – ${formatQuebecTime(set.end)}`
  // A set with an offset has a duration.
  if (set.offsetMinutes !== null) return `${formatOffset(set.offsetMinutes)} – ${formatOffset(set.offsetMinutes + set.durationMinutes!)}`
  return `horaire à déterminer${set.durationMinutes === null ? '' : ` (${formatDuration(set.durationMinutes)})`}`
}

// What a set is called: e.g. "Set de Aurore, Brume et Écume", or "Set" once its performers are all deleted.
export function setTitle(set: Pick<StudioSet, 'performers'>): string {
  return set.performers.length > 0 ? `Set de ${enumerate(set.performers.map((performer) => performer.name))}` : 'Set'
}

// A set as it's named on its session's page, e.g. "Set de Aurore, 21 h – 22 h", or outside it, with its session, e.g.
// "Set de Aurore, HAUTE RIVE TAKEOVER, sam. 14 nov. 2026, 21 h – 22 h".
export function setName(set: StudioSet, session?: Pick<Session, 'name' | 'takeover' | 'start'>): string {
  return [setTitle(set), ...(session ? [sessionName(session)] : []), setHours(set)].join(', ')
}
