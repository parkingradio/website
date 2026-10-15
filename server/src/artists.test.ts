import { describe, expect, it, vi } from 'vitest'
import { checkProfile, linkSite, parseLink, photoError } from 'shared/artists'
import type { ArtistProfile, LinkSiteId } from 'shared/artists'
import { artistPhotos, validatePhoto, validateProfile } from './artists.js'
import type { PrivateFiles } from './private-bucket.js'

// The rules in shared/src/artists.ts, which every artist's profile has to follow.

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
      expect(notAProfile('instagram', raw)).toBe("copiez l'adresse de votre page de profil, qui commence par instagram.com/")
    }
    for (const raw of ['soundcloud.com/discover', 'soundcloud.com/search?q=techno', 'soundcloud.com/you/library']) {
      expect(notAProfile('soundcloud', raw)).toContain('soundcloud.com/')
    }
    expect(notAProfile('mixcloud', 'mixcloud.com/discover/house/')).toContain('mixcloud.com/')
    expect(notAProfile('ra', 'ra.co/events/2012345')).toContain('ra.co/dj/')
    expect(notAProfile('ra', 'ra.co/promoters/183980')).toContain('ra.co/dj/')
    expect(notAProfile('spotify', 'open.spotify.com/album/4Z8W4fKeB5YxbusRsdQVPb')).toContain('spotify.com/artist/')
    for (const raw of ['https://www.bandcamp.com', 'daily.bandcamp.com/features/x', 'bandcamp.com/hauterive']) {
      expect(notAProfile('bandcamp', raw)).toBe("copiez l'adresse de votre page de profil, qui finit par .bandcamp.com")
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
    expect(parse('soundcloud', 'soundcloud.com').error).toBe('il manque votre nom de profil')
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

describe('validateProfile', () => {
  const valid = (): ArtistProfile => ({
    kind: 'artist',
    name: 'DJ Test',
    members: [],
    country: 'CA',
    city: 'Québec',
    genres: ['techno', 'acid'],
    bio: 'Une bio.',
    links: { soundcloud: 'https://soundcloud.com/parkingdotradio/wobbla', instagram: '@parking.radio' },
    email: 'artiste@example.com',
    phone: '418 555-0123',
  })
  // What's wrong with the valid profile with these changes.
  const error = (changes: Partial<ArtistProfile>) => {
    try {
      validateProfile({ ...valid(), ...changes })
      return null
    } catch (thrown) {
      return (thrown as Error).message
    }
  }

  it('keeps fields that are a single line on a single line', () => {
    const profile = validateProfile({ ...valid(), kind: 'collective', name: 'DJ\n  Test', members: ['Zefra\r\nMlle Zed'], city: 'Québec\t(QC)', bio: 'Une\n\nbio.' })
    expect(profile).toMatchObject({ name: 'DJ Test', members: ['Zefra Mlle Zed'], city: 'Québec (QC)', bio: 'Une\n\nbio.' })
  })

  it('returns what is saved of a valid profile', () => {
    expect(validateProfile({ ...valid(), name: '  DJ Test ', city: ' Québec ' })).toEqual({
      ...valid(),
      // Only the profile names are kept.
      links: { soundcloud: 'parkingdotradio', instagram: 'parking.radio' },
    })
  })

  it('needs a profile', () => {
    expect(() => validateProfile(undefined)).toThrow('comme artiste ou comme collectif')
    expect(() => validateProfile('DJ Test')).toThrow('comme artiste ou comme collectif')
  })

  it('needs to know whether it is an artist or a collective, and a collective needs at least one artist', () => {
    expect(error({ kind: undefined })).toContain('comme artiste ou comme collectif')
    expect(error({ kind: 'duo' as never })).toContain('comme artiste ou comme collectif')
    expect(error({ kind: 'collective', members: [] })).toBe('Indiquez au moins un artiste du collectif.')
    expect(error({ kind: 'collective', members: ['  '] })).toBe('Indiquez au moins un artiste du collectif.')
    expect(error({ kind: 'collective', members: ['A', 'B', 'C', 'D', 'E'] })).toBeNull()
    // Blank entries and duplicates are dropped, and an artist's members are ignored.
    expect(validateProfile({ ...valid(), kind: 'collective', members: ['Zefra', ' Mlle Zed ', '', 'zefra'] }).members).toEqual(['Zefra', 'Mlle Zed'])
    expect(validateProfile({ ...valid(), kind: 'artist', members: ['A'] }).members).toEqual([])
  })

  it('needs a name', () => {
    expect(error({ name: ' ' })).toBe("Indiquez votre nom d'artiste.")
    expect(error({ kind: 'collective', members: ['A'], name: '' })).toBe('Indiquez le nom du collectif.')
    expect(error({ name: 'x'.repeat(101) })).toBe("Le nom d'artiste dépasse 100 caractères.")
    expect(error({ kind: 'collective', members: ['x'.repeat(101)] })).toBe("Le nom d'un artiste du collectif dépasse 100 caractères.")
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
    expect(error({ country: 'XX' })).toBe('Choisissez votre pays.')
    expect(error({ city: '  ' })).toBe('Indiquez votre ville.')
    expect(error({ city: undefined })).toBe('Indiquez votre ville.')
    expect(error({ city: { name: 'Québec' } as never })).toBe('Indiquez votre ville.')
    expect(error({ city: 'x'.repeat(101) })).toBe('La ville dépasse 100 caractères.')
  })

  it('needs a bio', () => {
    expect(error({ bio: '' })).toBe('Écrivez quelques lignes de bio.')
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
  })

  it('checks the email address and phone number', () => {
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
})

describe('checkProfile', () => {
  it('says what is wrong with every field that is wrong, for forms to show each error by its field', () => {
    expect(checkProfile({ kind: 'collective', members: ['  '], country: 'ZZ', genres: [], links: { soundcloud: 'https://soundcloud.com' }, email: 'x', phone: '' })).toEqual({
      errors: {
        name: 'Indiquez le nom du collectif.',
        members: 'Indiquez au moins un artiste du collectif.',
        country: 'Choisissez votre pays.',
        city: 'Indiquez votre ville.',
        genres: 'Choisissez au moins un genre.',
        bio: 'Écrivez quelques lignes de bio.',
        links: 'SoundCloud : il manque votre nom de profil.',
        email: 'Indiquez une adresse e-mail valide.',
        phone: 'Indiquez votre numéro de téléphone.',
      },
    })
  })

  it('returns the profile without errors when it is valid', () => {
    const { profile, errors } = checkProfile({
      kind: 'artist',
      name: 'DJ Test',
      members: ['ignored'],
      country: 'CA',
      city: 'Québec',
      genres: ['techno'],
      bio: 'Une bio.',
      links: { instagram: '@parking.radio', web: '' },
      email: 'artiste@example.com',
      phone: '418 555-0123',
    })
    expect(errors).toBeUndefined()
    expect(profile).toMatchObject({ members: [], links: { instagram: 'parking.radio' } })
  })
})

describe('photoError', () => {
  it('takes a JPEG, PNG or WebP photo up to the size limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(photoError({ type, size: 10 * 1024 * 1024 })).toBeNull()
    expect(photoError({ type: 'image/gif', size: 1 })).toBe('La photo doit être en JPEG, PNG ou WebP.')
    expect(photoError({ type: 'image/png', size: 10 * 1024 * 1024 + 1 })).toBe('La photo dépasse 10 Mo.')
  })
})

describe('validatePhoto', () => {
  it('tells the type of a JPEG, PNG or WebP image from its contents', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    expect(validatePhoto(jpeg)).toEqual({ body: jpeg, type: 'image/jpeg' })
    expect(validatePhoto(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))!.type).toBe('image/png')
    expect(validatePhoto(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))!.type).toBe('image/webp')
  })

  it('refuses anything else', () => {
    expect(() => validatePhoto(Buffer.from('%PDF-1.7'))).toThrow('La photo doit être en JPEG, PNG ou WebP.')
    expect(() => validatePhoto(Buffer.alloc(0))).toThrow('La photo doit être en JPEG, PNG ou WebP.')
  })

  it('returns null when there is no photo, which is fine', () => {
    expect(validatePhoto(undefined)).toBeNull()
  })
})

describe('artistPhotos', () => {
  const files = { put: vi.fn<PrivateFiles['put']>(), read: vi.fn<PrivateFiles['read']>(), delete: vi.fn<PrivateFiles['delete']>() }

  it('stores each photo under a new key in artists/, with its type', async () => {
    const photos = artistPhotos(files)
    const body = Buffer.from('photo')
    const first = await photos.store({ body, type: 'image/png' })
    const second = await photos.store({ body, type: 'image/webp' })
    expect(first).toMatch(/^artists\/[0-9a-f-]{36}\.png$/)
    expect(second).toMatch(/^artists\/[0-9a-f-]{36}\.webp$/)
    expect(files.put).toHaveBeenCalledWith(first, body, 'image/png')
    expect(files.put).toHaveBeenCalledWith(second, body, 'image/webp')
  })
})
