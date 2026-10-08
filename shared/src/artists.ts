// Artists: who they are, where they're from, where to hear them and how to reach them. An artist is known by their
// email address, whatever its case, and describes themselves in their profile, along with a photo. The lists and rules
// below are the ones every profile has to follow, and the server checks each profile against them. The server explains
// what's wrong with a profile in French, because artists will see its messages.

import { checkLine, checkText } from './checks.ts'
import type { Checked, FieldErrors } from './checks.ts'

export type ArtistProfile = {
  kind: ArtistKind
  // The artist's name, or the collective's, up to NAME_MAX_LENGTH characters.
  name: string
  // For a collective: the names of the artists representing it, at least one, each up to NAME_MAX_LENGTH characters.
  // Empty for an artist.
  members: string[]
  // One of COUNTRIES.
  country: string
  // As the artist wrote it, up to CITY_MAX_LENGTH characters.
  city: string
  // The ids of at least one of GENRES, most important first.
  genres: GenreId[]
  // Up to BIO_MAX_LENGTH characters.
  bio: string
  // By site, the profile name, or the full URL for "web", as `parseLink` returns it, up to LINK_MAX_LENGTH
  // characters. At least one.
  links: Partial<Record<LinkSiteId, string>>
  // What the artist is known by, whatever its case, up to EMAIL_MAX_LENGTH characters. See `isEmailAddress`.
  email: string
  // Up to PHONE_MAX_LENGTH characters. See `isPhoneNumber`.
  phone: string
}

// An artist usually gets an hour of a time slot in the radio's schedule, and a collective a whole slot.
export const ARTIST_KINDS = ['artist', 'collective'] as const
export type ArtistKind = (typeof ARTIST_KINDS)[number]

export const NAME_MAX_LENGTH = 100
export const CITY_MAX_LENGTH = 100
export const BIO_MAX_LENGTH = 1500
export const EMAIL_MAX_LENGTH = 200
export const PHONE_MAX_LENGTH = 40
export const LINK_MAX_LENGTH = 200

// The photo is sent as a file, next to the profile: a JPEG, PNG or WebP image of up to PHOTO_MAX_BYTES.
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024

// An artist, as the admin pages see them. Their photo is at `GET /api/admin/artists/:id/photo`.
export type Artist = ArtistProfile & {
  id: string
  // When the artist was added (ISO 8601), and the email of the admin who added them, or null when they added
  // themselves, by applying.
  createdAt: string
  createdBy: string | null
  // The email of the admin who last changed the artist, and when (ISO 8601). Null until then.
  updatedBy: string | null
  updatedAt: string | null
}

// `GET /api/admin/artists`: every artist, by name. Requires a session: fails with 401 without a valid one.
export type ArtistsResponse = { ok: true; artists: Artist[] }

// `GET /api/admin/artists/:id`: an artist. Requires a session. Fails with 401 (no valid session) or 404 (no such
// artist). Their photo is at `GET /api/admin/artists/:id/photo`, which fails the same way.
export type ArtistResponse = { ok: true; artist: Artist }

// `POST /api/admin/artists`: adds an artist, and returns them. A multipart/form-data request with two parts,
// "artist" (an `ArtistProfile`, as JSON, in a field rather than a file) and "photo" (see PHOTO_MAX_BYTES). Requires
// a session. Fails with 400 (an invalid profile or photo, with a message in French), 401 (no valid session), 409 (an
// artist with that email already exists) or 413 (photo too large).
//
// `PUT /api/admin/artists/:id`: replaces an artist's profile, and returns them. The same request, where the photo
// is optional: without one, the artist keeps theirs. Fails like `POST /api/admin/artists`, and with 404 (no such
// artist).
export type ArtistRequest = ArtistProfile

// `DELETE /api/admin/artists/:id`: deletes an artist, their photo and their applications. Requires a session. Fails
// with 401 (no valid session) or 404 (no such artist).
export type DeleteArtistResponse = { ok: true }

// ISO 3166-1 alpha-2 codes, and XK, which ISO hasn't assigned but is used for Kosovo. `Intl.DisplayNames` gives
// their names.
export const COUNTRIES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY ' +
  'BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK ' +
  'FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR ' +
  'IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ' +
  'ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM ' +
  'PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF ' +
  'TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ')

// The genres an artist can pick from, with their names in French. What's stored is their id, which doesn't change, so
// that their names can, e.g. to be translated.
export const GENRES = [
  { id: 'house', name: 'house' },
  { id: 'deep-house', name: 'deep house' },
  { id: 'tech-house', name: 'tech house' },
  { id: 'afro-house', name: 'afro house' },
  { id: 'amapiano', name: 'amapiano' },
  { id: 'disco', name: 'disco' },
  { id: 'nu-disco', name: 'nu-disco' },
  { id: 'italo', name: 'italo' },
  { id: 'techno', name: 'techno' },
  { id: 'hard-techno', name: 'hard techno' },
  { id: 'minimal', name: 'minimal' },
  { id: 'acid', name: 'acid' },
  { id: 'electro', name: 'électro' },
  { id: 'trance', name: 'trance' },
  { id: 'ebm-industrial', name: 'EBM / industriel' },
  { id: 'drum-and-bass', name: 'drum & bass' },
  { id: 'jungle', name: 'jungle' },
  { id: 'breakbeat', name: 'breakbeat' },
  { id: 'uk-garage', name: 'UK garage' },
  { id: 'dubstep', name: 'dubstep' },
  { id: 'bass', name: 'bass' },
  { id: 'footwork-juke', name: 'footwork / juke' },
  { id: 'baile-funk', name: 'baile funk' },
  { id: 'hip-hop', name: 'hip-hop' },
  { id: 'rap', name: 'rap' },
  { id: 'trap', name: 'trap' },
  { id: 'rnb', name: 'R&B' },
  { id: 'funk-soul', name: 'funk / soul' },
  { id: 'jazz', name: 'jazz' },
  { id: 'reggae-dub', name: 'reggae / dub' },
  { id: 'dancehall', name: 'dancehall' },
  { id: 'reggaeton-latin', name: 'reggaeton / latin' },
  { id: 'afrobeat', name: 'afrobeat' },
  { id: 'cumbia', name: 'cumbia' },
  { id: 'ambient', name: 'ambient' },
  { id: 'downtempo', name: 'downtempo' },
  { id: 'experimental', name: 'expérimental' },
  { id: 'noise', name: 'noise' },
  { id: 'leftfield', name: 'leftfield' },
  { id: 'pop', name: 'pop' },
  { id: 'indie-rock', name: 'indie / rock' },
  { id: 'punk', name: 'punk' },
  { id: 'synthwave', name: 'synthwave' },
  { id: 'hardcore-gabber', name: 'hardcore / gabber' },
] as const
export type GenreId = (typeof GENRES)[number]['id']

// Whether `value` looks like an email address. Only the shape is checked, not that it exists.
export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

// Whether `value` looks like a phone number: at least 7 digits, written however the artist likes.
export function isPhoneNumber(value: string): boolean {
  return (value.match(/\d/g) ?? []).length >= 7
}

export type LinkSiteId = 'soundcloud' | 'instagram' | 'web' | 'bandcamp' | 'mixcloud' | 'ra' | 'youtube' | 'spotify' | 'tiktok'

// A site an artist can link to, and how to find their profile name in what they type or paste (see `parseLink`).
export type LinkSite = {
  id: LinkSiteId
  // As the artist sees it, e.g. in errors.
  name: string
  // How the addresses of the site's profiles start, up to the profile name, e.g. "soundcloud.com/".
  prefix?: string
  // Hosts a full URL for this site can have.
  host?: RegExp
  // Where the profile name is in the path of an address, e.g. ra.co/dj/<profile>. Addresses whose path doesn't
  // match aren't those of a profile.
  path?: RegExp
  // First path segments that are the site's own pages rather than profiles, e.g. instagram.com/p/<post>, or its own
  // subdomains for Bandcamp, e.g. daily.bandcamp.com. They can't be profile names either.
  reserved?: string[]
  // The host of the site's short links, which don't contain the profile name.
  shortLinkHost?: string
  // For sites where the profile is a subdomain (Bandcamp): the domain after it.
  subdomainOf?: string
  // Whether profile names can be typed with an @ in front, e.g. @parking.radio.
  atSign?: boolean
  // What a valid profile name looks like. Absent for "web", which takes a full URL.
  profile?: RegExp
  // The address of the profile with that name.
  url: (value: string) => string
}

export const LINK_SITES: LinkSite[] = [
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    prefix: 'soundcloud.com/',
    host: /^(www\.|m\.)?soundcloud\.com$/,
    path: /^\/([^/]+)/,
    reserved: ['discover', 'search', 'you', 'stream', 'feed', 'upload', 'charts', 'stations', 'messages', 'notifications', 'settings', 'pages', 'tags'],
    shortLinkHost: 'on.soundcloud.com',
    profile: /^[a-z0-9_-]{2,}$/i,
    url: (value) => `https://soundcloud.com/${value}`,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    prefix: 'instagram.com/',
    host: /^(www\.)?instagram\.com$/,
    path: /^\/([^/]+)/,
    reserved: ['p', 'reel', 'reels', 'stories', 'explore', 'tv', 'accounts', 'direct', 'about', 'legal'],
    atSign: true,
    profile: /^[a-z0-9._]{1,30}$/i,
    url: (value) => `https://instagram.com/${value}`,
  },
  { id: 'web', name: 'Site web', url: (value) => value },
  {
    id: 'bandcamp',
    name: 'Bandcamp',
    subdomainOf: 'bandcamp.com',
    reserved: ['www', 'daily', 'blog', 'get'],
    profile: /^[a-z0-9-]{2,}$/i,
    url: (value) => `https://${value}.bandcamp.com`,
  },
  {
    id: 'mixcloud',
    name: 'Mixcloud',
    prefix: 'mixcloud.com/',
    host: /^(www\.|m\.)?mixcloud\.com$/,
    path: /^\/([^/]+)/,
    reserved: ['discover', 'search', 'upload', 'live', 'select', 'dashboard', 'settings', 'categories'],
    profile: /^[a-z0-9_-]{2,}$/i,
    url: (value) => `https://mixcloud.com/${value}`,
  },
  {
    id: 'ra',
    name: 'Resident Advisor',
    prefix: 'ra.co/dj/',
    host: /^(www\.)?(ra\.co|residentadvisor\.net)$/,
    path: /^\/dj\/([^/]+)/i,
    profile: /^[a-z0-9-]{2,}$/i,
    url: (value) => `https://ra.co/dj/${value}`,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    prefix: 'youtube.com/@',
    host: /^(www\.|m\.)?youtube\.com$/,
    path: /^\/@([^/]+)/,
    atSign: true,
    profile: /^[a-z0-9._-]{3,}$/i,
    url: (value) => `https://youtube.com/@${value}`,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    prefix: 'spotify.com/artist/',
    host: /^(open\.)?spotify\.com$/,
    path: /^\/(?:intl-[a-z-]+\/)?artist\/([^/]+)/i,
    profile: /^[a-z0-9]{22}$/i,
    url: (value) => `https://open.spotify.com/artist/${value}`,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    prefix: 'tiktok.com/@',
    host: /^(www\.)?tiktok\.com$/,
    path: /^\/@([^/]+)/,
    atSign: true,
    profile: /^[a-z0-9._]{2,24}$/i,
    url: (value) => `https://tiktok.com/@${value}`,
  },
]

export function linkSite(id: string): LinkSite | undefined {
  return LINK_SITES.find((site) => site.id === id)
}

function isReserved(site: LinkSite, segment: string): boolean {
  return site.reserved?.includes(segment.toLowerCase()) ?? false
}

// Reduces what the artist typed or pasted to the profile name, or to the full URL for "web", which is what's stored.
// Returns {} for an empty field, and an error (in French, meant for the artist) when it can't be read.
export function parseLink(site: LinkSite, raw: string): { value?: string; error?: string } {
  const value = raw.trim()
  if (!value) return {}
  const parsed = site.profile ? parseProfileName(site, site.profile, value) : parseAddress(value)
  if (parsed.value && parsed.value.length > LINK_MAX_LENGTH) return { error: `ça dépasse ${LINK_MAX_LENGTH} caractères` }
  return parsed
}

// The full URL in `value`, for "web".
function parseAddress(value: string): { value?: string; error?: string } {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    // A domain name, rather than e.g. "localhost" or an IP address, and nothing before it, since
    // https://soundcloud.com@example.com is example.com's address.
    const domain = url.hostname.includes('.') && !/\.\d+$/.test(url.hostname)
    return domain && !url.username && !url.password ? { value: url.href.replace(/\/$/, '') } : { error: 'adresse invalide' }
  } catch {
    return { error: 'adresse invalide' }
  }
}

// The profile name in `value`, for a site whose profile names look like `profile`.
function parseProfileName(site: LinkSite, profile: RegExp, value: string): { value?: string; error?: string } {
  // It's an address when it starts with http, has a "/" or is the site's own domain. Otherwise it's a profile
  // name, which can contain dots (e.g. @parking.radio on Instagram).
  const lower = value.toLowerCase()
  const isUrl =
    /^https?:\/\//i.test(value) ||
    value.includes('/') ||
    (site.host?.test(lower) ?? false) ||
    (site.subdomainOf !== undefined && lower.endsWith(`.${site.subdomainOf}`))

  if (isUrl) {
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    } catch {
      return { error: 'adresse invalide' }
    }
    const host = url.hostname.toLowerCase()
    if (site.subdomainOf) {
      const domain = site.subdomainOf
      if (host !== domain && !host.endsWith(`.${domain}`)) return { error: `ce n'est pas une adresse ${site.name}` }
      // E.g. bandcamp.com/<artist> or daily.bandcamp.com, rather than the artist's own subdomain.
      value = host === domain ? '' : host.slice(0, -domain.length - 1).replace(/^www\./, '')
      if (!value || isReserved(site, value)) return { error: `copie l'adresse de ta page de profil, qui finit par .${domain}` }
    } else {
      if (host === site.shortLinkHost) return { error: 'lien court : copie plutôt l’adresse de ta page de profil' }
      if (!site.host?.test(host)) return { error: `ce n'est pas une adresse ${site.name}` }
      if (url.pathname === '/') return { error: 'il manque ton nom de profil' }
      // E.g. a post, a track or an event, rather than the profile itself.
      const match = site.path?.exec(url.pathname)
      if (!match || isReserved(site, match[1])) return { error: `copie l'adresse de ta page de profil, qui commence par ${site.prefix}` }
      try {
        value = decodeURIComponent(match[1])
      } catch {
        // A "%" that doesn't start an escape sequence.
        return { error: 'adresse invalide' }
      }
    }
  } else if (site.atSign) {
    value = value.replace(/^@/, '')
  }

  if (!value) return { error: 'il manque ton nom de profil' }
  return profile.test(value) && !isReserved(site, value) ? { value } : { error: `ce nom de profil ${site.name} n'est pas valide` }
}

// Checks a profile, as it was sent or as it's being filled in a form, and returns what's saved of it: trimmed, without
// blank entries, and with links reduced to profile names. If it isn't valid, returns what's wrong with each field
// instead. For links, that's the first link that's wrong, or that there's none.
export function checkProfile(sent: unknown): { profile: ArtistProfile; errors?: undefined } | { profile?: undefined; errors: FieldErrors<ArtistProfile> } {
  const artist: Partial<Record<keyof ArtistProfile, unknown>> = sent !== null && typeof sent === 'object' ? sent : {}
  const errors: FieldErrors<ArtistProfile> = {}
  // The value of a field, or an empty one if it's wrong, after noting why.
  const check = (field: keyof ArtistProfile, checked: Checked<string>): string => {
    if (checked.error !== undefined) errors[field] ??= checked.error
    return checked.value ?? ''
  }

  const kind = ARTIST_KINDS.find((kind) => kind === artist.kind)
  if (!kind) errors.kind = 'Indique si tu postules comme artiste ou comme collectif.'
  const collective = kind === 'collective'
  const name = check(
    'name',
    checkLine(artist.name, collective ? 'Le nom du collectif' : "Le nom d'artiste", NAME_MAX_LENGTH, collective ? 'Indique le nom du collectif.' : "Indique ton nom d'artiste."),
  )

  // Only a collective lists its artists. Blank entries and duplicates, whatever their case, are dropped.
  const members: string[] = []
  for (const member of collective && Array.isArray(artist.members) ? artist.members : []) {
    const memberName = check('members', checkLine(member, "Le nom d'un artiste du collectif", NAME_MAX_LENGTH, null))
    if (memberName && !members.some((other) => other.toLowerCase() === memberName.toLowerCase())) members.push(memberName)
  }
  if (collective && members.length === 0) errors.members ??= 'Indique au moins un artiste du collectif.'

  const country = COUNTRIES.find((code) => code === artist.country)
  if (!country) errors.country = 'Choisis ton pays.'
  const city = check('city', checkLine(artist.city, 'La ville', CITY_MAX_LENGTH, 'Indique ta ville.'))

  // Duplicates are dropped, keeping the first, so that the order still says which genres matter most.
  const genres: GenreId[] = []
  for (const sentGenre of Array.isArray(artist.genres) ? artist.genres : []) {
    const genre = GENRES.find(({ id }) => id === sentGenre)
    if (!genre) errors.genres ??= "Un des genres n'est pas dans la liste."
    else if (!genres.includes(genre.id)) genres.push(genre.id)
  }
  if (genres.length === 0) errors.genres ??= 'Choisis au moins un genre.'

  const bio = check('bio', checkText(artist.bio, 'La bio', BIO_MAX_LENGTH, 'Écris quelques lignes de bio.'))

  const links: Partial<Record<LinkSiteId, string>> = {}
  for (const [id, raw] of Object.entries(artist.links !== null && typeof artist.links === 'object' ? artist.links : {})) {
    const site = linkSite(id)
    if (!site || typeof raw !== 'string') {
      errors.links ??= 'Un des liens est invalide.'
      continue
    }
    const { value, error } = parseLink(site, raw)
    if (error) errors.links ??= `${site.name} : ${error}.`
    else if (value) links[site.id] = value
  }
  if (Object.keys(links).length === 0) errors.links ??= 'Ajoute au moins un lien.'

  const email = check('email', checkLine(artist.email, "L'adresse e-mail", EMAIL_MAX_LENGTH, 'Indique ton adresse e-mail.'))
  if (email && !isEmailAddress(email)) errors.email = 'Indique une adresse e-mail valide.'
  const phone = check('phone', checkLine(artist.phone, 'Le numéro de téléphone', PHONE_MAX_LENGTH, 'Indique ton numéro de téléphone.'))
  if (phone && !isPhoneNumber(phone)) errors.phone = 'Indique un numéro de téléphone valide.'

  if (!kind || !country || Object.keys(errors).length > 0) return { errors }
  return { profile: { email, kind, name, members, country, city, genres, bio, links, phone } }
}

// The photo's types, as the server tells them from its contents.
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// What's wrong with a photo of this type and size (in bytes), or with there being none, if anything.
export function photoError(photo: { type: string; size: number } | null): string | null {
  if (!photo || !PHOTO_TYPES.includes(photo.type)) return 'Ajoute une photo en JPEG, PNG ou WebP.'
  if (photo.size > PHOTO_MAX_BYTES) return `La photo dépasse ${PHOTO_MAX_BYTES / 1024 / 1024} Mo.`
  return null
}
