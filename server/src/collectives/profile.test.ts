import { describe, expect, it } from 'vitest'
import { AdminCollectiveProfile, COLLECTIVE_AS_MEMBER, NO_SUCH_MEMBER } from './profile.js'

// The rules in collectives/profile.ts, which every collective's profile has to follow. The server answers with the first
// error. The rules it shares with artists' profiles are tested with them (see artists/store.test.ts).

const ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

function valid(): Record<string, unknown> {
  return {
    name: 'Les Ondes',
    members: [{ id: ID }],
    country: 'CA',
    city: 'Québec',
    description: 'Une description.',
    links: { soundcloud: 'https://soundcloud.com/lesondes' },
    email: 'contact@example.com',
    phone: '418 555-0123',
  }
}

function parse(changes: Record<string, unknown>) {
  return AdminCollectiveProfile.safeParse({ ...valid(), ...changes })
}

function error(changes: Record<string, unknown>) {
  const result = parse(changes)
  return result.success ? undefined : result.error.issues[0].message
}

describe('AdminCollectiveProfile', () => {
  it('returns what is saved of a valid profile', () => {
    expect(parse({ name: ' Les\n Ondes ', description: ' Une\n\ndescription. ' }).data).toEqual({
      ...valid(),
      name: 'Les Ondes',
      description: 'Une\n\ndescription.',
      links: { soundcloud: 'lesondes' },
    })
  })

  it('takes a profile without a country, city, description, links or phone, as for an artist', () => {
    const leftOut = { country: '', city: '', description: '', links: {}, phone: '' }
    expect(parse(leftOut).data).toMatchObject(leftOut)
    expect(parse({ country: null, city: undefined, description: ' ', links: null, phone: ' ' }).data).toMatchObject(leftOut)
  })

  it('still needs a name and the email of the contact, which it checks like an artist\'s', () => {
    expect(error({ name: ' ' })).toBe('Indiquez le nom du collectif.')
    expect(error({ name: 'x'.repeat(101) })).toBe('Le nom du collectif dépasse 100 caractères.')
    for (const email of ['', ' ', null, undefined]) expect(error({ email })).toBe('Indiquez votre adresse e-mail.')
    expect(error({ email: 'Nom <contact@example.com>' })).toBe('Indiquez une adresse e-mail valide.')
  })

  it('checks the description like a bio', () => {
    expect(error({ description: 'x'.repeat(5001) })).toBe('La description dépasse 5000 caractères.')
    expect(error({ description: 'a\0b' })).toBe('La description contient un caractère invalide.')
    expect(error({ description: 42 })).toBe('Écrivez quelques lignes de description.')
  })

  describe('members', () => {
    const members = (sent: unknown) => parse({ members: sent }).data?.members

    it('takes artists who exist, by id, and artists to create, by name, in order', () => {
      expect(members([{ name: ' Ana\n B ' }, { id: ID }, { name: 'Brume' }])).toEqual([{ name: 'Ana B' }, { id: ID }, { name: 'Brume' }])
    })

    it('needs at least one', () => {
      for (const sent of [[], undefined, null, 'Ana', {}, 42]) expect(error({ members: sent })).toBe('Indiquez au moins un artiste du collectif.')
    })

    it('drops an id that is there twice, keeping the first, but not two artists to create with the same name', () => {
      expect(members([{ id: ID }, { id: OTHER_ID }, { id: ID }])).toEqual([{ id: ID }, { id: OTHER_ID }])
      expect(members([{ name: 'Ana' }, { name: 'Ana' }])).toEqual([{ name: 'Ana' }, { name: 'Ana' }])
    })

    it('ignores other fields, so that members can be sent back as they are returned, where the id is what counts', () => {
      expect(members([{ id: ID, name: 'Ana', kind: 'artist' }])).toEqual([{ id: ID }])
      expect(members([{ id: ID, name: 42 }])).toEqual([{ id: ID }])
    })

    it('refuses an id that is not a string, in English, like an artist who does not exist', () => {
      for (const id of [42, null, {}, ['x']]) expect(error({ members: [{ id }] })).toBe(NO_SUCH_MEMBER)
      expect(error({ members: [{ id: 42, name: 'Ana' }] })).toBe(NO_SUCH_MEMBER)
      expect(NO_SUCH_MEMBER).toBe('No such artist')
      expect(COLLECTIVE_AS_MEMBER).toBe("A collective can't be a member of a collective")
    })

    it('checks the name of an artist to create like an artist\'s, in French', () => {
      for (const name of ['', ' ', 42, null]) expect(error({ members: [{ name }] })).toBe('Indiquez le nom de chaque artiste du collectif.')
      for (const member of [{}, 'Ana', 42, null]) expect(error({ members: [member] })).toBe('Indiquez le nom de chaque artiste du collectif.')
      expect(error({ members: [{ name: 'x'.repeat(101) }] })).toBe("Le nom d'un artiste du collectif dépasse 100 caractères.")
    })
  })
})
