import type { Schema } from './api/client'
import { checkArtistName, checkBio, checkCity, checkCountry, checkEmail, checkGenres, checkLinks, checkPhone, checkProfile } from './artist-profile'
import type { Profile } from './artist-profile'
import { fieldChecker } from './checks'
import type { FieldErrors } from './checks'
import { NO_MEMBER, checkCollectiveName, checkDescription } from './collective-profile'

// Who applies through the "Appliquer" form: an artist alone, or a collective, with a profile for each of its artists. It's
// checked with a copy of the server's rules (see server/src/applications/applicant.ts), which must be changed together
// with these.

export type Applicant = Schema<'Applicant'>
export type ApplicantKind = Applicant['kind']
export type ApplicantMember = Schema<'ApplicantMember'>
type CollectiveApplicant = Extract<Applicant, { kind: 'collective' }>

// What's wrong with who applies, by field, e.g. `name`, and for a collective, with each of its artists, in order.
export type ApplicantErrors = {
  errors: FieldErrors<Profile & CollectiveApplicant>
  memberErrors: FieldErrors<ApplicantMember>[]
}

// Checks one of a collective's artists as the server does: like an artist alone, without the email and phone. Returns
// what's sent of them, or what's wrong with each field. The server says which artist it is in its message, e.g.
// "Artiste 2 : Indiquez la ville.", which the form doesn't need, since it shows the errors in the artist's profile.
export function checkApplicantMember(sent: unknown): { member: ApplicantMember; errors?: undefined } | { member?: undefined; errors: FieldErrors<ApplicantMember> } {
  const member: Partial<Record<keyof ApplicantMember, unknown>> = sent !== null && typeof sent === 'object' ? sent : {}
  const { errors, check } = fieldChecker<ApplicantMember>()
  const name = check('name', checkArtistName(member.name))
  // Without `lenient`, a country is never left out.
  const country = check('country', checkCountry(member.country)) as ApplicantMember['country']
  const city = check('city', checkCity(member.city))
  const genres = check('genres', checkGenres(member.genres))
  const bio = check('bio', checkBio(member.bio))
  const links = check('links', checkLinks(member.links))
  if (Object.keys(errors).length > 0) return { errors }
  return { member: { name, country, city, genres, bio, links } }
}

// Checks who applies as the server does: an artist like `checkProfile`, and a collective with its own profile, with
// nothing left out, and its artists, at least one. Returns what's sent of it, or what's wrong.
export function checkApplicant(
  sent: unknown,
): { applicant: Applicant; errors?: undefined; memberErrors?: undefined } | ({ applicant?: undefined } & ApplicantErrors) {
  const applicant: Partial<Record<keyof (Profile & CollectiveApplicant), unknown>> = sent !== null && typeof sent === 'object' ? sent : {}
  // Until it's said whether it's an artist or a collective, it's checked as an artist.
  if (applicant.kind !== 'collective') {
    const checked = checkProfile(applicant)
    const errors: ApplicantErrors['errors'] = { ...checked.errors }
    if (applicant.kind !== 'artist') errors.kind = 'Indiquez si vous postulez comme artiste ou comme collectif.'
    if (!checked.profile || Object.keys(errors).length > 0) return { errors, memberErrors: [] }
    // Without `lenient`, `checkProfile` only returns what artists can send, e.g. with an email, which its type doesn't say.
    return { applicant: { kind: 'artist', ...(checked.profile as Omit<Extract<Applicant, { kind: 'artist' }>, 'kind'>) } }
  }

  const { errors, check } = fieldChecker<Profile & CollectiveApplicant>()
  const name = check('name', checkCollectiveName(applicant.name))
  const country = check('country', checkCountry(applicant.country)) as CollectiveApplicant['country']
  const city = check('city', checkCity(applicant.city))
  const description = check('description', checkDescription(applicant.description))
  const links = check('links', checkLinks(applicant.links))
  const email = check('email', checkEmail(applicant.email))
  const phone = check('phone', checkPhone(applicant.phone))
  const sentMembers: unknown[] = Array.isArray(applicant.members) ? applicant.members : []
  if (sentMembers.length === 0) errors.members = NO_MEMBER
  const members = sentMembers.map(checkApplicantMember)
  const memberErrors = members.map((member) => member.errors ?? {})

  if (Object.keys(errors).length > 0 || memberErrors.some((member) => Object.keys(member).length > 0)) return { errors, memberErrors }
  return {
    applicant: { kind: 'collective', name, country, city, description, links, email, phone, members: members.map((member) => member.member!) },
  }
}
