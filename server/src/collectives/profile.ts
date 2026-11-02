import { z } from 'zod'
import { BIO_MAX_LENGTH, NAME_MAX_LENGTH, city, country, email, emailAddress, line, links, orLeftOut, phone, text } from '../artists/profile.js'

// A collective's profile: the rules every collective's profile has to follow (see docs/design/server/collectives.md), as
// the zod schemas the server checks them with, which openapi.json is generated from. They share most of their rules
// with artists' profiles (see artists/profile.ts), and explain what's wrong in French like them, except for the error
// about a member's id, which only admins can see (see `NO_SUCH_MEMBER`). Two collectives can't have the same email
// address, whatever its case, but a collective can have an artist's.
//
// The client has its own copy of these rules, for its form to say what's wrong right away (see
// client/src/collective-profile.ts): they must be changed together. These are the ones that count.

// The error about a member's id that isn't an artist's, including an id that isn't a string, which is in English, since
// only admins send ids.
export const NO_SUCH_MEMBER = 'No such artist'

export const NO_MEMBER = 'Indiquez au moins un artiste du collectif.'
const NO_MEMBER_NAME = "Indiquez le nom de chaque artiste du collectif."

// Whether a member, as it's sent, is an artist who exists, by their id, rather than one to create, by their name.
function hasId(value: unknown): value is { id: unknown } {
  return typeof value === 'object' && value !== null && 'id' in value && value.id !== undefined
}

// A member, as it's sent: an artist who exists, by their id, or one to create with this name, and everything else left
// out. Other fields are ignored, so that a collective's members, as the endpoints return them, can be sent back as
// they are: the id is what counts when there's both.
const Member = z.preprocess(
  (value) => (hasId(value) ? { id: value.id } : value),
  z.union(
    [
      z.object({ id: z.string() }),
      z.object({ name: line("Le nom d'un artiste du collectif", NAME_MAX_LENGTH, NO_MEMBER_NAME) }),
    ],
    { error: (issue) => (hasId(issue.input) ? NO_SUCH_MEMBER : NO_MEMBER_NAME) },
  ),
)

// The members, in order, at least one. An artist is only once in a collective, so an id that's there twice is dropped,
// keeping the first.
const Members = z
  .array(Member, { error: NO_MEMBER })
  .overwrite((members) => members.filter((member, i) => !('id' in member) || members.findIndex((other) => 'id' in other && other.id === member.id) === i))
  .min(1, NO_MEMBER)
  .meta({
    description:
      'In order, at least one, once ids that are there twice are dropped. Each one is an artist who exists, by their `id`, or ' +
      'one to create, by their `name`, with everything else left out. Other fields are ignored, and the id is what counts ' +
      'when there are both',
  })

// The profile of a collective, as it's sent, with what admins `canLeaveOut`: the same fields as for an artist, where the
// email and phone are the contact's.
function profile({ canLeaveOut }: { canLeaveOut: boolean }) {
  const description = text('La description', BIO_MAX_LENGTH, 'Écrivez quelques lignes de description.', { canBeEmpty: canLeaveOut })
  return z.object({
    name: line('Le nom du collectif', NAME_MAX_LENGTH, 'Indiquez le nom du collectif.'),
    members: Members,
    country: country({ canLeaveOut }),
    city: city({ canLeaveOut }),
    description: canLeaveOut ? orLeftOut(description, '') : description,
    links: links({ canLeaveOut }),
    email: email({ canLeaveOut }),
    phone: phone({ canLeaveOut }),
  })
}

// A collective's profile, as admins send it: they can leave out the country, city, description, links, email and phone,
// as for an artist, e.g. for collectives the team only knows by name. What's there still has to be valid. It's cleaned up
// as it's checked, and the first error is what the server answers.
export const AdminCollectiveProfile = profile({ canLeaveOut: true }).meta({ id: 'AdminCollectiveProfile' })

// A collective's profile, as it sends it when it applies (see `Applicant` in applications/applicant.ts), with nothing left
// out. Its members are artists who apply with it, rather than members as admins send them. Its email is said again, as
// for `ArtistProfile` (see artists/profile.ts).
export const ApplicantCollectiveProfile = profile({ canLeaveOut: false }).omit({ members: true }).extend({ email: emailAddress() })

export type CollectiveProfile = z.output<typeof AdminCollectiveProfile>
// What's saved of the profile of a collective that applied, which always has an email address.
export type ApplicantCollective = z.output<typeof ApplicantCollectiveProfile>
export type SentMember = CollectiveProfile['members'][number]
