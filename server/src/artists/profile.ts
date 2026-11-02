import { z } from 'zod'

// An artist's profile: the lists and rules every profile has to follow (see docs/design/server/artists.md), as the zod
// schemas the server checks profiles with, which openapi.json is generated from. Two artists can't have the same email
// address, whatever its case. The server explains what's wrong with a profile in French, because artists see its
// messages: every error that a profile can get has its message here.
//
// The client has its own copy of these rules, for its forms to say what's wrong right away (see
// client/src/artist-profile.ts): they must be changed together. These are the ones that count.
//
// Responses are checked against the lists below too (see artists/routes.ts), so taking a value out of one, e.g. a
// genre, takes migrating the artists that have it, and the sets, for genres (see sessions/fields.ts): otherwise, every
// response with one of them fails with 500.

export const NAME_MAX_LENGTH = 100
const CITY_MAX_LENGTH = 100
export const BIO_MAX_LENGTH = 5000
export const EMAIL_MAX_LENGTH = 200
const PHONE_MAX_LENGTH = 40
const LINK_MAX_LENGTH = 200

// ISO 3166-1 alpha-2 codes, and XK, which ISO hasn't assigned but is used for Kosovo. `Intl.DisplayNames` gives
// their names.
const COUNTRIES = [
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
] as const
const NO_COUNTRY = 'Choisissez le pays.'
export const Country = z.enum(COUNTRIES, { error: NO_COUNTRY }).meta({ id: 'Country' })
export type Country = z.infer<typeof Country>

// The genres an artist can pick from. What's stored is their id, which doesn't change, so that their names can, e.g. to
// be translated. Their names are the client's (see client/src/artist-profile.ts), and the application emails' (see
// applications/emails.ts).
export const GENRES = [
  'house',
  'deep-house',
  'tech-house',
  'afro-house',
  'amapiano',
  'disco',
  'nu-disco',
  'italo',
  'techno',
  'hard-techno',
  'minimal',
  'acid',
  'electro',
  'trance',
  'ebm-industrial',
  'drum-and-bass',
  'jungle',
  'breakbeat',
  'uk-garage',
  'dubstep',
  'bass',
  'footwork-juke',
  'baile-funk',
  'hip-hop',
  'rap',
  'trap',
  'rnb',
  'funk-soul',
  'jazz',
  'reggae-dub',
  'dancehall',
  'reggaeton-latin',
  'afrobeat',
  'cumbia',
  'ambient',
  'downtempo',
  'experimental',
  'noise',
  'leftfield',
  'pop',
  'indie-rock',
  'punk',
  'synthwave',
  'hardcore-gabber',
] as const
export const GenreId = z.enum(GENRES, { error: "Un des genres n'est pas dans la liste." }).meta({ id: 'GenreId' })
export type GenreId = z.infer<typeof GenreId>

// The photo is optional, and sent as a file, next to the profile: a JPEG, PNG or WebP image of up to PHOTO_MAX_BYTES,
// whose type the server tells from its contents (see `validatePhoto` in artists/store.ts).
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const PHOTO_WRONG_TYPE = 'La photo doit être en JPEG, PNG ou WebP.'
export const PHOTO_TOO_LARGE = `La photo dépasse ${PHOTO_MAX_BYTES / 1024 / 1024} Mo.`
// The photo, as a part of a multipart/form-data request, which the route reads itself (see `readPhotoForm`).
export const PhotoFile = z.file().meta({
  description: `A JPEG, PNG or WebP image of up to ${PHOTO_MAX_BYTES / 1024 / 1024} MB, whose type is told from its contents. An empty file is no photo`,
})

// Whether `value` looks like an email address. Only the shape is checked, not that it exists. Besides spaces and @, it
// can't have the characters that make it more than a single address, or an address with a name, e.g. "Name <address>"
// or "address, address": we send emails to these addresses, so each one must be exactly one mailbox.
export function isEmailAddress(value: string): boolean {
  return /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]+$/.test(value)
}

// Whether `value` looks like a phone number: at least 7 digits, written however the artist likes.
function isPhoneNumber(value: string): boolean {
  return (value.match(/\d/g) ?? []).length >= 7
}

const LINK_SITE_IDS = ['soundcloud', 'instagram', 'web', 'bandcamp', 'mixcloud', 'ra', 'youtube', 'spotify', 'tiktok'] as const
export type LinkSiteId = (typeof LINK_SITE_IDS)[number]

// A site an artist can link to, and how to find their profile name in what they type or paste (see `parseLink`).
type LinkSite = {
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

// In the order of LINK_SITE_IDS, which is the order the emails list links in, and in which links are checked.
export const LINK_SITES: LinkSite[] = LINK_SITE_IDS.map((id) => ({ id, ...SITES[id] }))

export function linkSite(id: LinkSiteId): LinkSite {
  return LINK_SITES.find((site) => site.id === id)!
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

// Whether what the artist typed or pasted for a site whose profiles have names is an address, rather than a profile
// name: it starts with http, has a "/" or is the site's own domain. A profile name can contain dots, e.g. parking.radio
// on Instagram.
function isAddress(site: LinkSite, value: string): boolean {
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

// The errors that aren't about a field's length.
const NO_GENRE = 'Choisissez au moins un genre.'
const NO_LINK = 'Ajoutez au moins un lien.'
const BAD_LINK = 'Un des liens est invalide.'

// A text, trimmed, then up to `maxLength` characters, and refused if it has the NUL character, which the database can't
// store. `field` names it in the error when it's too long or has a NUL, e.g. "La bio", and `missing` is the error when it
// isn't a string, or when it's empty unless it `canBeEmpty`. openapi.json would read as applying its lengths to what's
// sent, so the description says they apply after the cleanup. Applications' text fields follow the same rules (see
// applications/fields.ts). The client has its own copy (see checkText and checkLine in client/src/checks.ts), and they
// must be changed together.
export function text(field: string, maxLength: number, missing: string, { canBeEmpty = false, singleLine = false } = {}) {
  let schema = z.string({ error: missing })
  // Each run of spaces, tabs or line breaks in a single line, e.g. a name, becomes a single space.
  if (singleLine) schema = schema.overwrite((value) => value.replace(/\s+/g, ' '))
  schema = schema.trim()
  if (!canBeEmpty) schema = schema.min(1, missing)
  schema = schema.refine((value) => !value.includes('\0'), `${field} contient un caractère invalide.`)
  const cleaned = singleLine ? 'Each run of spaces, tabs or line breaks becomes a single space, and it is trimmed' : 'Trimmed'
  const length = canBeEmpty ? `up to ${maxLength}` : `between 1 and ${maxLength}`
  return schema.max(maxLength, `${field} dépasse ${maxLength} caractères.`).meta({ description: `${cleaned}, then ${length} characters` })
}

// Like `text`, for a field that's a single line, e.g. a name.
export function line(field: string, maxLength: number, missing: string, options: { canBeEmpty?: boolean } = {}) {
  return text(field, maxLength, missing, { ...options, singleLine: true })
}

// The fields admins can leave out are absent, null or empty, and are then saved as `empty`.
export function orLeftOut<Schema extends z.ZodType, Empty>(schema: Schema, empty: Empty) {
  return schema.nullish().transform((value) => value || empty)
}

// The fields that artists' and collectives' profiles share, with what admins `canLeaveOut`.

// The country, or "" when it's left out.
export function country({ canLeaveOut }: { canLeaveOut: boolean }) {
  return canLeaveOut
    ? orLeftOut(z.union([Country, z.string().regex(/^\s*$/, NO_COUNTRY).transform(() => '' as const)], { error: NO_COUNTRY }), '' as const)
    : Country
}

export function city({ canLeaveOut }: { canLeaveOut: boolean }) {
  const city = line('La ville', CITY_MAX_LENGTH, 'Indiquez la ville.', { canBeEmpty: canLeaveOut })
  return canLeaveOut ? orLeftOut(city, '') : city
}

export function phone({ canLeaveOut }: { canLeaveOut: boolean }) {
  const phone = line('Le numéro de téléphone', PHONE_MAX_LENGTH, 'Indiquez votre numéro de téléphone.', { canBeEmpty: canLeaveOut }).refine(
    (phone) => !phone || isPhoneNumber(phone),
    'Indiquez un numéro de téléphone valide.',
  )
  return canLeaveOut ? orLeftOut(phone, '') : phone
}

// An email address, or a blank one when it `canBeEmpty`. Unlike an artist's, a collective contact's is always required.
export function emailAddress({ canBeEmpty = false } = {}) {
  return line("L'adresse e-mail", EMAIL_MAX_LENGTH, 'Indiquez votre adresse e-mail.', { canBeEmpty }).refine(
    (value) => !value || isEmailAddress(value),
    'Indiquez une adresse e-mail valide.',
  )
}

// An email address, unless admins `canLeaveOut` it: it's then absent, null or blank, and saved as null rather than
// empty, so that any number of artists can be without one while emails stay unique.
function email({ canLeaveOut }: { canLeaveOut: boolean }) {
  return canLeaveOut ? orLeftOut(emailAddress({ canBeEmpty: true }), null) : emailAddress()
}

// A link, as it was typed or pasted, which is reduced to the profile name (see `parseLink`), or undefined when it's
// blank.
function link(site: LinkSite) {
  return z
    .string({ error: BAD_LINK })
    .transform((raw, context) => {
      const { value, error } = parseLink(site, raw)
      if (error) context.addIssue({ code: 'custom', message: `${site.name} : ${error}.` })
      return value
    })
    .optional()
}

// What's saved of the links, by site.
type Links = Partial<Record<LinkSiteId, string>>

// The links, by site, at least one unless admins `canLeaveOut` them. Blank ones are dropped.
export function links({ canLeaveOut }: { canLeaveOut: boolean }) {
  const sites = Object.fromEntries(LINK_SITES.map((site) => [site.id, link(site)])) as Record<LinkSiteId, ReturnType<typeof link>>
  const sent = z
    // A link to another site isn't one of these, and anything other than an object isn't links at all.
    .strictObject(sites, { error: (issue) => (issue.code === 'unrecognized_keys' ? BAD_LINK : NO_LINK) })
    .transform((links) => Object.fromEntries(Object.entries(links).filter(([, value]) => value)) as Links)
    .meta({
      description:
        'By site, a link to the profile or the profile name, or the address for "web". It\'s saved as the profile ' +
        `name (or the address), which can't be longer than ${LINK_MAX_LENGTH} characters. Blank ones are dropped.`,
    })
  // An array is read as an object whose keys are its indexes, which aren't sites, and [] as no links.
  const object = z.preprocess((value) => (Array.isArray(value) ? { ...value } : value), sent)
  return canLeaveOut ? orLeftOut(object, {} as Links) : object.refine((links) => Object.keys(links).length > 0, NO_LINK)
}

// The error of a profile that's missing everything, starting with the name.
export const NO_NAME = "Indiquez le nom d'artiste."

// The profile of an artist, as it's sent, with what admins `canLeaveOut`.
function profile({ canLeaveOut }: { canLeaveOut: boolean }) {
  const bio = text('La bio', BIO_MAX_LENGTH, 'Écrivez quelques lignes de bio.', { canBeEmpty: canLeaveOut })
  // Most important first. Duplicates are dropped, keeping the first.
  const genres = z.array(GenreId, { error: NO_GENRE }).overwrite((ids) => ids.filter((id, i) => ids.indexOf(id) === i))
  const fields = {
    name: line("Le nom d'artiste", NAME_MAX_LENGTH, NO_NAME),
    country: country({ canLeaveOut }),
    city: city({ canLeaveOut }),
    genres: canLeaveOut ? orLeftOut(genres, []) : genres.min(1, NO_GENRE),
    bio: canLeaveOut ? orLeftOut(bio, '') : bio,
    links: links({ canLeaveOut }),
    email: email({ canLeaveOut }),
    phone: phone({ canLeaveOut }),
  }
  // Something other than an object is missing everything, starting with the name.
  return z.object(fields, { error: NO_NAME })
}

// A profile, as artists send it when they apply (see `Applicant` in applications/applicant.ts), and as admins send it:
// they can leave out the country, city, genres, bio, links, email and phone, since they bring in artists who applied
// elsewhere, e.g. through the original Google Form, which didn't always ask for them, or whom they only know by name.
// What's there still has to be valid. Both are cleaned up as they're checked, and the first error is what the server
// answers.
// An artist's email is the same rule either way, but TypeScript can't tell that it's never left out: it's said again, in
// the same place among the fields, since the first error is the one the server answers.
export const ArtistProfile = profile({ canLeaveOut: false }).extend({ email: emailAddress() })
export const AdminArtistProfile = profile({ canLeaveOut: true }).meta({ id: 'AdminArtistProfile' })

// What's saved of a profile, whoever sent it.
export type Profile = z.output<typeof AdminArtistProfile>
// What's saved of a profile that an artist sent when they applied, which always has an email address.
export type ApplicantProfile = z.output<typeof ArtistProfile>

// The links of a profile, as they're saved: by site, the profile name, or the address for "web".
export const ArtistLinks = z
  .strictObject(Object.fromEntries(LINK_SITE_IDS.map((id) => [id, z.string().optional()])) as Record<LinkSiteId, z.ZodOptional<z.ZodString>>)
  .meta({ id: 'ArtistLinks' })
