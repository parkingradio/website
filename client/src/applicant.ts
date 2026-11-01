import type { Schema } from './api/client'
import { NAME_MAX_LENGTH, checkProfile } from './artist-profile'
import type { Profile } from './artist-profile'
import { checkLine } from './checks'
import type { FieldErrors } from './checks'
import { NO_MEMBER, checkCollectiveName } from './collective-profile'

// Who applies through the "Appliquer" form: an artist alone, or a collective, with its artists' names. It's checked with
// a copy of the server's rules (see server/src/applications/applicant.ts), which must be changed together with these.

export type Applicant = Schema<'Applicant'>
export type ApplicantKind = Applicant['kind']
type Fields = Profile & { kind: ApplicantKind; members: string[] }

// Checks who applies as the server does: like `checkProfile`, with whether it's an artist or a collective, and for a
// collective, its artists' names, and its own name's errors. Returns what's sent of it, or what's wrong with each field.
export function checkApplicant(sent: unknown): { applicant: Applicant; errors?: undefined } | { applicant?: undefined; errors: FieldErrors<Fields> } {
  const applicant: Partial<Record<keyof Fields, unknown>> = sent !== null && typeof sent === 'object' ? sent : {}
  const checked = checkProfile(applicant)
  const errors: FieldErrors<Fields> = { ...checked.errors }
  const kind = applicant.kind === 'artist' || applicant.kind === 'collective' ? applicant.kind : null
  if (!kind) errors.kind = 'Indiquez si vous postulez comme artiste ou comme collectif.'

  // Blank names and duplicates, whatever their case, are dropped.
  const members: string[] = []
  if (kind === 'collective') {
    if (errors.name) errors.name = checkCollectiveName(applicant.name).error
    for (const member of Array.isArray(applicant.members) ? applicant.members : []) {
      const name = checkLine(member, "Le nom d'un artiste du collectif", NAME_MAX_LENGTH, null)
      if (name.error) errors.members ??= name.error
      else if (name.value && !members.some((other) => other.toLowerCase() === name.value.toLowerCase())) members.push(name.value)
    }
    if (members.length === 0) errors.members ??= NO_MEMBER
  }

  if (!kind || !checked.profile || Object.keys(errors).length > 0) return { errors }
  // Without `lenient`, `checkProfile` only returns what artists can send, e.g. with an email, which its type doesn't say.
  const profile = checked.profile as Omit<Applicant, 'kind'>
  return { applicant: kind === 'collective' ? { kind, ...profile, members } : { kind, ...profile } }
}
