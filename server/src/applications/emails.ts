import { LINK_SITES } from '../artists/profile.js'
import type { GenreId, Profile } from '../artists/profile.js'
import type { Email } from '../core/email.js'
import type { Applied } from './applicant.js'
import type { ApplicationFields, PrestationId } from './fields.js'

// The emails sent when an artist or a collective applies through `POST /api/applications`: the application, to the
// recipients chosen on the admin pages, and a confirmation, to the artist, or the collective's contact. Both are in
// French.

const countryNames = new Intl.DisplayNames(['fr'], { type: 'region' })
// Days are "YYYY-MM-DD", which are read as midnight UTC, so they're formatted in UTC to stay the same day.
const dayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// The names of the genres, as the forms show them: the client has its own copy (see GENRE_NAMES in
// client/src/artist-profile.ts), and they must be changed together.
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

// The names of the prestations, as the forms show them: the client has its own copy (see PRESTATION_NAMES in
// client/src/application-fields.ts), and they must be changed together.
const PRESTATION_NAMES: Record<PrestationId, string> = {
  dj: 'DJ',
  vinyl: 'Vinyl',
  'live-performance': 'Performance Live',
  rap: 'Rap',
  'full-band': 'Full Band',
}

function place({ city, country }: Pick<Profile, 'city' | 'country'>): string {
  return `Ville : ${city}, ${countryNames.of(country) ?? country}`
}

function genres(profile: Pick<Profile, 'genres'>): string {
  return `Genres : ${profile.genres.map((id) => GENRE_NAMES[id]).join(', ')}`
}

function links(profile: Pick<Profile, 'links'>): string[] {
  return ['Liens :', ...LINK_SITES.filter((site) => profile.links[site.id]).map((site) => `  ${site.name} : ${site.url(profile.links[site.id]!)}`)]
}

// Who applied, as they were saved, and their application, as plain text: everything that was sent but the photos, which
// aren't emailed, since they're on the admin pages. For a collective, that's its own profile and its application, then
// each of its artists' profiles.
export function describeApplication(applied: Applied, application: ApplicationFields): string {
  const prestations = application.prestations.map((id) => PRESTATION_NAMES[id])
  if (application.otherPrestation) prestations.push(`autre : ${application.otherPrestation}`)
  const sent = [
    '',
    'Dates souhaitées :',
    ...application.dates.map((date) => `  ${dayFormat.format(new Date(date))}`),
    `Plages horaires : ${application.timeSlots.length === 0 ? 'à toute heure' : application.timeSlots.map(({ start, end }) => `${start} à ${end}`).join(', ')}`,
    `Type de prestation : ${prestations.join(', ') || '—'}`,
  ]
  const details = application.details ? ['', 'Questions ou détails :', application.details] : []

  if ('artist' in applied) {
    const { artist } = applied
    return [
      `Artiste : ${artist.name}`,
      place(artist),
      genres(artist),
      `E-mail : ${artist.email}`,
      `Téléphone : ${artist.phone}`,
      '',
      ...links(artist),
      ...sent,
      '',
      'Bio :',
      artist.bio,
      ...details,
    ].join('\n')
  }
  const { collective, members } = applied
  return [
    `Collectif : ${collective.name}`,
    `Artistes du collectif : ${members.map((member) => member.name).join(', ')}`,
    place(collective),
    `E-mail du contact : ${collective.email}`,
    `Téléphone du contact : ${collective.phone}`,
    '',
    ...links(collective),
    ...sent,
    '',
    'Description :',
    collective.description,
    // Before its artists' profiles, so that they don't read as the last artist's.
    ...details,
    ...members.flatMap((member, index) => ['', `Artiste ${index + 1} : ${member.name}`, place(member), genres(member), ...links(member), 'Bio :', member.bio]),
  ].join('\n')
}

// The emails for an application that was just saved. `toRecipients` is null when nobody was chosen to get them.
// Replying to it answers the artist, or the collective's contact, and replying to the confirmation answers the
// recipients.
//
// The confirmation goes to whatever address was typed in the application, so it only says what we wrote, and none of
// what the artist did. Otherwise, anyone could have us send their own text to any address.
export function applicationEmails({
  applied,
  application,
  recipients,
}: {
  applied: Applied
  application: ApplicationFields
  recipients: string[]
}): { toRecipients: Email | null; confirmation: Email } {
  const anyone = recipients.length > 0
  const { name, email } = 'artist' in applied ? applied.artist : applied.collective
  return {
    toRecipients: anyone
      ? {
          to: recipients,
          replyTo: [email],
          subject: `Nouvelle candidature : ${name}`,
          text: describeApplication(applied, application),
        }
      : null,
    confirmation: {
      to: [email],
      replyTo: anyone ? recipients : undefined,
      subject: 'parking.radio : nous avons bien reçu votre candidature',
      text: [
        'Bonjour,',
        '',
        "Merci pour votre candidature à parking.radio, nous l'avons bien reçue. Nous regardons les dates et nous vous recontacterons par e-mail.",
        ...('collective' in applied
          ? ['', 'Petit rappel pour les takeovers : nous demandons aux collectifs de produire un flyer (carte blanche).']
          : []),
      ].join('\n'),
    },
  }
}
