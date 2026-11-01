import { describe, expect, it } from 'vitest'
import { checkProfile, linkSite, parseLink, pickedPhotoError } from './artist-profile'
import type { Profile, LinkSiteId } from './artist-profile'

// The client's copy of the server's rules for profiles (see server/src/artists/profile.ts), which the forms check as
// the server does.

// What `checkProfile` returns of a valid profile, or throws the first error, as the server would answer.
function validateProfile(sent: unknown, options?: { lenient?: boolean }): Profile {
  const { profile, errors } = checkProfile(sent, options)
  if (errors) throw new Error(Object.values(errors)[0])
  return profile
}

function parse(id: LinkSiteId, raw: string) {
  return parseLink(linkSite(id)!, raw)
}

describe('parseLink', () => {
  it('reduces a full address to the profile name', () => {
    expect(parse('soundcloud', 'https://soundcloud.com/parkingdotradio')).toEqual({ value: 'parkingdotradio' })
    expect(parse('soundcloud', 'soundcloud.com/parkingdotradio/wobbla')).toEqual({ value: 'parkingdotradio' })
    expect(parse('soundcloud', 'm.soundcloud.com/djcoquin?utm_source=x')).toEqual({ value: 'djcoquin' })
    expect(parse('instagram', 'https://www.instagram.com/parking.radio/?hl=fr')).toEqual({ value: 'parking.radio' })
    expect(parse('bandcamp', 'https://hauterive.bandcamp.com/album/xyz')).toEqual({ value: 'hauterive' })
    expect(parse('bandcamp', 'hauterive.bandcamp.com')).toEqual({ value: 'hauterive' })
    expect(parse('mixcloud', 'https://www.mixcloud.com/djx/some-mix/')).toEqual({ value: 'djx' })
    expect(parse('ra', 'https://ra.co/dj/robinthepark')).toEqual({ value: 'robinthepark' })
    expect(parse('ra', 'https://www.residentadvisor.net/dj/robinthepark')).toEqual({ value: 'robinthepark' })
    expect(parse('youtube', 'https://www.youtube.com/@parkingradio')).toEqual({ value: 'parkingradio' })
    expect(parse('spotify', 'https://open.spotify.com/intl-fr/artist/4Z8W4fKeB5YxbusRsdQVPb?si=abc')).toEqual({
      value: '4Z8W4fKeB5YxbusRsdQVPb',
    })
    expect(parse('tiktok', 'https://www.tiktok.com/@some.user')).toEqual({ value: 'some.user' })
    expect(parse('spotify', 'open.spotify.com/intl-de/artist/4Z8W4fKeB5YxbusRsdQVPb')).toEqual({ value: '4Z8W4fKeB5YxbusRsdQVPb' })
    expect(parse('spotify', 'spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb')).toEqual({ value: '4Z8W4fKeB5YxbusRsdQVPb' })
    expect(parse('ra', 'ra.co/dj/robinthepark/biography')).toEqual({ value: 'robinthepark' })
  })

  it("refuses the addresses of the sites' own pages, e.g. a post or an event, rather than a profile", () => {
    const notAProfile = (id: LinkSiteId, raw: string) => parse(id, raw).error
    for (const raw of ['instagram.com/p/C8xYzAbCdEf/', 'https://www.instagram.com/reel/abc/', 'instagram.com/stories/x/1', 'instagram.com/explore']) {
      expect(notAProfile('instagram', raw)).toBe("copiez l'adresse de la page de profil, qui commence par instagram.com/")
    }
    for (const raw of ['soundcloud.com/discover', 'soundcloud.com/search?q=techno', 'soundcloud.com/you/library']) {
      expect(notAProfile('soundcloud', raw)).toContain('soundcloud.com/')
    }
    expect(notAProfile('mixcloud', 'mixcloud.com/discover/house/')).toContain('mixcloud.com/')
    expect(notAProfile('ra', 'ra.co/events/2012345')).toContain('ra.co/dj/')
    expect(notAProfile('ra', 'ra.co/promoters/183980')).toContain('ra.co/dj/')
    expect(notAProfile('spotify', 'open.spotify.com/album/4Z8W4fKeB5YxbusRsdQVPb')).toContain('spotify.com/artist/')
    for (const raw of ['https://www.bandcamp.com', 'daily.bandcamp.com/features/x', 'bandcamp.com/hauterive']) {
      expect(notAProfile('bandcamp', raw)).toBe("copiez l'adresse de la page de profil, qui finit par .bandcamp.com")
    }
    // Nor can they be typed as profile names.
    expect(notAProfile('instagram', 'p')).toBe("ce nom de profil Instagram n'est pas valide")
    expect(notAProfile('soundcloud', 'Discover')).toBe("ce nom de profil SoundCloud n'est pas valide")
    expect(notAProfile('bandcamp', 'daily')).toBe("ce nom de profil Bandcamp n'est pas valide")
  })

  it('takes a profile name as-is, with or without @, even when it contains dots', () => {
    expect(parse('soundcloud', 'parkingdotradio')).toEqual({ value: 'parkingdotradio' })
    expect(parse('instagram', '@parking.radio')).toEqual({ value: 'parking.radio' })
    expect(parse('instagram', 'parking.radio')).toEqual({ value: 'parking.radio' })
    expect(parse('youtube', '@parkingradio')).toEqual({ value: 'parkingradio' })
  })

  it("explains what's wrong", () => {
    expect(parse('soundcloud', 'https://instagram.com/foo').error).toBe("ce n'est pas une adresse SoundCloud")
    expect(parse('soundcloud', 'https://on.soundcloud.com/AbC12').error).toContain('lien court')
    expect(parse('soundcloud', 'soundcloud.com').error).toBe('il manque le nom de profil')
    expect(parse('instagram', 'bad name!').error).toBe("ce nom de profil Instagram n'est pas valide")
    expect(parse('youtube', 'https://www.youtube.com/channel/UCxyz').error).toContain('youtube.com/@')
    expect(parse('spotify', 'abc').error).toContain("n'est pas valide")
    expect(parse('soundcloud', 'soundcloud.com/%zz').error).toBe('adresse invalide')
    expect(parse('soundcloud', 'a'.repeat(201)).error).toBe('ça dépasse 200 caractères')
    expect(parse('soundcloud', `soundcloud.com/${'a'.repeat(200)}`)).toEqual({ value: 'a'.repeat(200) })
  })

  it('takes a full address for the website', () => {
    expect(parse('web', 'parking.radio')).toEqual({ value: 'https://parking.radio' })
    expect(parse('web', 'https://example.com/')).toEqual({ value: 'https://example.com' })
    expect(parse('web', 'pas une url').error).toBe('adresse invalide')
    for (const raw of ['https://soundcloud.com@example.com', 'http://user:pw@example.com', 'https://1', '192.168.0.1', 'https://[::1]']) {
      expect(parse('web', raw).error).toBe('adresse invalide')
    }
    expect(parse('web', `parking.radio/${'a'.repeat(200)}`).error).toBe('ça dépasse 200 caractères')
  })

  it('ignores an empty field', () => {
    expect(parse('soundcloud', '   ')).toEqual({})
  })
})

describe('checkProfile, as the server answers', () => {
  const valid = (): Profile => ({
    name: 'DJ Test',
    country: 'CA',
    city: 'Québec',
    genres: ['techno', 'acid'],
    bio: 'Une bio.',
    links: { soundcloud: 'https://soundcloud.com/parkingdotradio/wobbla', instagram: '@parking.radio' },
    email: 'artiste@example.com',
    phone: '418 555-0123',
  })
  // What's wrong with the valid profile with these changes.
  const error = (changes: Partial<Profile>, options?: { lenient?: boolean }) => {
    try {
      validateProfile({ ...valid(), ...changes }, options)
      return null
    } catch (thrown) {
      return (thrown as Error).message
    }
  }

  it('keeps fields that are a single line on a single line', () => {
    const profile = validateProfile({ ...valid(), name: 'DJ\n  Test', city: 'Québec\t(QC)', bio: 'Une\n\nbio.' })
    expect(profile).toMatchObject({ name: 'DJ Test', city: 'Québec (QC)', bio: 'Une\n\nbio.' })
  })

  it('returns what is saved of a valid profile, without what it does not have', () => {
    expect(validateProfile({ ...valid(), name: '  DJ Test ', city: ' Québec ', kind: 'collective', members: ['A'] })).toEqual({
      ...valid(),
      // Only the profile names are kept.
      links: { soundcloud: 'parkingdotradio', instagram: 'parking.radio' },
    })
  })

  it('needs a profile', () => {
    expect(() => validateProfile(undefined)).toThrow("Indiquez le nom d'artiste.")
    expect(() => validateProfile('DJ Test')).toThrow("Indiquez le nom d'artiste.")
  })

  it('needs a name', () => {
    expect(error({ name: ' ' })).toBe("Indiquez le nom d'artiste.")
    expect(error({ name: 'x'.repeat(101) })).toBe("Le nom d'artiste dépasse 100 caractères.")
  })

  it('takes at least one genre from the list, dropping duplicates', () => {
    expect(error({ genres: [] })).toBe('Choisissez au moins un genre.')
    expect(error({ genres: ['techno', 'acid', 'house', 'disco'] })).toBeNull()
    expect(error({ genres: ['polka' as never] })).toBe("Un des genres n'est pas dans la liste.")
    // Only their ids, not their names.
    expect(error({ genres: ['électro' as never] })).toBe("Un des genres n'est pas dans la liste.")
    expect(error({ genres: ['electro', 'drum-and-bass'] })).toBeNull()
    expect(validateProfile({ ...valid(), genres: ['acid', 'techno', 'acid'] }).genres).toEqual(['acid', 'techno'])
  })

  it('checks the country, and that there is a city', () => {
    expect(error({ country: 'XX' as never })).toBe('Choisissez le pays.')
    expect(error({ city: '  ' })).toBe('Indiquez la ville.')
    expect(error({ city: undefined })).toBe('Indiquez la ville.')
    expect(error({ city: { name: 'Québec' } as never })).toBe('Indiquez la ville.')
    expect(error({ city: 'x'.repeat(101) })).toBe('La ville dépasse 100 caractères.')
  })

  it('needs a bio', () => {
    expect(error({ bio: '' })).toBe('Écrivez quelques lignes de bio.')
    expect(error({ bio: undefined })).toBe('Écrivez quelques lignes de bio.')
    expect(error({ bio: 'x'.repeat(5000) })).toBeNull()
    expect(error({ bio: 'x'.repeat(5001) })).toBe('La bio dépasse 5000 caractères.')
  })

  it('needs at least one valid link', () => {
    expect(error({ links: {} })).toBe('Ajoutez au moins un lien.')
    expect(error({ links: { soundcloud: '' } })).toBe('Ajoutez au moins un lien.')
    expect(error({ links: { web: 'parking.radio' } })).toBeNull()
    expect(error({ links: { myspace: 'foo' } as never })).toBe('Un des liens est invalide.')
    expect(error({ links: { soundcloud: 42 } as never })).toBe('Un des liens est invalide.')
    expect(error({ links: { soundcloud: 'https://instagram.com/foo' } })).toBe("SoundCloud : ce n'est pas une adresse SoundCloud.")
    // With several, the first in the order of the sites, then links to other sites, like the server.
    expect(error({ links: { instagram: 'bad name!', soundcloud: 'https://instagram.com/foo' } as never })).toBe("SoundCloud : ce n'est pas une adresse SoundCloud.")
    expect(error({ links: { myspace: 'x', soundcloud: 'https://instagram.com/foo' } as never })).toBe("SoundCloud : ce n'est pas une adresse SoundCloud.")
    expect(error({ links: { myspace: 'x', tiktok: 'x' } as never })).toBe("TikTok : ce nom de profil TikTok n'est pas valide.")
  })

  it('checks the email address and phone number', () => {
    expect(error({ email: ' ' })).toBe('Indiquez votre adresse e-mail.')
    expect(error({ email: null })).toBe('Indiquez votre adresse e-mail.')
    expect(error({ email: 'pas-une-adresse' })).toBe('Indiquez une adresse e-mail valide.')
    // Addresses with a name, or several of them, which would send emails to someone else too.
    for (const email of ['Nom <artiste@example.com>', 'artiste@example.com, autre@example.com', 'a"b@example.com', 'a@example.com;b@example.com']) {
      expect(error({ email })).toBe('Indiquez une adresse e-mail valide.')
    }
    expect(error({ email: 'prénom.nom+radio@example.co.uk' })).toBeNull()
    expect(error({ phone: '123' })).toBe('Indiquez un numéro de téléphone valide.')
    expect(error({ email: `${'a'.repeat(190)}@example.com` })).toBe("L'adresse e-mail dépasse 200 caractères.")
    expect(error({ phone: '1'.repeat(41) })).toBe('Le numéro de téléphone dépasse 40 caractères.')
  })

  it('refuses text with the NUL character, which the server refuses, before checking its length', () => {
    expect(error({ name: 'A\0' })).toBe("Le nom d'artiste contient un caractère invalide.")
    expect(error({ bio: `\0${'x'.repeat(5001)}` })).toBe('La bio contient un caractère invalide.')
  })

  describe('leniently', () => {
    const LENIENT = { lenient: true }
    // What admins can leave out, as it's saved when they do.
    const LEFT_OUT: Partial<Profile> = { country: '', city: '', genres: [], bio: '', links: {}, email: null, phone: '' }

    it('takes a profile without a country, city, genres, bio, links, email or phone', () => {
      const blank = { ...LEFT_OUT, country: ' ', city: ' ', bio: ' \n ', email: ' ', phone: ' ' }
      expect(validateProfile({ ...valid(), ...blank }, LENIENT)).toEqual({ ...valid(), ...LEFT_OUT })
      // Left out entirely, or null, as well as empty.
      const leftOut = { country: undefined, city: undefined, genres: undefined, bio: undefined, links: undefined, email: undefined, phone: undefined }
      expect(validateProfile({ ...valid(), ...leftOut }, LENIENT)).toEqual({ ...valid(), ...LEFT_OUT })
      const nulls = { country: null, city: null, genres: null, bio: null, links: null, email: null, phone: null }
      expect(validateProfile({ ...valid(), ...nulls } as never, LENIENT)).toEqual({ ...valid(), ...LEFT_OUT })
      expect(validateProfile({ ...valid(), links: { soundcloud: '' } }, LENIENT).links).toEqual({})
    })

    it('still checks what is there', () => {
      expect(error({ country: 'XX' as never }, LENIENT)).toBe('Choisissez le pays.')
      expect(error({ country: 42 as never }, LENIENT)).toBe('Choisissez le pays.')
      expect(error({ city: 'x'.repeat(101) }, LENIENT)).toBe('La ville dépasse 100 caractères.')
      expect(error({ genres: ['polka' as never] }, LENIENT)).toBe("Un des genres n'est pas dans la liste.")
      expect(error({ links: { soundcloud: 'https://instagram.com/foo' } }, LENIENT)).toBe("SoundCloud : ce n'est pas une adresse SoundCloud.")
      expect(error({ phone: '123' }, LENIENT)).toBe('Indiquez un numéro de téléphone valide.')
      expect(error({ bio: 'x'.repeat(5001) }, LENIENT)).toBe('La bio dépasse 5000 caractères.')
      expect(error({ email: 'pas-une-adresse' }, LENIENT)).toBe('Indiquez une adresse e-mail valide.')
      expect(error({ email: `${'a'.repeat(190)}@example.com` }, LENIENT)).toBe("L'adresse e-mail dépasse 200 caractères.")
      expect(validateProfile({ ...valid(), email: ' artiste@example.com ' }, LENIENT).email).toBe('artiste@example.com')
    })

    it('does not take a field of another type for one that is left out, which would lose it', () => {
      expect(error({ city: 42 as never }, LENIENT)).toBe('Indiquez la ville.')
      expect(error({ genres: 'techno' as never }, LENIENT)).toBe('Choisissez au moins un genre.')
      expect(error({ links: '@parking.radio' as never }, LENIENT)).toBe('Ajoutez au moins un lien.')
      expect(error({ phone: 4185550123 as never }, LENIENT)).toBe('Indiquez votre numéro de téléphone.')
      expect(error({ bio: ['Une bio.'] as never }, LENIENT)).toBe('Écrivez quelques lignes de bio.')
      expect(error({ email: 42 as never }, LENIENT)).toBe('Indiquez votre adresse e-mail.')
    })

    it('still needs everything else', () => {
      expect(error({ name: '' }, LENIENT)).toBe("Indiquez le nom d'artiste.")
    })
  })
})

describe('checkProfile, for forms', () => {
  it('says what is wrong with every field that is wrong, for forms to show each error by its field', () => {
    expect(checkProfile({ country: 'ZZ', genres: [], links: { soundcloud: 'https://soundcloud.com' }, email: 'x', phone: '' })).toEqual({
      errors: {
        name: "Indiquez le nom d'artiste.",
        country: 'Choisissez le pays.',
        city: 'Indiquez la ville.',
        genres: 'Choisissez au moins un genre.',
        bio: 'Écrivez quelques lignes de bio.',
        links: 'SoundCloud : il manque le nom de profil.',
        email: 'Indiquez une adresse e-mail valide.',
        phone: 'Indiquez votre numéro de téléphone.',
      },
    })
  })

  it('returns the profile without errors when it is valid', () => {
    const { profile, errors } = checkProfile({
      name: 'DJ Test',
      country: 'CA',
      city: 'Québec',
      genres: ['techno'],
      bio: 'Une bio.',
      links: { instagram: '@parking.radio', web: '' },
      email: 'artiste@example.com',
      phone: '418 555-0123',
    })
    expect(errors).toBeUndefined()
    expect(profile).toMatchObject({ links: { instagram: 'parking.radio' } })
  })
})

describe('pickedPhotoError', () => {
  const file = (type: string, size: number) => new File([new Uint8Array(size)], 'photo', { type })

  it('takes a JPEG, PNG or WebP photo up to the size limit, or no photo', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(pickedPhotoError(file(type, 10 * 1024 * 1024))).toBeNull()
    expect(pickedPhotoError(null)).toBeNull()
    expect(pickedPhotoError(file('image/gif', 1))).toBe('La photo doit être en JPEG, PNG ou WebP.')
    expect(pickedPhotoError(file('image/png', 10 * 1024 * 1024 + 1))).toBe('La photo dépasse 10 Mo.')
  })

  it('only checks the size of a photo whose type the browser does not know, which the server tells from its contents', () => {
    expect(pickedPhotoError(file('', 1))).toBeNull()
    expect(pickedPhotoError(file('', 10 * 1024 * 1024 + 1))).toBe('La photo dépasse 10 Mo.')
  })
})
