import { z } from 'zod'
import { ArtistProfile, NO_NAME } from '../artists/profile.js'
import type { ApplicantProfile, Profile } from '../artists/profile.js'
import { InvalidProfile } from '../artists/store.js'
import { ApplicantCollectiveProfile, NO_MEMBER } from '../collectives/profile.js'
import type { ApplicantCollective } from '../collectives/profile.js'

// Who applies with `POST /api/applications`: an artist alone, or a collective, with a profile for each of its artists, and
// what's saved of them (see docs/design/server/applications.md). Artists see its errors, so they're in French.
//
// The client has its own copy of these rules, for the form to say what's wrong right away (see client/src/applicant.ts):
// they must be changed together. These are the ones that count.

const NO_KIND = 'Indiquez si vous postulez comme artiste ou comme collectif.'

// One of a collective's artists, as the collective sends them: an artist's profile, without the email and phone, since
// the team only reaches the collective's contact.
const { name, country, city, genres, bio, links } = ArtistProfile.shape
export const ApplicantMember = z.object({ name, country, city, genres, bio, links }, { error: NO_NAME }).meta({ id: 'ApplicantMember' })

// An artist alone sends their profile. A collective sends its own, and its artists', in order, at least one.
export const Applicant = z
  .discriminatedUnion(
    'kind',
    [
      z.object({ kind: z.literal('artist'), ...ArtistProfile.shape }),
      z.object({
        kind: z.literal('collective'),
        ...ApplicantCollectiveProfile.shape,
        members: z.array(ApplicantMember, { error: NO_MEMBER }).min(1, NO_MEMBER).meta({ description: 'In order, at least one' }),
      }),
    ],
    { error: NO_KIND },
  )
  .meta({ id: 'Applicant' })
export type Applicant = z.output<typeof Applicant>

// The error of an artist of a collective says which one it is, e.g. "Artiste 2 : Indiquez la ville.", counting from 1.
export function memberError(index: number, message: string): string {
  return `Artiste ${index + 1} : ${message}`
}

// Checks who applies, and returns what was sent of them, cleaned up. Throws an InvalidProfile, saying what's wrong with
// the first field that's wrong, otherwise.
export function validateApplicant(sent: unknown): Applicant {
  const result = Applicant.safeParse(sent)
  if (result.success) return result.data
  const [{ path, message }] = result.error.issues
  throw new InvalidProfile(path[0] === 'members' && typeof path[1] === 'number' ? memberError(path[1], message) : message)
}

// Who applied, as they're saved: an artist, or a collective and its artists, in order.
export type Applied = { artist: ApplicantProfile } | { collective: ApplicantCollective; members: Profile[] }

// What's saved of who applied. A collective's artists are new artists, without an email or a phone.
export function applied(applicant: Applicant): Applied {
  const { name, country, city, links, email, phone } = applicant
  if (applicant.kind === 'artist') return { artist: { name, country, city, genres: applicant.genres, bio: applicant.bio, links, email, phone } }
  return {
    collective: { name, country, city, description: applicant.description, links, email, phone },
    members: applicant.members.map((member) => ({ ...member, email: null, phone: '' })),
  }
}
