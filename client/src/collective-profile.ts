import type { Schema } from './api/client'
import { BIO_MAX_LENGTH, NAME_MAX_LENGTH, checkCity, checkCountry, checkEmail, checkLinks, checkPhone, missingError } from './artist-profile'
import { checkLine, checkText, fieldChecker } from './checks'
import type { Checked, FieldErrors } from './checks'

// How a collective's profile is checked in the browser, by the admin pages.
//
// The admin form checks profiles as the server does, to say what's wrong right away, with a copy of the server's rules and
// messages (see server/src/collectives/profile.ts), which must be changed together with these. Most of them are an
// artist's (see artist-profile.ts). The server's are the ones that count: when they disagree, the server's message shows.

export type Collective = Schema<'Collective'>
// A member, as a request sends them: an artist who exists, by their id, or a new one, by their name.
export type SentMember = Schema<'AdminCollectiveProfile'>['members'][number]

// A profile, as the server saves it, with the members as they're sent, which is what `checkCollectiveProfile` returns.
export type CollectiveProfile = Omit<Collective, 'id' | 'createdAt' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'hasPhoto' | 'members'> & {
  members: SentMember[]
}

export const NO_MEMBER = 'Indiquez au moins un artiste du collectif.'
const NO_MEMBER_NAME = 'Indiquez le nom de chaque artiste du collectif.'

export function checkCollectiveName(value: unknown): Checked<string> {
  return checkLine(value, 'Le nom du collectif', NAME_MAX_LENGTH, 'Indiquez le nom du collectif.')
}

export function checkDescription(value: unknown, { lenient = false } = {}): Checked<string> {
  return checkText(value, 'La description', BIO_MAX_LENGTH, missingError(value, 'Écrivez quelques lignes de description.', { lenient }))
}

// A member, as it's sent: the id is what counts when there's both an id and a name.
function checkMember(member: unknown): Checked<SentMember> {
  const sent: { id?: unknown; name?: unknown } = member !== null && typeof member === 'object' ? member : {}
  if (sent.id !== undefined) return typeof sent.id === 'string' ? { value: { id: sent.id } } : { error: 'No such artist' }
  const name = checkLine(sent.name, "Le nom d'un artiste du collectif", NAME_MAX_LENGTH, NO_MEMBER_NAME)
  return name.error === undefined ? { value: { name: name.value } } : name
}

// Checks a profile as it's being filled in the admin form, and returns what the server would save of it, or what's wrong
// with each field instead, like `checkProfile` with `lenient`: admins can leave out the country, city, description,
// links and phone, but not the contact's email. The members are in order, at least one, and an artist who's there twice
// is only kept the first time.
export function checkCollectiveProfile(
  sent: unknown,
): { profile: CollectiveProfile; errors?: undefined } | { profile?: undefined; errors: FieldErrors<CollectiveProfile> } {
  const collective: Partial<Record<keyof CollectiveProfile, unknown>> = sent !== null && typeof sent === 'object' ? sent : {}
  const { errors, check } = fieldChecker<CollectiveProfile>()

  const name = check('name', checkCollectiveName(collective.name))
  const members: SentMember[] = []
  for (const sentMember of Array.isArray(collective.members) ? collective.members : []) {
    const member: SentMember | undefined = check('members', checkMember(sentMember))
    if (member && !('id' in member && members.some((other) => 'id' in other && other.id === member.id))) members.push(member)
  }
  if (members.length === 0) errors.members ??= NO_MEMBER
  const country = check('country', checkCountry(collective.country, { lenient: true }))
  const city = check('city', checkCity(collective.city, { lenient: true }))
  const description = check('description', checkDescription(collective.description, { lenient: true }))
  const links = check('links', checkLinks(collective.links, { lenient: true }))
  const email = check('email', checkEmail(collective.email))
  const phone = check('phone', checkPhone(collective.phone, { lenient: true }))

  if (Object.keys(errors).length > 0) return { errors }
  return { profile: { name, members, country, city, description, links, email, phone } }
}
