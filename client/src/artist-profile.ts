import type { Schema } from './api/client'
import { checkLine, checkText, everyOne, fieldChecker } from './checks'
import type { Checked, FieldErrors } from './checks'
import type { ComboboxOption } from './combobox'

// How an artist's profile is shown and checked in the browser, by the admin pages and by the "Appliquer" form alike.
//
// The forms check profiles as the server does, to say what's wrong right away, with a copy of the server's rules: its
// lists, limits, link parsing and messages (see server/src/artists/profile.ts), which must be changed together with
// these. The server's are the ones that count: when they disagree, the server's message shows.

export type Artist = Schema<'Artist'>
export type Country = Schema<'Country'>
export type GenreId = Schema<'GenreId'>
export type ArtistLinks = Schema<'ArtistLinks'>
export type LinkSiteId = keyof ArtistLinks

// A profile, as the server saves it, which is what `checkProfile` returns.
export type Profile = Omit<Artist, 'id' | 'createdAt' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'hasPhoto' | 'collectives'>

export const NAME_MAX_LENGTH = 100
export const CITY_MAX_LENGTH = 100
export const BIO_MAX_LENGTH = 5000
export const EMAIL_MAX_LENGTH = 200
export const PHONE_MAX_LENGTH = 40
const LINK_MAX_LENGTH = 200

// ISO 3166-1 alpha-2 codes, and XK, which ISO hasn't assigned but is used for Kosovo. `Intl.DisplayNames` gives their
// names.
export const COUNTRIES = everyOne<Country>()([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE',
  'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD',
  'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
  'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
  'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME',
  'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM',
  'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI',
  'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK',
  'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
])

// The genres' names, in French, in the order the admin pages list them (the "Appliquer" form groups them: see
// GENRE_GROUPS in pages/appliquer/choices.ts). The server emails them too (see server/src/applications/emails.ts), and
// they must be changed together.
const GENRE_NAMES: Record<GenreId, string> = {
  house: 'house',
  'deep-house': 'deep house',
  'tech-house': 'tech house',
  'afro-house': 'afro house',
  amapiano: 'amapiano',
  disco: 'disco',
  'nu-disco': 'nu-disco',
  italo: 'italo',
  techno: 'techno',
  'hard-techno': 'hard techno',
  minimal: 'minimal',
  acid: 'acid',
  electro: 'électro',
  trance: 'trance',
  'ebm-industrial': 'EBM / industriel',
  'drum-and-bass': 'drum & bass',
  jungle: 'jungle',
  breakbeat: 'breakbeat',
  'uk-garage': 'UK garage',
  dubstep: 'dubstep',
  bass: 'bass',
  'footwork-juke': 'footwork / juke',
  'baile-funk': 'baile funk',
  'hip-hop': 'hip-hop',
  rap: 'rap',
  trap: 'trap',
  rnb: 'R&B',
  'funk-soul': 'funk / soul',
  jazz: 'jazz',
  'reggae-dub': 'reggae / dub',
  dancehall: 'dancehall',
  'reggaeton-latin': 'reggaeton / latin',
  afrobeat: 'afrobeat',
  cumbia: 'cumbia',
  ambient: 'ambient',
  downtempo: 'downtempo',
  experimental: 'expérimental',
  noise: 'noise',
  leftfield: 'leftfield',
  pop: 'pop',
  'indie-rock': 'indie / rock',
  punk: 'punk',
  synthwave: 'synthwave',
  'hardcore-gabber': 'hardcore / gabber',
}
export const GENRES = Object.keys(GENRE_NAMES) as GenreId[]

export function genreName(id: GenreId): string {
  return GENRE_NAMES[id]
}

const countryNames = new Intl.DisplayNames(['fr'], { type: 'region' })

export function countryName(code: string): string {
  return countryNames.of(code) ?? code
}

// Every country, for picking one: those in `first`, in that order, then the others by name.
export function countryOptions(first: string[] = []): ComboboxOption[] {
  const others = COUNTRIES.filter((code) => !first.includes(code)).sort((a, b) => countryName(a).localeCompare(countryName(b), 'fr'))
  return [...first, ...others].map((key) => ({ key, label: countryName(key) }))
}

// Whether `value` looks like an email address. Only the shape is checked, not that it exists. Besides spaces and @, it
// can't have the characters that make it more than a single address, or an address with a name, e.g. "Name <address>"
// or "address, address".
export function isEmailAddress(value: string): boolean {
  return /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]+$/.test(value)
}

// Whether `value` looks like a phone number: at least 7 digits, written however the artist likes.
function isPhoneNumber(value: string): boolean {
  return (value.match(/\d/g) ?? []).length >= 7
}

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

// By site, in the order the forms show them.
const SITES: Record<LinkSiteId, Omit<LinkSite, 'id'>> = {
  soundcloud: {
    name: 'SoundCloud',
    prefix: 'soundcloud.com/',
    host: /^(www\.|m\.)?soundcloud\.com$/,
    path: /^\/([^/]+)/,
    reserved: ['discover', 'search', 'you', 'stream', 'feed', 'upload', 'charts', 'stations', 'messages', 'notifications', 'settings', 'pages', 'tags'],
    shortLinkHost: 'on.soundcloud.com',
    profile: /^[a-z0-9_-]{2,}$/i,
    url: (value) => `https://soundcloud.com/${value}`,
  },
  instagram: {
    name: 'Instagram',
    prefix: 'instagram.com/',
    host: /^(www\.)?instagram\.com$/,
    path: /^\/([^/]+)/,
    reserved: ['p', 'reel', 'reels', 'stories', 'explore', 'tv', 'accounts', 'direct', 'about', 'legal'],
    atSign: true,
    profile: /^[a-z0-9._]{1,30}$/i,
    url: (value) => `https://instagram.com/${value}`,
  },
  web: { name: 'Site web', url: (value) => value },
  bandcamp: {
    name: 'Bandcamp',
    subdomainOf: 'bandcamp.com',
    reserved: ['www', 'daily', 'blog', 'get'],
    profile: /^[a-z0-9-]{2,}$/i,
    url: (value) => `https://${value}.bandcamp.com`,
  },
  mixcloud: {
    name: 'Mixcloud',
    prefix: 'mixcloud.com/',
    host: /^(www\.|m\.)?mixcloud\.com$/,
    path: /^\/([^/]+)/,
    reserved: ['discover', 'search', 'upload', 'live', 'select', 'dashboard', 'settings', 'categories'],
    profile: /^[a-z0-9_-]{2,}$/i,
    url: (value) => `https://mixcloud.com/${value}`,
  },
  ra: {
    name: 'Resident Advisor',
    prefix: 'ra.co/dj/',
    host: /^(www\.)?(ra\.co|residentadvisor\.net)$/,
    path: /^\/dj\/([^/]+)/i,
    profile: /^[a-z0-9-]{2,}$/i,
    url: (value) => `https://ra.co/dj/${value}`,
  },
  youtube: {
    name: 'YouTube',
    prefix: 'youtube.com/@',
    host: /^(www\.|m\.)?youtube\.com$/,
    path: /^\/@([^/]+)/,
    atSign: true,
    profile: /^[a-z0-9._-]{3,}$/i,
    url: (value) => `https://youtube.com/@${value}`,
  },
  spotify: {
    name: 'Spotify',
    prefix: 'spotify.com/artist/',
    host: /^(open\.)?spotify\.com$/,
    path: /^\/(?:intl-[a-z-]+\/)?artist\/([^/]+)/i,
    profile: /^[a-z0-9]{22}$/i,
    url: (value) => `https://open.spotify.com/artist/${value}`,
  },
  tiktok: {
    name: 'TikTok',
    prefix: 'tiktok.com/@',
    host: /^(www\.)?tiktok\.com$/,
    path: /^\/@([^/]+)/,
    atSign: true,
    profile: /^[a-z0-9._]{2,24}$/i,
    url: (value) => `https://tiktok.com/@${value}`,
  },
}

export const LINK_SITES: LinkSite[] = Object.entries(SITES).map(([id, site]) => ({ id: id as LinkSiteId, ...site }))

export function linkSite(id: string): LinkSite | undefined {
  return LINK_SITES.find((site) => site.id === id)
}

function isReserved(site: LinkSite, segment: string): boolean {
  return site.reserved?.includes(segment.toLowerCase()) ?? false
}

// Reduces what the artist typed or pasted to the profile name, or to the full URL for "web", which is what's saved.
// Returns {} for an empty field, and an error when it can't be read.
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

// Whether what the artist typed or pasted for a site whose profiles have names is an address, rather than a profile
// name: it starts with http, has a "/" or is the site's own domain. A profile name can contain dots, e.g. parking.radio
// on Instagram.
export function isAddress(site: LinkSite, raw: string): boolean {
  const value = raw.trim()
  const lower = value.toLowerCase()
  return (
    /^https?:\/\//i.test(value) ||
    value.includes('/') ||
    (site.host?.test(lower) ?? false) ||
    (site.subdomainOf !== undefined && lower.endsWith(`.${site.subdomainOf}`))
  )
}

// The profile name in `value`, for a site whose profile names look like `profile`.
function parseProfileName(site: LinkSite, profile: RegExp, value: string): { value?: string; error?: string } {
  if (isAddress(site, value)) {
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
      if (!value || isReserved(site, value)) return { error: `copiez l'adresse de la page de profil, qui finit par .${domain}` }
    } else {
      if (host === site.shortLinkHost) return { error: 'lien court : copiez plutôt l’adresse de la page de profil' }
      if (!site.host?.test(host)) return { error: `ce n'est pas une adresse ${site.name}` }
      if (url.pathname === '/') return { error: 'il manque le nom de profil' }
      // E.g. a post, a track or an event, rather than the profile itself.
      const match = site.path?.exec(url.pathname)
      if (!match || isReserved(site, match[1])) return { error: `copiez l'adresse de la page de profil, qui commence par ${site.prefix}` }
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

  if (!value) return { error: 'il manque le nom de profil' }
  return profile.test(value) && !isReserved(site, value) ? { value } : { error: `ce nom de profil ${site.name} n'est pas valide` }
}

// For a field admins can leave out (with `lenient`), from which nothing was read, whether it can be taken for one that's
// left out: it's absent, or of its type (`ofItsType`). One of another type, e.g. a phone sent as a number, would
// otherwise be lost.
function leftOut(value: unknown, ofItsType: boolean, lenient: boolean): boolean {
  return lenient && (value === undefined || value === null || ofItsType)
}

// The error for a text field that's missing, or null if admins can leave it out (with `lenient`) and it is.
export function missingError(value: unknown, error: string, { lenient = false } = {}): string | null {
  return leftOut(value, typeof value === 'string', lenient) ? null : error
}

// The checks of the fields that artists' and collectives' profiles share. With `lenient`, for the admin pages, they can
// be left out, and are then "", or empty links. What's there still has to be valid.

// One of COUNTRIES. Only a blank one can be taken for one that's left out: any other string isn't a country.
export function checkCountry(value: unknown, { lenient = false } = {}): Checked<Country | ''> {
  const country = COUNTRIES.find((code) => code === value)
  if (country) return { value: country }
  return leftOut(value, typeof value === 'string' && !value.trim(), lenient) ? { value: '' } : { error: 'Choisissez le pays.' }
}

export function checkCity(value: unknown, { lenient = false } = {}): Checked<string> {
  return checkLine(value, 'La ville', CITY_MAX_LENGTH, missingError(value, 'Indiquez la ville.', { lenient }))
}

export function checkArtistName(value: unknown): Checked<string> {
  return checkLine(value, "Le nom d'artiste", NAME_MAX_LENGTH, "Indiquez le nom d'artiste.")
}

// Duplicates are dropped, keeping the first, so that the order still says which genres matter most.
export function checkGenres(value: unknown, { lenient = false } = {}): Checked<GenreId[]> {
  const genres: GenreId[] = []
  for (const sentGenre of Array.isArray(value) ? value : []) {
    const genre = GENRES.find((id) => id === sentGenre)
    if (!genre) return { error: "Un des genres n'est pas dans la liste." }
    if (!genres.includes(genre)) genres.push(genre)
  }
  if (genres.length === 0 && !leftOut(value, Array.isArray(value), lenient)) return { error: 'Choisissez au moins un genre.' }
  return { value: genres }
}

export function checkBio(value: unknown, { lenient = false } = {}): Checked<string> {
  return checkText(value, 'La bio', BIO_MAX_LENGTH, missingError(value, 'Écrivez quelques lignes de bio.', { lenient }))
}

// In the order of LINK_SITES, then links to other sites, like the server, which says what's wrong with the first.
export function checkLinks(value: unknown, { lenient = false } = {}): Checked<ArtistLinks> {
  const links: ArtistLinks = {}
  const order = (id: string) => {
    const index = LINK_SITES.findIndex((site) => site.id === id)
    return index < 0 ? LINK_SITES.length : index
  }
  const sent = Object.entries(value !== null && typeof value === 'object' ? value : {})
  for (const [id, raw] of sent.sort(([a], [b]) => order(a) - order(b))) {
    const site = linkSite(id)
    if (!site || typeof raw !== 'string') return { error: 'Un des liens est invalide.' }
    const parsed = parseLink(site, raw)
    if (parsed.error) return { error: `${site.name} : ${parsed.error}.` }
    if (parsed.value) links[site.id] = parsed.value
  }
  if (Object.keys(links).length === 0 && !leftOut(value, typeof value === 'object', lenient)) return { error: 'Ajoutez au moins un lien.' }
  return { value: links }
}

// An email address, or "" when it's left out.
export function checkEmail(value: unknown, { lenient = false } = {}): Checked<string> {
  const checked = checkLine(value, "L'adresse e-mail", EMAIL_MAX_LENGTH, missingError(value, 'Indiquez votre adresse e-mail.', { lenient }))
  return checked.value && !isEmailAddress(checked.value) ? { error: 'Indiquez une adresse e-mail valide.' } : checked
}

export function checkPhone(value: unknown, { lenient = false } = {}): Checked<string> {
  const checked = checkLine(value, 'Le numéro de téléphone', PHONE_MAX_LENGTH, missingError(value, 'Indiquez votre numéro de téléphone.', { lenient }))
  return checked.value && !isPhoneNumber(checked.value) ? { error: 'Indiquez un numéro de téléphone valide.' } : checked
}

// Checks a profile as it's being filled in a form, and returns what the server would save of it: trimmed, without blank
// entries, and with links reduced to profile names. If it isn't valid, returns what's wrong with each field instead, for
// the form to show each error by its field. For links, that's the first link that's wrong, in the order of the sites, or that there's none.
//
// With `lenient`, for the admin pages, the country, city, genres, bio, links, email and phone can be left out, as the
// server lets admins do. What's there still has to be valid. A country that's left out is "", and so
// is a city, bio or phone, genres and links are empty, and an email is null.
export function checkProfile(
  sent: unknown,
  { lenient = false } = {},
): { profile: Profile; errors?: undefined } | { profile?: undefined; errors: FieldErrors<Profile> } {
  const artist: Partial<Record<keyof Profile, unknown>> = sent !== null && typeof sent === 'object' ? sent : {}
  const { errors, check } = fieldChecker<Profile>()

  const name = check('name', checkArtistName(artist.name))
  const country = check('country', checkCountry(artist.country, { lenient }))
  const city = check('city', checkCity(artist.city, { lenient }))

  const genres = check('genres', checkGenres(artist.genres, { lenient }))
  const bio = check('bio', checkBio(artist.bio, { lenient }))
  const links = check('links', checkLinks(artist.links, { lenient }))
  const email = check('email', checkEmail(artist.email, { lenient }))
  const phone = check('phone', checkPhone(artist.phone, { lenient }))

  if (Object.keys(errors).length > 0) return { errors }
  return { profile: { name, country, city, genres, bio, links, email: email || null, phone } }
}

// The photo is optional: a JPEG, PNG or WebP image of up to PHOTO_MAX_BYTES, whose type the server tells from its
// contents.
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// What's wrong with a photo picked in a form, if one was. When the browser doesn't know the photo's type, which the server
// tells from its contents anyway, only its size is checked.
export function pickedPhotoError(photo: File | null): string | null {
  if (!photo) return null
  if (photo.type && !PHOTO_TYPES.includes(photo.type)) return 'La photo doit être en JPEG, PNG ou WebP.'
  if (photo.size > PHOTO_MAX_BYTES) return `La photo dépasse ${PHOTO_MAX_BYTES / 1024 / 1024} Mo.`
  return null
}
