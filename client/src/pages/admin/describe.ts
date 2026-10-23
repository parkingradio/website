import type { Artist, ArtistKind, GenreId } from 'shared/artists'
import { PRESTATIONS } from 'shared/applications'
import type { Application, ApplicationStatus, PrestationId } from 'shared/applications'
import type { FeatureId } from 'shared/features'
import { countryName, countryOptions, genreName } from '../../artist-profile'

// How the admin sections show what the API returns, and search it.

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

// What each feature flag is: its name, and what turning it on does (see shared/src/features.ts).
export const FEATURE_LABELS: Record<FeatureId, { name: string; description: string }> = {
  'nouveau-formulaire-candidature': {
    name: 'Nouveau formulaire de candidature',
    description: 'La page « Appliquer » montre le formulaire du site plutôt que le Google Form.',
  },
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

export function prestationName(id: PrestationId): string {
  return PRESTATIONS.find((prestation) => prestation.id === id)?.name ?? id
}

// E.g. "DJ, Vinyl, autre : synthé modulaire", or "" when there's none.
export function describePrestations({ prestations, otherPrestation }: Pick<Application, 'prestations' | 'otherPrestation'>): string {
  return [...prestations.map(prestationName), ...(otherPrestation ? [`autre : ${otherPrestation}`] : [])].join(', ')
}

// The address of an artist's photo. The photo can change while its address stays the same, so the address changes with
// the artist to get the browser to load it again. The server ignores it.
export function photoUrl(artist: Artist): string {
  return `/api/admin/artists/${artist.id}/photo?v=${encodeURIComponent(artist.updatedAt ?? artist.createdAt)}`
}

// The name of an artist's country, or "" when it's left out.
export function countryOf({ country }: { country: string }): string {
  return country && countryName(country)
}

// E.g. "Québec, Canada", or only the city or the country, when the other one is left out.
export function place(artist: { city: string; country: string }): string {
  return [artist.city, countryOf(artist)].filter(Boolean).join(', ') || MISSING
}

// E.g. "techno, ambient", most important first.
export function genreNames(genres: GenreId[]): string {
  return genres.map(genreName).join(', ') || MISSING
}

// What an artist is searched by, in the lists: their names, how to reach them, where they're from, their genres and the
// profile names of their links, but not their bio, which would match too many searches. Their phone number is there
// with its digits only too, so that it's found however it's typed.
export function artistSearchFields(artist: Artist): string[] {
  return [
    artist.name,
    ...artist.members,
    artist.email,
    artist.phone,
    artist.phone.replace(/\D/g, ''),
    artist.city,
    countryOf(artist),
    ...artist.genres.map(genreName),
    ...Object.values(artist.links),
  ].filter((field): field is string => Boolean(field))
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
