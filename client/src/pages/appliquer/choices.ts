import type { PrestationId } from 'shared/applications'
import type { ArtistKind, GenreId, LinkSiteId } from '../../artist-profile'

// What the "Appliquer" form offers, and the limits it sets, on top of the rules that every profile and application has to
// follow (see artist-profile.ts and shared/src/applications.ts). The server doesn't know about these: admins can
// bring in applications that don't follow them, e.g. from the original Google Form.

// An artist usually gets an hour of a time slot in the programmation, a collective a whole one, which is about 4 hours.
// Once their date is confirmed, collectives make their own flyer.
export const SLOT_HOURS: Record<ArtistKind, number> = { artist: 1, collective: 4 }
export const MAX_MEMBERS = 4

export const MAX_GENRES = 3

// The admin pages allow longer bios, up to BIO_MAX_LENGTH.
export const APPLY_BIO_MAX_LENGTH = 1500

// Every genre, grouped only to make the list easier to scan.
export const GENRE_GROUPS: { name: string; genres: GenreId[] }[] = [
  { name: 'House & disco', genres: ['house', 'deep-house', 'tech-house', 'afro-house', 'amapiano', 'disco', 'nu-disco', 'italo'] },
  { name: 'Techno & électro', genres: ['techno', 'hard-techno', 'minimal', 'acid', 'electro', 'trance', 'ebm-industrial'] },
  { name: 'Bass & breaks', genres: ['drum-and-bass', 'jungle', 'breakbeat', 'uk-garage', 'dubstep', 'bass', 'footwork-juke', 'baile-funk'] },
  { name: 'Hip-hop & soul', genres: ['hip-hop', 'rap', 'trap', 'rnb', 'funk-soul', 'jazz'] },
  { name: 'Monde', genres: ['reggae-dub', 'dancehall', 'reggaeton-latin', 'afrobeat', 'cumbia'] },
  { name: 'Écoute & expérimental', genres: ['ambient', 'downtempo', 'experimental', 'noise', 'leftfield'] },
  { name: 'Autres', genres: ['pop', 'indie-rock', 'punk', 'synthwave', 'hardcore-gabber'] },
]

// At least one prestation, or "Autre" with a few words (null when it isn't checked). Returns what's missing, if anything.
export function prestationError(prestations: PrestationId[], otherPrestation: string | null): string | null {
  if (prestations.length > 0 || otherPrestation?.trim()) return null
  return otherPrestation === null ? 'Choisissez au moins un type de prestation.' : 'Précisez votre autre type de prestation.'
}

// Links to these sites are always shown. The others are added with a button.
export const DEFAULT_LINK_SITES: LinkSiteId[] = ['soundcloud', 'instagram', 'web', 'bandcamp']

// Listed first among the countries.
export const PRIORITY_COUNTRIES = ['CA', 'US', 'FR', 'BE', 'CH']

// The programmation's time slots, in Québec time. A collective takes a whole slot, an artist an hour of one. They're
// sent as the times they start and end.
export const TIME_SLOTS = [
  { id: '11-15', label: '11 h – 15 h', start: '11:00', end: '15:00' },
  { id: '13-17', label: '13 h – 17 h', start: '13:00', end: '17:00' },
  { id: '18-22', label: '18 h – 22 h', start: '18:00', end: '22:00' },
] as const
export type TimeSlotId = (typeof TIME_SLOTS)[number]['id']

// Artists can only pick dates from MIN_MONTHS_AHEAD months from now, which leaves time to plan the programmation, up to
// MAX_MONTHS_AHEAD months from now, and at most MAX_DATES of them.
export const MIN_MONTHS_AHEAD = 2
export const MAX_MONTHS_AHEAD = 12
export const MAX_DATES = 14

// "Today" is the day in Québec, whatever the time zone of the visitor.
const TIME_ZONE = 'America/Toronto'

// The day `date` falls on in Québec, as "YYYY-MM-DD".
export function dayInQuebec(date: Date): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// The same day of the month, `months` months later. When that month is shorter, the last day of that month instead
// (e.g. December 31st + 2 months is the end of February).
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date, daysInTarget))
  return target.toISOString().slice(0, 10)
}

// The first and last days an artist can pick, as "YYYY-MM-DD".
export function selectableDates(now: Date): { first: string; last: string } {
  const today = dayInQuebec(now)
  return { first: addMonths(today, MIN_MONTHS_AHEAD), last: addMonths(today, MAX_MONTHS_AHEAD) }
}
