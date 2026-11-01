import { describe, expect, it } from 'vitest'
import type { ApplicantProfile } from '../artists/profile.js'
import { newMember } from '../collectives/store.js'
import type { Applied } from './applicant.js'
import { applicationEmails, describeApplication } from './emails.js'
import type { ApplicationFields } from './fields.js'

function profile(changes: Partial<ApplicantProfile> = {}): ApplicantProfile {
  return {
    name: 'DJ Test',
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

function artist(changes: Partial<ApplicantProfile> = {}): Applied {
  return { artist: profile(changes) }
}

// A collective, as it's saved when it applies.
function collective(): Applied {
  const { bio, genres, ...rest } = profile({ name: 'Le Collectif', email: 'collectif@example.com' })
  return {
    collective: { ...rest, description: bio },
    members: [newMember('Une', null, genres), newMember('Deux', null, ['ebm-industrial', 'acid'])],
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
    expect(describeApplication(artist(), fields())).toBe(
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

  it("describes a collective, its artists and their genres, its contact and its description", () => {
    const text = describeApplication(collective(), fields())
    expect(text).toMatch(
      new RegExp(
        [
          '^Collectif : Le Collectif',
          'Artistes du collectif : Une, Deux',
          'Ville : Québec, Canada',
          // Each one once.
          'Genres : techno, EBM / industriel, acid',
          'E-mail du contact : collectif@example.com',
          'Téléphone du contact : 418 555-0123',
          '',
        ].join('\n'),
      ),
    )
    expect(text).toContain('\nDescription :\nUne bio.\nSur deux lignes.\n')
    expect(text).not.toContain('Bio :')
  })

  it('says when any time works, and leaves out what the artist left blank', () => {
    const text = describeApplication(artist(), fields({ timeSlots: [], prestations: [], otherPrestation: '', details: '' }))
    expect(text).toContain('Plages horaires : à toute heure\nType de prestation : —\n')
    expect(text).not.toContain('Questions ou détails')
    expect(text.endsWith('Sur deux lignes.')).toBe(true)
  })
})

describe('applicationEmails', () => {
  it('emails the recipients everything the artist sent, without their photo, and replies go to the artist', () => {
    const { toRecipients } = applicationEmails({ applied: artist(), application: fields(), recipients: ['equipe@example.com'] })
    expect(toRecipients).toEqual({
      to: ['equipe@example.com'],
      replyTo: ['artiste@example.com'],
      subject: 'Nouvelle candidature : DJ Test',
      text: describeApplication(artist(), fields()),
    })
  })

  it('confirms the application to the artist, with none of what they wrote, and replies go to the recipients', () => {
    const { confirmation } = applicationEmails({ applied: artist(), application: fields(), recipients: ['equipe@example.com'] })
    expect(confirmation).toEqual({
      to: ['artiste@example.com'],
      replyTo: ['equipe@example.com'],
      subject: 'parking.radio : nous avons bien reçu votre candidature',
      text: "Bonjour,\n\nMerci pour votre candidature à parking.radio, nous l'avons bien reçue. Nous regardons les dates et nous vous recontacterons par e-mail.",
    })
  })

  it('reminds collectives to make a flyer', () => {
    const { confirmation } = applicationEmails({ applied: collective(), application: fields(), recipients: [] })
    expect(confirmation.text).toContain('nous demandons aux collectifs de produire un flyer')
  })

  it("goes to a collective's contact, and replies to it too", () => {
    const { toRecipients, confirmation } = applicationEmails({ applied: collective(), application: fields(), recipients: ['equipe@example.com'] })
    expect(toRecipients).toMatchObject({ replyTo: ['collectif@example.com'], subject: 'Nouvelle candidature : Le Collectif' })
    expect(confirmation.to).toEqual(['collectif@example.com'])
  })

  it('only confirms the application when there are no recipients', () => {
    const emails = applicationEmails({ applied: artist(), application: fields(), recipients: [] })
    expect(emails.toRecipients).toBeNull()
    expect(emails.confirmation.replyTo).toBeUndefined()
  })
})
