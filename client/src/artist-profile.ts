import { COUNTRIES, GENRES, PHOTO_TYPES, photoError } from 'shared/artists'
import type { GenreId } from 'shared/artists'
import type { ComboboxOption } from './combobox'

// How an artist's profile is shown and checked in the browser, by the admin pages and by the "Appliquer" form alike.

const countryNames = new Intl.DisplayNames(['fr'], { type: 'region' })

export function countryName(code: string): string {
  return countryNames.of(code) ?? code
}

// Every country, for picking one: those in `first`, in that order, then the others by name.
export function countryOptions(first: string[] = []): ComboboxOption[] {
  const others = COUNTRIES.filter((code) => !first.includes(code)).sort((a, b) => countryName(a).localeCompare(countryName(b), 'fr'))
  return [...first, ...others].map((key) => ({ key, label: countryName(key) }))
}

export function genreName(id: GenreId): string {
  return GENRES.find((genre) => genre.id === id)?.name ?? id
}

// What's wrong with a photo picked in a form, if one was (see `photoError`). When the browser doesn't know the photo's
// type, which the server tells from its contents anyway, only its size is checked.
export function pickedPhotoError(photo: File | null): string | null {
  return photo && photoError({ type: photo.type || PHOTO_TYPES[0], size: photo.size })
}
