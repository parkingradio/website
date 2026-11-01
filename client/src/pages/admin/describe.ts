import type { Schema } from '../../api/client'
import { prestationName } from '../../application-fields'
import type { Application, ApplicationStatus } from '../../application-fields'
import { countryName, countryOptions, genreName } from '../../artist-profile'
import type { Artist, ArtistKind, ArtistLinks, GenreId } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { compareText } from './list'

// How the admin sections show what the API returns, search it and sort it.

export const KIND_LABELS: Record<ArtistKind, string> = { artist: 'artiste', collective: 'collectif' }
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
export const FEATURE_LABELS: Record<Schema<'FeatureId'>, { name: string; description: string }> = {
  'nouveau-lecteur': {
    name: 'Nouveau lecteur',
    description:
      "Une barre noire en bas de chaque page fait jouer la radio en ondes, et une pastille « en ondes » apparaît dans le menu. La barre remplace l'ancien lecteur de l'accueil, où une bannière fait défiler les artistes de la rotation.",
  },
}

export { countryName, genreName } from '../../artist-profile'

// What's shown in place of what an artist's profile leaves out, which only admins can do (see `checkProfile`), e.g. for
// artists who applied through the original Google Form.
export const MISSING = '-'

// Every country, by name, for picking one, after "Pays inconnu", which leaves the country out.
export const COUNTRY_OPTIONS = [{ key: '', label: 'Pays inconnu' }, ...countryOptions()]

// E.g. "DJ, Vinyl, autre : synthé modulaire", or "" when there's none.
export function describePrestations({ prestations, otherPrestation }: Pick<Application, 'prestations' | 'otherPrestation'>): string {
  return [...prestations.map(prestationName), ...(otherPrestation ? [`autre : ${otherPrestation}`] : [])].join(', ')
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

// Which of three an entry of the list of artists and collectives is: an artist, a collective, or an artist whose `kind` is
// "collective", as collectives were before they had their own profiles, until they're migrated.
export type EntryKind = 'artist' | 'legacy-collective' | 'collective'

// Both kinds of collectives are collectives, as far as admins are concerned.
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = { artist: 'artiste', 'legacy-collective': 'collectif', collective: 'collectif' }

export function artistEntryKind(artist: Artist): EntryKind {
  return artist.kind === 'collective' ? 'legacy-collective' : 'artist'
}

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

// What an artist is searched by, and a collective whose `kind` is "collective", by its artists' names too.
export function artistSearchFields(artist: Artist): string[] {
  return searchFields([artist.name, ...artist.members], artist, artist.genres)
}

// What a collective is searched by, with its artists' names and `genres`.
export function collectiveSearchFields(collective: Collective, genres: GenreId[]): string[] {
  return searchFields([collective.name, ...collective.members.map((member) => member.name)], collective, genres)
}

export const dateFormat = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long' })
export const dateTimeFormat = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short' })
// Days are "YYYY-MM-DD", which are read as midnight UTC, so they're formatted in UTC to be the same day wherever this
// runs.
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

// "Ajouté par X le ...", or the like: who did something and when, if anyone did.
export function byWhom(verb: string, who: string | null, when: string | null): string | null {
  if (!who || !when) return null
  return `${verb} par ${who} le ${dateTimeFormat.format(new Date(when))}.`
}

// Who added an artist or a collective, or that they applied by themselves, e.g. "collectif, ajouté par …".
export function addedBy(kind: string, { createdBy, createdAt }: { createdBy: string | null; createdAt: string }): string {
  return `${kind}, ${byWhom('ajouté', createdBy, createdAt) ?? `inscrit par le formulaire «\u00a0appliquer\u00a0» le ${dateFormat.format(new Date(createdAt))}.`}`
}
