import type { SessionType } from './fields.js'

// The description each type of session gives it, unless it has its own, or "" for none (see "Descriptions" in
// docs/design/server/sessions.md): what Parking Radio puts on its events on Resident Advisor. The client has a copy (see
// client/src/session-fields.ts), and they must be changed together.

const STREAMED = 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC'

// Word for word as it is on RA, as Parking Radio chose to keep it.
const SYNTH_MEETUP = `SYNTH MEETUPS

Rencontres hebdomadaires de création sonore et audiovisuelle

MANDAT

• Désacraliser l'accès aux contextes de diffusion.

• Partager le savoir concernant les pratiques de création temps-réel numériques.

• Favoriser les processus collaboratifs.

• Archiver les pratiques éphémères.

LE PLAFOND

Vous êtes invitez à tester du contenu visuel, audio réactif ou pas, conçu pour notre plafond.

Voici comment:

Le plafond lumineux regroupe près de 5000 LEDs adressables pour former un "écran".
Ainsi, la création de contenu est simplifié; nul besoin de savoir programmer.

Une approche temps-réel est priorisée afin de rapprocher les artistes de leur médium et de sa diffusion.

En gros, l'artiste se pointe au parking avec son laptop et shoot ses visuels direct dans le plafond en format vidéo. Il suffit d'envoyer de la vidéo au système via réseau en utilisant NDI. La vidéo sera automatiquement redimensionnée (240 x 228 pixels) pour couvrir la surface.`

export const DEFAULT_DESCRIPTIONS: Record<SessionType, string> = {
  'guest-mixes': STREAMED,
  'live-performance': STREAMED,
  takeover: STREAMED,
  'synth-meetup': SYNTH_MEETUP,
  other: '',
}

// What a session's description is: its own, or else the one its type gives it.
export function effectiveDescription({ type, description }: { type: SessionType; description: string }): string {
  return description || DEFAULT_DESCRIPTIONS[type]
}
