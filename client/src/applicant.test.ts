import { describe, expect, it } from 'vitest'
import { checkApplicant } from './applicant'

// The client's copy of the server's rules for who applies (see server/src/applications/applicant.ts). The fields that
// aren't about being an artist or a collective are checked like an artist's profile (see artist-profile.test.ts).

const ARTIST = {
  kind: 'artist',
  name: 'DJ Test',
  country: 'CA',
  city: 'Québec',
  genres: ['techno'],
  bio: 'Une bio.',
  links: { instagram: '@parking.radio' },
  email: 'artiste@example.com',
  phone: '418 555-0123',
}
const COLLECTIVE = { ...ARTIST, kind: 'collective', name: 'Le Collectif', members: ['Une', 'Deux'] }

describe('checkApplicant', () => {
  it('returns an artist without their members, and a collective with its artists, without blanks or duplicates', () => {
    expect(checkApplicant({ ...ARTIST, members: ['Une'] })).toEqual({ applicant: { ...ARTIST, links: { instagram: 'parking.radio' } } })
    const { applicant } = checkApplicant({ ...COLLECTIVE, members: ['Une', ' Deux ', '', 'une'] })
    expect(applicant).toEqual({ ...COLLECTIVE, links: { instagram: 'parking.radio' }, members: ['Une', 'Deux'] })
  })

  it('needs to know whether it is an artist or a collective', () => {
    for (const kind of [undefined, 'duo']) {
      expect(checkApplicant({ ...ARTIST, kind }).errors).toEqual({ kind: 'Indiquez si vous postulez comme artiste ou comme collectif.' })
    }
  })

  it("says what is wrong with a collective's name and artists as a collective's", () => {
    expect(checkApplicant({ ...COLLECTIVE, name: '', members: [' '] }).errors).toEqual({
      name: 'Indiquez le nom du collectif.',
      members: 'Indiquez au moins un artiste du collectif.',
    })
    expect(checkApplicant({ ...COLLECTIVE, name: 'x'.repeat(101), members: ['x'.repeat(101)] }).errors).toEqual({
      name: 'Le nom du collectif dépasse 100 caractères.',
      members: "Le nom d'un artiste du collectif dépasse 100 caractères.",
    })
    expect(checkApplicant({ ...COLLECTIVE, members: ['A', '\0'] }).errors).toEqual({ members: "Le nom d'un artiste du collectif contient un caractère invalide." })
  })

  it('needs everything an artist needs, for an artist and for a collective', () => {
    expect(checkApplicant({ ...ARTIST, email: '' }).errors).toEqual({ email: 'Indiquez votre adresse e-mail.' })
    expect(checkApplicant({ ...COLLECTIVE, genres: [] }).errors).toEqual({ genres: 'Choisissez au moins un genre.' })
  })
})
