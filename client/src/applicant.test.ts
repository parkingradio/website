import { describe, expect, it } from 'vitest'
import { checkApplicant, checkApplicantMember } from './applicant'

// The client's copy of the server's rules for who applies (see server/src/applications/applicant.ts). The fields an artist
// alone has are checked like an artist's profile (see artist-profile.test.ts).

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
const MEMBER = { name: 'Une', country: 'FR', city: 'Lyon', genres: ['house'], bio: 'Sa bio.', links: { soundcloud: 'https://soundcloud.com/une/sets/x' } }
const COLLECTIVE = {
  kind: 'collective',
  name: 'Le Collectif',
  country: 'CA',
  city: 'Québec',
  description: 'Une description.',
  links: { instagram: '@le.collectif' },
  email: 'collectif@example.com',
  phone: '418 555-0123',
  members: [MEMBER, { ...MEMBER, name: 'Deux' }],
}

describe('checkApplicant', () => {
  it('returns an artist without what they have no use for, and a collective with its artists, cleaned up', () => {
    expect(checkApplicant({ ...ARTIST, members: ['Une'] })).toEqual({ applicant: { ...ARTIST, links: { instagram: 'parking.radio' } } })
    const member = { ...MEMBER, links: { soundcloud: 'une' } }
    expect(checkApplicant({ ...COLLECTIVE, genres: ['house'], bio: 'Une bio.' })).toEqual({
      applicant: { ...COLLECTIVE, links: { instagram: 'le.collectif' }, members: [member, { ...member, name: 'Deux' }] },
    })
  })

  it('needs to know whether it is an artist or a collective, and checks it as an artist until then', () => {
    for (const kind of [undefined, 'duo']) {
      expect(checkApplicant({ ...ARTIST, kind }).errors).toEqual({ kind: 'Indiquez si vous postulez comme artiste ou comme collectif.' })
    }
    expect(checkApplicant({ kind: 'duo', name: 'DJ Test' }).errors).toMatchObject({ country: 'Choisissez le pays.', kind: expect.any(String) })
  })

  it("says what is wrong with a collective's own profile, which can't leave anything out", () => {
    expect(checkApplicant({ ...COLLECTIVE, name: '', country: '', city: '', description: ' ', links: {}, email: '', phone: '' }).errors).toEqual({
      name: 'Indiquez le nom du collectif.',
      country: 'Choisissez le pays.',
      city: 'Indiquez la ville.',
      description: 'Écrivez quelques lignes de description.',
      links: 'Ajoutez au moins un lien.',
      email: 'Indiquez votre adresse e-mail.',
      phone: 'Indiquez votre numéro de téléphone.',
    })
    expect(checkApplicant({ ...COLLECTIVE, members: [] })).toEqual({ errors: { members: 'Indiquez au moins un artiste du collectif.' }, memberErrors: [] })
  })

  it('says what is wrong with each of its artists, by field', () => {
    const { errors, memberErrors } = checkApplicant({ ...COLLECTIVE, members: [MEMBER, { ...MEMBER, city: ' ', genres: [] }, 'Trois'] })
    expect(errors).toEqual({})
    expect(memberErrors).toEqual([
      {},
      { city: 'Indiquez la ville.', genres: 'Choisissez au moins un genre.' },
      {
        name: "Indiquez le nom d'artiste.",
        country: 'Choisissez le pays.',
        city: 'Indiquez la ville.',
        genres: 'Choisissez au moins un genre.',
        bio: 'Écrivez quelques lignes de bio.',
        links: 'Ajoutez au moins un lien.',
      },
    ])
  })
})

describe('checkApplicantMember', () => {
  it("checks an artist of a collective like an artist alone, without an email or a phone", () => {
    expect(checkApplicantMember({ ...MEMBER, email: 'x', phone: 'y' })).toEqual({ member: { ...MEMBER, links: { soundcloud: 'une' } } })
    expect(checkApplicantMember({ ...MEMBER, links: { soundcloud: 'https://instagram.com/une' } }).errors).toEqual({
      links: "SoundCloud : ce n'est pas une adresse SoundCloud.",
    })
  })
})
