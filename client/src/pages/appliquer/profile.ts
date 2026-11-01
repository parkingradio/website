import type { GenreId, LinkSiteId } from '../../artist-profile'

// An artist's profile as it's being filled in, by an artist applying alone or for each of a collective's artists (see
// profile-fields.tsx).
export type Profile = {
  name: string
  country: string | null
  city: string
  genres: GenreId[]
  photo: File | null
  bio: string
  // What was typed for each site, as is.
  links: Partial<Record<LinkSiteId, string>>
}

// The id of a field of a profile, whose fields' ids all start with `prefix`, since there are several profiles on the page.
// Not "country" and "city", which Safari takes as address fields to fill from the visitor's contact card, on top of the
// countries and cities suggested here.
export function fieldId(prefix: string, field: 'nom' | 'pays' | 'ville' | 'photo' | 'bio'): string {
  return `${prefix}${field}`
}
