import type { FeatureId } from '../../api/client'
import { performanceTypeName } from '../../application-fields'
import type { Application, ApplicationStatus } from '../../application-fields'
import { countryName, countryOptions, genreName } from '../../artist-profile'
import type { Artist, ArtistLinks, GenreId } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { QUEBEC_TIME_ZONE, daysBetween, formatLongQuebecDay, quebecDayAndTime } from '../../quebec-time'
import type { Session, SessionStatus, SessionType, StudioSet } from '../../session-fields'
import type { ComboboxOption } from '../../combobox'
import { compareText } from './list'

// How the admin sections show what the API returns, search it and sort it.

// A session's status, the same in the plural, e.g. for the filters of the list of sessions, and a set's.
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = { planned: 'planifiée', done: 'jouée', cancelled: 'annulée' }
export const SESSION_STATUS_PLURALS: Record<SessionStatus, string> = { planned: 'planifiées', done: 'jouées', cancelled: 'annulées' }
export const SET_STATUS_LABELS: Record<SessionStatus, string> = { planned: 'planifié', done: 'joué', cancelled: 'annulé' }

// Whether a session is announced, as the list of sessions has it in its address (`announced`), and the same in the
// plural, for the list's filters.
export type Announced = 'true' | 'false'
export const ANNOUNCED_LABELS: Record<Announced, string> = { true: 'annoncée', false: 'non annoncée' }
export const ANNOUNCED_PLURALS: Record<Announced, string> = { true: 'annoncées', false: 'non annoncées' }

// A session's type.
export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  'guest-mixes': 'Guest mixes',
  'live-performance': 'Live performance',
  takeover: 'Takeover',
  'synth-meetup': 'Synth meetup',
  other: 'Autre',
}

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'nouvelle',
  accepted: 'retenue',
  planned: 'planifiée',
  done: 'jouée',
  rejected: 'refusée',
}
// The same, in the plural, e.g. for the filters of the applications list.
export const STATUS_PLURALS: Record<ApplicationStatus, string> = {
  new: 'nouvelles',
  accepted: 'retenues',
  planned: 'planifiées',
  done: 'jouées',
  rejected: 'refusées',
}

// What each feature flag is: its name, and what turning it on does (see docs/design/server/features.md).
export const FEATURE_LABELS: Record<FeatureId, { name: string; description: string }> = {
  'evenements-publics': {
    name: 'Événements publics',
    description: 'Les pages « Programmation » et « Synth Meetups » montrent les sessions annoncées plutôt que les événements de Resident Advisor.',
  },
}

// What each thing that takes the studio is, in the calendar (see docs/design/client/admin/calendrier.md).
export const THING_KIND_LABELS: Record<'session' | 'occupation', string> = { session: 'session', occupation: 'occupation' }

// What an app that's allowed a scope can do, as the page where admins allow it says it, in plain words (see
// docs/design/server/oauth.md): a sentence, then what's left out of it, listed under it. For `admin`, that's what the MCP
// server's tools leave out, in the same order (see "Tools" in docs/design/server/mcp.md).
export const SCOPE_DESCRIPTIONS: Record<string, { text: string; except: string[] }> = {
  admin: {
    text: 'Il pourra faire tout ce que vous faites dans les pages admin, sauf\u00a0:',
    except: [
      'gérer les admins et les applications connectées',
      "choisir les destinataires de l'envoi des candidatures par e-mail",
      'changer la connexion SoundCloud',
      'changer la connexion YouTube',
      'ajouter, modifier ou retirer les calendriers externes',
      'voir ou changer les features de la page Configuration',
      'voir, ajouter ou remplacer les photos et les flyers',
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

// The address of a session's flyer, which changes whenever the session does, like `photoUrl`, since changing its flyer
// changes it.
export function flyerUrl({ id, updatedAt, createdAt }: { id: string; updatedAt: string | null; createdAt: string }): string {
  return `/api/admin/sessions/${id}/flyer?v=${encodeURIComponent(updatedAt ?? createdAt)}`
}

// The address of the size that pages show of a photo or a flyer whose address is `url`, as `photoUrl` or `flyerUrl` give
// it: it's never shown as it was sent, which can be much larger, but pages link to it (see "Photos" in
// docs/design/server/artists.md).
export function shownUrl(url: string): string {
  return `${url}&width=1280`
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
// runs. The lists' search relies on the weekday, the day, the month and the year being next to each other, in that
// order, with the weekday and the month written out (see search in list.ts).
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

const monthFormat = new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// E.g. "novembre 2026", for a month as "YYYY-MM".
export function formatMonth(month: string): string {
  return monthFormat.format(new Date(`${month}-01`))
}

const dayInYearFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

// E.g. "mer. 7 oct.", like `formatQuebecDayInYear`, but for a day.
export function formatDayInYear(day: string): string {
  return dayInYearFormat.format(new Date(day))
}

// E.g. "1 conflit" or "2 conflits".
export const conflictCount = (count: number) => `${count} ${count === 1 ? 'conflit' : 'conflits'}`

// The address of an application's page.
export function applicationPath({ id }: { id: string }): string {
  return `/admin/candidatures/${id}`
}

// How many of an application's dates are listed, before saying how many more there are.
export const LISTED_DATES = 3

// An application's dates, as they're listed, e.g. "10 déc. 2026, 12 déc. 2026, 7 janv. 2027 (+2)".
export function listedDates(dates: string[]): string {
  const more = dates.length - LISTED_DATES
  return `${dates.slice(0, LISTED_DATES).map(formatShortDay).join(', ')}${more > 0 ? ` (+${more})` : ''}`
}

// When an application was received, as the admin pages say it, e.g. "reçue le 28 mars 2026".
export function receivedOn({ receivedAt }: { receivedAt: string }): string {
  return `reçue le ${dateFormat.format(new Date(receivedAt))}`
}

// `text` with its first letter in upper case, e.g. "Reçue le 28 mars 2026" for "reçue le 28 mars 2026".
export const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

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

// Sessions' days and times, which are in Québec time, whatever the browser's time zone (see quebec-time.ts),
// and their names (see docs/design/client/admin/sessions.md).
const quebecDayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: QUEBEC_TIME_ZONE })
const quebecDayInYearFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: QUEBEC_TIME_ZONE })

// What's shown in place of the day of a session whose date isn't known yet.
const UNDATED = 'date à déterminer'

// E.g. "sam. 14 nov. 2026", the day of `instant` (ISO 8601) in Québec.
export function formatQuebecDay(instant: string): string {
  return quebecDayFormat.format(new Date(instant))
}

// E.g. "21 h", or "21 h 30", for `minutes` (of a day, or of a duration).
function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h${minutes % 60 === 0 ? '' : ` ${String(minutes % 60).padStart(2, '0')}`}`
}

// E.g. "21 h", or "21 h 30", for a time of day, "HH:MM".
export function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  return hoursAndMinutes(hours * 60 + minutes)
}

// E.g. "1 h", "1 h 30" or "45 min".
export function formatDuration(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : hoursAndMinutes(minutes)
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

// When a session starts and ends, in Québec, as days and times, and how many days after the day it starts on it ends on.
function startAndEnd(start: string, end: string) {
  const from = quebecDayAndTime(new Date(start))
  const to = quebecDayAndTime(new Date(end))
  return { from, to, days: daysBetween(from.day, to.day) }
}

// E.g. "dim. 15 nov.", the day of `instant` (ISO 8601) in Québec, without its year.
export function formatQuebecDayInYear(instant: string): string {
  return quebecDayInYearFormat.format(new Date(instant))
}

// Whether the times alone say when something ends, as `startAndEnd` gives them: the day it starts, or the next one at an
// earlier time.
const timesSayEnd = ({ from, to, days }: ReturnType<typeof startAndEnd>) => days === 0 || (days === 1 && to.time < from.time)

// Whether the times alone say when something that starts at `start` ends at `end` (ISO 8601).
export const endsByItsTime = (start: string, end: string) => timesSayEnd(startAndEnd(start, end))

// E.g. "21 h – 1 h", when the times alone say when it ends (see `endsByItsTime`), or else with the day it ends, without its
// year, e.g. "18 h – dim. 15 nov., 2 h", or "21 h – dim. 15 nov., 21 h": a session's times in short, or those of anything
// else that takes the studio (see docs/design/client/admin/calendrier.md).
export function shortTimes({ start, end }: { start: string; end: string }): string {
  const times = startAndEnd(start, end)
  const endDay = timesSayEnd(times) ? '' : `${formatQuebecDayInYear(end)}, `
  return `${formatTime(times.from.time)} – ${endDay}${formatTime(times.to.time)}`
}

// A session's times in short (see `shortTimes`), or how long a session without a date lasts, e.g. "4 h".
export function sessionHours({ start, end, durationMinutes }: SessionTimes): string {
  return start === null || end === null ? formatDuration(durationMinutes) : shortTimes({ start, end })
}

// E.g. "samedi 14 novembre 2026, de 21 h à 23 h", "samedi 14 novembre 2026, de 21 h à 1 h le lendemain", or "du vendredi
// 13 novembre 2026 à 18 h au dimanche 15 novembre 2026 à 2 h", or "date à déterminer".
export function sessionWhen({ start, end }: SessionTimes): string {
  if (start === null || end === null) return UNDATED
  const { from, to, days } = startAndEnd(start, end)
  if (days > 1) return `du ${formatLongQuebecDay(start)} à ${formatTime(from.time)} au ${formatLongQuebecDay(end)} à ${formatTime(to.time)}`
  return `${formatLongQuebecDay(start)}, de ${formatTime(from.time)} à ${formatTime(to.time)}${days === 1 ? ' le lendemain' : ''}`
}

// Sessions without a date are later than any other, then by when they were added.
export function compareStarts(a: Pick<Session, 'start' | 'createdAt'>, b: Pick<Session, 'start' | 'createdAt'>): number {
  const start = (session: Pick<Session, 'start'>) => (session.start === null ? Infinity : Date.parse(session.start))
  return start(a) - start(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt)
}

// What a session is searched by: its title, its type, its takeover's collective, its sets' performers, and its day,
// written out, e.g. "samedi 14 novembre 2026", so that "novembre" or "samedi" finds it, or "date à déterminer".
export function sessionSearchFields(session: Session): string[] {
  return [
    session.title,
    SESSION_TYPE_LABELS[session.type],
    session.takeover?.name ?? '',
    ...session.sets.flatMap((set) => set.performers.map((performer) => performer.name)),
    sessionLongDay(session),
  ].filter(Boolean)
}

// A session as it's named along with others: its title, which the server gives, then its day, e.g. "HAUTE RIVE TAKEOVER,
// sam. 14 nov. 2026", or "GUEST MIXES, date à déterminer". Where it's named alone, e.g. as its page's title, it's its
// title only.
export function sessionName(session: Pick<Session, 'title' | 'start'>): string {
  return `${session.title}, ${sessionDay(session)}`
}

// How long a set lasts, e.g. "1 h 30", or "à déterminer" when that isn't known.
export function setDuration({ durationMinutes }: Pick<StudioSet, 'durationMinutes'>): string {
  return durationMinutes === null ? 'à déterminer' : formatDuration(durationMinutes)
}

// A session's sets' performers, as text, set by set, the sets separated by "·", e.g. "Aurore, Brume · Écume".
export function sessionPerformers(session: Pick<Session, 'sets'>): string {
  return session.sets
    .filter((set) => set.performers.length > 0)
    .map((set) => set.performers.map((performer) => performer.name).join(', '))
    .join(' · ')
}

// What a set is called: e.g. "Set de Aurore, Brume et Écume", or "Set" once its performers are all deleted.
export function setTitle(set: Pick<StudioSet, 'performers'>): string {
  return set.performers.length > 0 ? `Set de ${enumerate(set.performers.map((performer) => performer.name))}` : 'Set'
}

// A set as it's named on its session's page, e.g. "Set de Aurore", or outside it, with its session, e.g. "Set de Aurore,
// HAUTE RIVE TAKEOVER, sam. 14 nov. 2026".
export function setName(set: Pick<StudioSet, 'performers'>, session?: Pick<Session, 'title' | 'start'>): string {
  return [setTitle(set), ...(session ? [sessionName(session)] : [])].join(', ')
}

// A set as it's named within a sentence on its session's page, e.g. "le set de Aurore", or "le set" once its performers
// are all deleted.
export function setInSentence(set: Pick<StudioSet, 'performers'>): string {
  const names = set.performers.map((performer) => performer.name)
  return `le set${names.length > 0 ? ` de ${enumerate(names)}` : ''}`
}
