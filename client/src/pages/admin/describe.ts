import { COUNTRIES, GENRES } from 'shared/artists'
import type { ArtistKind, GenreId } from 'shared/artists'
import type { ApplicationStatus } from 'shared/applications'
import type { ComboboxOption } from '../../combobox'

// How the artists and applications sections show what the API returns.

export const KIND_LABELS: Record<ArtistKind, string> = { artist: 'artiste', collective: 'collectif' }
export const STATUS_LABELS: Record<ApplicationStatus, string> = { new: 'nouvelle', accepted: 'retenue', rejected: 'refusée' }

const countryNames = new Intl.DisplayNames(['fr'], { type: 'region' })

export function countryName(code: string): string {
  return countryNames.of(code) ?? code
}

// Every country, by name, for picking one.
export const COUNTRY_OPTIONS: ComboboxOption[] = COUNTRIES.map((key) => ({ key, label: countryName(key) })).sort((a, b) =>
  a.label.localeCompare(b.label, 'fr'),
)

export function genreName(id: GenreId): string {
  return GENRES.find((genre) => genre.id === id)?.name ?? id
}

export function place({ city, country }: { city: string; country: string }): string {
  return `${city}, ${countryName(country)}`
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
