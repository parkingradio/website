import { describe, expect, it } from 'vitest'
import { checkCollectiveProfile } from './collective-profile'
import type { CollectiveProfile } from './collective-profile'

// The client's copy of the server's rules for collectives' profiles (see server/src/collectives/profile.ts), which the
// admin form checks as the server does.

const valid = (): CollectiveProfile => ({
  name: 'Ondes',
  members: [{ id: 'artist-1' }, { name: 'Élise' }],
  country: 'CA',
  city: 'Québec',
  description: 'Une description.',
  links: { instagram: '@ondes.qc' },
  email: 'ondes@example.com',
  phone: '418 555-0123',
})

// What's wrong with the valid profile with these changes, first, as the server would answer, or null if nothing is.
function error(changes: Record<string, unknown>): string | null {
  const { errors } = checkCollectiveProfile({ ...valid(), ...changes })
  return errors ? Object.values(errors)[0]! : null
}

describe('checkCollectiveProfile, as the server answers', () => {
  it('returns what is saved of a valid profile', () => {
    expect(checkCollectiveProfile({ ...valid(), name: ' Ondes\n2 ', description: ' Une\n\ndescription. ' }).profile).toEqual({
      ...valid(),
      name: 'Ondes 2',
      description: 'Une\n\ndescription.',
      links: { instagram: 'ondes.qc' },
    })
  })

  it('takes its members by id, or new ones by name, and drops an id that is there twice', () => {
    const members = [{ id: 'artist-1', name: 'Aurore' }, { name: '  Élise\tB ' }, { id: 'artist-1' }, { name: 'Élise B' }]
    expect(checkCollectiveProfile({ ...valid(), members }).profile?.members).toEqual([{ id: 'artist-1' }, { name: 'Élise B' }, { name: 'Élise B' }])
  })

  it('needs at least one member, each with an id or a name', () => {
    expect(error({ members: [] })).toBe('Indiquez au moins un artiste du collectif.')
    expect(error({ members: 'Élise' })).toBe('Indiquez au moins un artiste du collectif.')
    expect(error({ members: [{ name: ' ' }] })).toBe('Indiquez le nom de chaque artiste du collectif.')
    expect(error({ members: [{}] })).toBe('Indiquez le nom de chaque artiste du collectif.')
    expect(error({ members: [{ name: 'x'.repeat(101) }] })).toBe("Le nom d'un artiste du collectif dépasse 100 caractères.")
    expect(error({ members: [{ id: 3 }] })).toBe('No such artist')
  })

  it('needs a name', () => {
    expect(error({ name: ' ' })).toBe('Indiquez le nom du collectif.')
  })

  it('takes a profile without a country, city, description, links, email or phone', () => {
    const leftOut = { country: '', city: '', description: '', links: {}, email: null, phone: '' }
    expect(checkCollectiveProfile({ ...valid(), ...leftOut }).profile).toEqual({ ...valid(), ...leftOut })
    expect(checkCollectiveProfile({ ...valid(), ...leftOut, email: ' ' }).profile).toEqual({ ...valid(), ...leftOut })
    const minimal = { name: 'Ondes', members: [{ name: 'Élise' }] }
    expect(checkCollectiveProfile(minimal).profile).toEqual({ ...minimal, ...leftOut })
  })

  it('still checks what is there, with the description’s own messages', () => {
    expect(error({ country: 'XX' })).toBe('Choisissez le pays.')
    expect(error({ description: 'x'.repeat(5001) })).toBe('La description dépasse 5000 caractères.')
    expect(error({ description: 'a\0' })).toBe('La description contient un caractère invalide.')
    expect(error({ links: { soundcloud: 'https://instagram.com/ondes' } })).toBe("SoundCloud : ce n'est pas une adresse SoundCloud.")
    expect(error({ phone: '123' })).toBe('Indiquez un numéro de téléphone valide.')
    expect(error({ email: 'ondes@' })).toBe('Indiquez une adresse e-mail valide.')
    expect(error({ email: `${'a'.repeat(190)}@example.com` })).toBe("L'adresse e-mail dépasse 200 caractères.")
    expect(error({ email: 42 })).toBe('Indiquez votre adresse e-mail.')
    expect(checkCollectiveProfile({ ...valid(), email: ' ondes@example.com ' }).profile?.email).toBe('ondes@example.com')
  })

  it('says what is wrong with every field that is wrong, in the order the server checks them', () => {
    expect(Object.entries(checkCollectiveProfile({ members: [], email: 'x', phone: '1' }).errors ?? {})).toEqual([
      ['name', 'Indiquez le nom du collectif.'],
      ['members', 'Indiquez au moins un artiste du collectif.'],
      ['email', 'Indiquez une adresse e-mail valide.'],
      ['phone', 'Indiquez un numéro de téléphone valide.'],
    ])
  })
})
