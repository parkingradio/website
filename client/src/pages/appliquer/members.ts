import type { ApplicantMember } from '../../applicant'
import type { GenreId, LinkSiteId } from '../../artist-profile'
import type { FieldErrors } from '../../checks'

// The artists of a collective, as the form keeps them while they're being filled in (see members-field.tsx).

// One of a collective's artists, as they're being filled in. `key` tells them apart, whatever their place.
export type Member = {
  key: number
  name: string
  country: string | null
  city: string
  genres: GenreId[]
  photo: File | null
  bio: string
  // What was typed for each site, as is.
  links: Partial<Record<LinkSiteId, string>>
}

export function emptyMember(key: number): Member {
  return { key, name: '', country: null, city: '', genres: [], photo: null, bio: '', links: {} }
}

// What's wrong with a member's profile, by field.
export type MemberErrors = FieldErrors<ApplicantMember & { photo: unknown }>
