import { z } from 'zod'
import { ArtistProfile, NAME_MAX_LENGTH, line } from '../artists/profile.js'
import type { ApplicantProfile, Profile } from '../artists/profile.js'
import type { StoredPhoto } from '../artists/store.js'
import { AdminCollectiveProfile, NO_MEMBER } from '../collectives/profile.js'
import type { CollectiveProfile } from '../collectives/profile.js'
import { newMember } from '../collectives/store.js'

// Who applies with `POST /api/applications`: an artist alone, or a collective, with its artists' names, and what's saved
// of them (see docs/design/server/applications.md). Artists see its errors, so they're in French.
//
// The client has its own copy of these rules, for the form to say what's wrong right away (see client/src/applicant.ts):
// they must be changed together. These are the ones that count.

const NO_KIND = 'Indiquez si vous postulez comme artiste ou comme collectif.'

// A collective's artists, by name, in order, at least one. What isn't a name is dropped, then blank names and
// duplicates, whatever their case.
const MemberNames = z.preprocess(
  (value) => (Array.isArray(value) ? value.filter((member) => typeof member === 'string') : value),
  z
    .array(line("Le nom d'un artiste du collectif", NAME_MAX_LENGTH, NO_MEMBER, { canBeEmpty: true }), { error: NO_MEMBER })
    .overwrite((names) => {
      const seen = new Set<string>()
      return names.filter((name) => {
        const key = name.toLowerCase()
        if (!name || seen.has(key)) return false
        seen.add(key)
        return true
      })
    })
    .min(1, NO_MEMBER)
    .meta({ description: 'At least one, once blank names and duplicates, whatever their case, are dropped' }),
)

// An artist's profile, as they send it when they apply, with whether they apply alone or as a collective. A collective
// sends its artists' names too, and the errors about its name say it's a collective's. An artist's `members` are
// ignored.
const { name, ...fields } = ArtistProfile.shape
export const Applicant = z
  .discriminatedUnion(
    'kind',
    [
      z.object({ kind: z.literal('artist'), name, ...fields }),
      z.object({ kind: z.literal('collective'), name: AdminCollectiveProfile.shape.name, members: MemberNames, ...fields }),
    ],
    { error: NO_KIND },
  )
  .meta({ id: 'Applicant' })
export type Applicant = z.output<typeof Applicant>

// Who applied, as they're saved: an artist, or a collective and its artists, in order.
export type Applied = { artist: ApplicantProfile } | { collective: Omit<CollectiveProfile, 'members'>; members: (Profile & StoredPhoto)[] }

// What's saved of who applied. A collective's artists are new artists, known only by their name, with the genres it
// sent, since a collective has none of its own.
export function applied(applicant: Applicant): Applied {
  const { name, country, city, genres, bio, links, email, phone } = applicant
  if (applicant.kind === 'artist') return { artist: { name, country, city, genres, bio, links, email, phone } }
  return {
    collective: { name, country, city, description: bio, links, email, phone },
    members: applicant.members.map((member) => newMember(member, null, genres)),
  }
}
