import { describe, expect, it } from 'vitest'
import type { ApplicationFields, PrestationId } from 'shared/applications'
import { applicationEmails, describeApplication } from './application-emails.js'
import type { Profile } from './artist-profile.js'

function profile(changes: Partial<Profile> = {}): Profile {
  return {
    kind: 'artist',
    name: 'DJ Test',
    members: [],
    country: 'CA',
    city: 'Québec',
    genres: ['techno', 'ebm-industrial'],
    bio: 'Une bio.\nSur deux lignes.',
    links: { instagram: 'parking.radio', soundcloud: 'parkingdotradio' },
    email: 'artiste@example.com',
    phone: '418 555-0123',
    ...changes,
  }
}

function fields(changes: Partial<ApplicationFields> = {}): ApplicationFields {
  return {
    dates: ['2027-01-08', '2027-01-15'],
    timeSlots: [
      { start: '14:00', end: '18:00' },
      { start: '18:00', end: '22:00' },
    ],
    prestations: ['dj', 'vinyl'],
    otherPrestation: 'Synthé modulaire',
    details: 'Une question ?',
    ...changes,
  }
}

describe('describeApplication', () => {
  it('describes everything the artist sent, in French', () => {
    expect(describeApplication(profile(), fields())).toBe(
      [
        'Artiste : DJ Test',
        'Ville : Québec, Canada',
        'Genres : techno, EBM / industriel',
        'E-mail : artiste@example.com',
        'Téléphone : 418 555-0123',
        '',
        'Liens :',
        // In the order the admin pages list them.
        '  SoundCloud : https://soundcloud.com/parkingdotradio',
        '  Instagram : https://instagram.com/parking.radio',
        '',
        'Dates souhaitées :',
        '  vendredi 8 janvier 2027',
        '  vendredi 15 janvier 2027',
        'Plages horaires : 14:00 à 18:00, 18:00 à 22:00',
        // By their names, then the other one.
        'Type de prestation : DJ, Vinyl, autre : Synthé modulaire',
        '',
        'Bio :',
        'Une bio.\nSur deux lignes.',
        '',
        'Questions ou détails :',
        'Une question ?',
      ].join('\n'),
    )
  })

  it("names a collective's artists", () => {
    const text = describeApplication(profile({ kind: 'collective', name: 'Le Collectif', members: ['Une', 'Deux'] }), fields())
    expect(text).toMatch(/^Collectif : Le Collectif\nArtistes du collectif : Une, Deux\n/)
  })

  it('names a prestation that is no longer in the list by its id', () => {
    const text = describeApplication(profile(), fields({ prestations: ['dj', 'theremin' as PrestationId], otherPrestation: '' }))
    expect(text).toContain('Type de prestation : DJ, theremin\n')
  })

  it('says when any time works, and leaves out what the artist left blank', () => {
    const text = describeApplication(profile(), fields({ timeSlots: [], prestations: [], otherPrestation: '', details: '' }))
    expect(text).toContain('Plages horaires : à toute heure\nType de prestation : —\n')
    expect(text).not.toContain('Questions ou détails')
    expect(text.endsWith('Sur deux lignes.')).toBe(true)
  })
})

describe('applicationEmails', () => {
  it('emails the recipients everything the artist sent, without their photo, and replies go to the artist', () => {
    const { toRecipients } = applicationEmails({ profile: profile(), application: fields(), recipients: ['equipe@example.com'] })
    expect(toRecipients).toEqual({
      to: ['equipe@example.com'],
      replyTo: ['artiste@example.com'],
      subject: 'Nouvelle candidature : DJ Test',
      text: describeApplication(profile(), fields()),
    })
  })

  it('confirms the application to the artist, with none of what they wrote, and replies go to the recipients', () => {
    const { confirmation } = applicationEmails({ profile: profile(), application: fields(), recipients: ['equipe@example.com'] })
    expect(confirmation).toEqual({
      to: ['artiste@example.com'],
      replyTo: ['equipe@example.com'],
      subject: 'parking.radio : nous avons bien reçu votre candidature',
      text: "Bonjour,\n\nMerci pour votre candidature à parking.radio, nous l'avons bien reçue. Nous regardons les dates et nous vous recontacterons par e-mail.",
    })
  })

  it('reminds collectives to make a flyer', () => {
    const collective = profile({ kind: 'collective', members: ['Une'] })
    const { confirmation } = applicationEmails({ profile: collective, application: fields(), recipients: [] })
    expect(confirmation.text).toContain('nous demandons aux collectifs de produire un flyer')
  })

  it('only confirms the application when there are no recipients', () => {
    const emails = applicationEmails({ profile: profile(), application: fields(), recipients: [] })
    expect(emails.toRecipients).toBeNull()
    expect(emails.confirmation.replyTo).toBeUndefined()
  })
})
