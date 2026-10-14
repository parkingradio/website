import { PRESTATIONS } from 'shared/applications'
import type { ApplicationFields } from 'shared/applications'
import { GENRES, LINK_SITES } from 'shared/artists'
import type { ArtistProfile } from 'shared/artists'
import type { Email } from './email.js'

// The emails sent when an artist applies through `POST /api/applications`: the application, to the recipients chosen on
// the admin pages, and a confirmation, to the artist. Both are in French.

const countryNames = new Intl.DisplayNames(['fr'], { type: 'region' })
// Days are "YYYY-MM-DD", which are read as midnight UTC, so they're formatted in UTC to stay the same day.
const dayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// Everything the artist sent but their photo, as plain text. The photo isn't emailed: it's on the artist's page, on the
// admin pages.
export function describeApplication(profile: ArtistProfile, application: ApplicationFields): string {
  const collective = profile.kind === 'collective'
  const genres = profile.genres.map((id) => GENRES.find((genre) => genre.id === id)?.name ?? id)
  const prestations: string[] = application.prestations.map((id) => PRESTATIONS.find((prestation) => prestation.id === id)?.name ?? id)
  if (application.otherPrestation) prestations.push(`autre : ${application.otherPrestation}`)
  const links = LINK_SITES.filter((site) => profile.links[site.id]).map((site) => `  ${site.name} : ${site.url(profile.links[site.id]!)}`)
  return [
    collective ? `Collectif : ${profile.name}` : `Artiste : ${profile.name}`,
    ...(collective ? [`Artistes du collectif : ${profile.members.join(', ')}`] : []),
    `Ville : ${profile.city}, ${countryNames.of(profile.country) ?? profile.country}`,
    `Genres : ${genres.join(', ')}`,
    `E-mail : ${profile.email}`,
    `Téléphone : ${profile.phone}`,
    '',
    'Liens :',
    ...links,
    '',
    'Dates souhaitées :',
    ...application.dates.map((date) => `  ${dayFormat.format(new Date(date))}`),
    `Plages horaires : ${application.timeSlots.length === 0 ? 'à toute heure' : application.timeSlots.map(({ start, end }) => `${start} à ${end}`).join(', ')}`,
    `Type de prestation : ${prestations.join(', ') || '—'}`,
    '',
    'Bio :',
    profile.bio,
    ...(application.details ? ['', 'Questions ou détails :', application.details] : []),
  ].join('\n')
}

// The emails for an application that was just saved. `toRecipients` is null when nobody was chosen to get them.
// Replying to it answers the artist, and replying to the confirmation answers the recipients.
//
// The confirmation goes to whatever address was typed in the application, so it only says what we wrote, and none of
// what the artist did. Otherwise, anyone could have us send their own text to any address.
export function applicationEmails({
  profile,
  application,
  recipients,
}: {
  profile: ArtistProfile
  application: ApplicationFields
  recipients: string[]
}): { toRecipients: Email | null; confirmation: Email } {
  const anyone = recipients.length > 0
  return {
    toRecipients: anyone
      ? {
          to: recipients,
          replyTo: [profile.email],
          subject: `Nouvelle candidature : ${profile.name}`,
          text: describeApplication(profile, application),
        }
      : null,
    confirmation: {
      to: [profile.email],
      replyTo: anyone ? recipients : undefined,
      subject: 'parking.radio : nous avons bien reçu votre candidature',
      text: [
        'Bonjour,',
        '',
        "Merci pour votre candidature à parking.radio, nous l'avons bien reçue. Nous regardons les dates et nous vous recontacterons par e-mail.",
        ...(profile.kind === 'collective'
          ? ['', 'Petit rappel pour les takeovers : nous demandons aux collectifs de produire un flyer (carte blanche).']
          : []),
      ].join('\n'),
    },
  }
}
