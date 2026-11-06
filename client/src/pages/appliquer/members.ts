import type { ApplicantMember } from '../../applicant'
import type { FieldErrors } from '../../checks'
import type { Profile } from './profile'

// The artists of a collective, as the form keeps them while they're being filled in (see members-field.tsx).

// One of a collective's artists, as they're being filled in. `key` tells them apart, whatever their place. `tried` is set
// once sending the form was tried with them in it: their errors only show from then on (see `shownErrors`).
export type Member = Profile & { key: number; tried: boolean }

export function emptyMember(key: number): Member {
  return { key, tried: false, name: '', country: null, city: '', genres: [], photo: null, bio: '', links: {} }
}

// What's wrong with a member's profile, by field.
export type MemberErrors = FieldErrors<ApplicantMember & { photo: unknown }>
