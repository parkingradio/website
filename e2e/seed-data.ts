import type { components } from '../client/src/api/schema.d.ts'

// The data seed.ts fills a database with: artists, some with a photo, and their applications, and collectives of some of
// them, with their applications, with the variety the admin pages have to handle. It's the same every time it's seeded,
// except for days, which are counted from the day it's seeded, so that the data always looks current: new applications
// are for the coming months, and those that are done were for past days.

// A profile, as the server returns it, which is also how it can be sent, as it's already cleaned up.
export type Profile = Omit<components['schemas']['Artist'], 'id' | 'createdAt' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'hasPhoto' | 'collectives'>

// The longest bio the server takes (see BIO_MAX_LENGTH in server/src/artists/profile.ts).
const BIO_MAX_LENGTH = 5000

export type SeedArtist = {
  profile: Profile
  // The colour of their photo, for artists who have one.
  photo?: string
  // Whether the artist applied through the "Appliquer" form, which created them along with their first application.
  // Otherwise, an admin added them, and their applications.
  form?: true
  applications: SeedApplication[]
}

type ApplicationFields = components['schemas']['ApplicationFields']
type ApplicationStatus = components['schemas']['ApplicationStatus']

export type SeedApplication = Omit<ApplicationFields, 'dates'> & {
  // The days the artist would like to play, as how many days after the day it's seeded (before, if negative).
  days: number[]
  status: ApplicationStatus
  // How many days before the day it's seeded the artist sent it, or when it's seeded if it's left out. Not for the
  // application sent through the form, which is received when it's sent.
  receivedDaysAgo?: number
}

function artist(profile: Omit<Profile, 'kind' | 'members'>): Profile {
  return { kind: 'artist', members: [], ...profile }
}

function collective(profile: Omit<Profile, 'kind'>): Profile {
  return { kind: 'collective', ...profile }
}

// What admins can leave out of a profile, left out, as for artists brought in from the original Google Form, or whom
// they only know by name.
const LEFT_OUT = { country: '', city: '', genres: [], bio: '', links: {}, email: null, phone: '' } satisfies Partial<Profile>

function application(days: number[], status: ApplicationStatus, fields: Partial<SeedApplication> = {}): SeedApplication {
  return { days, status, timeSlots: [], prestations: ['dj'], otherPrestation: '', details: '', ...fields }
}

const EVENING = { start: '18:00', end: '22:00' }
const AFTERNOON = { start: '13:00', end: '17:00' }
const MIDDAY = { start: '11:00', end: '15:00' }

// A bio of several paragraphs, about as long as a bio can be, so that the pages show one.
const LONG_BIO = Array<string>(16)
  .fill(
    'Né à Rimouski et installé à Montréal depuis quinze ans, Fréquence Boréale passe ses nuits entre les clubs du ' +
      'Mile-End et les entrepôts de Saint-Henri. Ses sets glissent de la deep house vers la techno la plus brute, en ' +
      'passant par des disques introuvables chinés à Berlin, à Détroit et dans les sous-sols de Québec.',
  )
  .join('\n\n')
  .slice(0, BIO_MAX_LENGTH)
  .replace(/\s+\S*$/, '…')

export const SEED_ARTISTS: SeedArtist[] = [
  {
    profile: artist({
      name: 'Clémentine Brûlée',
      country: 'CA',
      city: 'Montréal',
      genres: ['techno', 'acid'],
      bio: "Techno acide et machines analogiques, quelque part entre Détroit et l'Est de Montréal.",
      links: { soundcloud: 'clementine-brulee', instagram: 'clementine.brulee' },
      email: 'clementine@example.com',
      phone: '514 555-0101',
    }),
    photo: '#e4572e',
    applications: [
      application([45, 52], 'new', { timeSlots: [EVENING], receivedDaysAgo: 2 }),
      application([-30], 'done', { timeSlots: [EVENING], receivedDaysAgo: 120 }),
    ],
  },
  {
    profile: artist({
      name: 'Clément Brûlé',
      country: 'FR',
      city: 'Lyon',
      genres: ['house', 'disco'],
      bio: 'House filtrée et disco française.',
      links: { soundcloud: 'clementbrule' },
      email: 'clement.brule@example.com',
      phone: '+33 6 12 34 56 78',
    }),
    applications: [application([70], 'new', { prestations: ['dj', 'vinyl'], receivedDaysAgo: 5 })],
  },
  {
    profile: artist({
      name: 'Fréquence Boréale',
      country: 'CA',
      city: 'Montréal',
      genres: ['deep-house', 'techno', 'minimal'],
      bio: LONG_BIO,
      links: {
        soundcloud: 'frequence-boreale',
        instagram: 'frequence.boreale',
        web: 'https://frequenceboreale.example.com',
        bandcamp: 'frequenceboreale',
        mixcloud: 'frequenceboreale',
        ra: 'frequenceboreale',
        youtube: 'frequenceboreale',
        spotify: '0parkingradioseed00001',
        tiktok: 'frequence.boreale',
      },
      email: 'boreale@example.com',
      phone: '438 555-0102',
    }),
    photo: '#2e86ab',
    applications: [
      application([60, 61, 62, 67, 68, 69], 'accepted', {
        timeSlots: [AFTERNOON, EVENING],
        prestations: ['dj', 'vinyl'],
        details: "J'aimerais faire un set de quatre heures, si c'est possible. Je peux apporter mes propres platines.",
        receivedDaysAgo: 20,
      }),
    ],
  },
  {
    profile: collective({
      name: 'Les Sœurs Ondes',
      members: ['Ondine', 'Marée', 'Écume'],
      country: 'CA',
      city: 'Québec',
      genres: ['ambient', 'experimental'],
      bio: 'Trois synthétiseurs modulaires, une table de mixage et beaucoup de réverbération.',
      links: { bandcamp: 'soeursondes', instagram: 'soeurs.ondes' },
      email: 'soeurs.ondes@example.com',
      phone: '418 555-0103',
    }),
    photo: '#a23b72',
    applications: [
      application([90], 'scheduled', {
        timeSlots: [MIDDAY],
        prestations: ['live-performance'],
        otherPrestation: 'Synthé modulaire',
        receivedDaysAgo: 40,
      }),
    ],
  },
  {
    profile: collective({
      name: 'Collectif Béton',
      members: ['Mathis', 'Rosalie', 'Kofi', 'Yasmine'],
      country: 'CA',
      city: 'Montréal',
      genres: ['hard-techno', 'ebm-industrial'],
      bio: 'Quatre DJ, une seule règle : jamais en dessous de 140 BPM.',
      links: { instagram: 'collectif.beton', ra: 'collectifbeton' },
      email: 'beton@example.com',
      phone: '514 555-0104',
    }),
    applications: [
      application([-60], 'done', { timeSlots: [EVENING], receivedDaysAgo: 150 }),
      application([30, 31], 'accepted', { timeSlots: [EVENING], receivedDaysAgo: 10 }),
    ],
  },
  {
    profile: artist({
      name: 'DJ Poutine',
      country: 'CA',
      city: 'Sherbrooke',
      genres: ['baile-funk', 'footwork-juke'],
      bio: 'Baile funk et footwork, servis chauds.',
      links: { soundcloud: 'djpoutine', tiktok: 'djpoutine' },
      email: 'DJ.Poutine@Example.com',
      phone: '819 555-0105',
    }),
    photo: '#f18f01',
    form: true,
    applications: [
      application([75, 82], 'new', { timeSlots: [EVENING], details: "C'est ma première candidature, j'espère que ça marche !" }),
    ],
  },
  {
    profile: artist({
      name: 'Mélisande',
      country: 'BE',
      city: 'Bruxelles',
      genres: ['italo', 'nu-disco', 'synthwave'],
      bio: 'Italo disco et synthés des années quatre-vingt.',
      links: { instagram: 'melisande.music', spotify: '0parkingradioseed00002' },
      email: 'melisande@example.org',
      phone: '+32 470 12 34 56',
    }),
    form: true,
    applications: [application([100, 101, 102], 'new', { prestations: ['dj', 'live-performance'] })],
  },
  {
    profile: artist({
      name: 'Kwame Asante',
      country: 'GH',
      city: 'Accra',
      genres: ['afrobeat', 'afro-house', 'amapiano'],
      bio: "Afrobeat et amapiano, d'Accra à Montréal.",
      links: { soundcloud: 'kwameasante', youtube: 'kwameasante' },
      email: 'kwame@example.com',
      phone: '+233 24 123 4567',
    }),
    photo: '#3b1f2b',
    form: true,
    applications: [application([65], 'rejected', { timeSlots: [AFTERNOON], prestations: ['dj', 'rap'] })],
  },
  {
    profile: artist({
      name: 'Rosalie Tremblay',
      country: 'CA',
      city: 'Trois-Rivières',
      genres: ['jazz', 'funk-soul'],
      bio: 'Saxophoniste et DJ, toujours entre deux disques de jazz.',
      links: { instagram: 'rosalie.tremblay' },
      email: 'rosalie.tremblay@example.com',
      phone: '819 555-0107',
    }),
    form: true,
    applications: [
      application([55], 'accepted', {
        prestations: ['full-band'],
        details: 'Nous sommes cinq musiciens. Avez-vous un piano ?',
      }),
    ],
  },
  {
    profile: artist({
      name: 'Noé Lavigne',
      ...LEFT_OUT,
      bio: "Venu par l'ancien formulaire Google, qui ne demandait ni la ville ni les liens.",
      email: 'noe.lavigne@example.com',
    }),
    applications: [application([-200], 'done', { receivedDaysAgo: 300 })],
  },
  {
    // Known only by name.
    profile: artist({ name: 'Marée Basse', ...LEFT_OUT }),
    applications: [application([-180], 'done', { receivedDaysAgo: 280 })],
  },
  {
    profile: artist({
      name: 'Inès Ferreira',
      ...LEFT_OUT,
      city: 'Lisbonne',
      bio: 'Ville connue, pays inconnu.',
      email: 'ines.ferreira@example.com',
    }),
    applications: [application([-150, -149], 'rejected', { receivedDaysAgo: 250 })],
  },
  {
    profile: artist({
      name: 'Takeshi Mori',
      ...LEFT_OUT,
      country: 'JP',
      genres: ['ambient', 'downtempo'],
      bio: 'Pays connu, ville inconnue.',
      email: 'takeshi.mori@example.com',
    }),
    applications: [application([-100], 'done', { prestations: ['live-performance'], receivedDaysAgo: 210 })],
  },
  {
    profile: artist({
      name: 'Bassline Gaspésie',
      ...LEFT_OUT,
      links: { soundcloud: 'basslinegaspesie' },
      bio: 'Drum & bass depuis Gaspé.',
      email: 'bassline.gaspesie@example.com',
    }),
    applications: [],
  },
  {
    profile: artist({
      name: 'Amélie Côté',
      country: 'CA',
      city: 'Gatineau',
      genres: ['drum-and-bass', 'jungle'],
      bio: 'Jungle et drum & bass, avec des breaks plein les poches.',
      links: { soundcloud: 'ameliecote', mixcloud: 'ameliecote' },
      email: 'amelie.cote@example.com',
      phone: '819 555-0108',
    }),
    photo: '#6a994e',
    applications: [
      application([20], 'scheduled', { timeSlots: [EVENING], receivedDaysAgo: 60 }),
      application([-90], 'done', { timeSlots: [EVENING], receivedDaysAgo: 180 }),
      application([-365], 'done', { receivedDaysAgo: 400 }),
    ],
  },
  {
    profile: artist({
      name: 'Émile Gagnon',
      country: 'CA',
      city: 'Montréal',
      genres: ['hip-hop', 'rap', 'trap'],
      bio: 'Rappeur et beatmaker du Plateau.',
      links: { instagram: 'emilegagnon', youtube: 'emilegagnon', spotify: '0parkingradioseed00003' },
      email: 'emile.gagnon@example.com',
      phone: '514 555-0109',
    }),
    applications: [
      application([40], 'new', { timeSlots: [AFTERNOON, EVENING], prestations: ['rap'], receivedDaysAgo: 1 }),
    ],
  },
  {
    profile: artist({
      name: 'Sofía Ramírez',
      country: 'MX',
      city: 'Ciudad de México',
      genres: ['cumbia', 'reggaeton-latin'],
      bio: 'Cumbia rebajada et reggaeton, de Mexico à Montréal.',
      links: { soundcloud: 'sofiaramirez', instagram: 'sofia.ramirez' },
      email: 'sofia.ramirez@example.com',
      phone: '+52 55 1234 5678',
    }),
    photo: '#bc4b51',
    applications: [application([85, 86], 'new', { prestations: ['dj', 'vinyl'], receivedDaysAgo: 3 })],
  },
  {
    profile: artist({
      name: 'Hugo Bellerose',
      country: 'CH',
      city: 'Genève',
      genres: ['minimal', 'tech-house'],
      bio: 'Minimal suisse, précise comme une horloge.',
      links: { ra: 'hugobellerose' },
      email: 'hugo.bellerose@example.com',
      phone: '+41 79 123 45 67',
    }),
    applications: [application([110], 'rejected', { receivedDaysAgo: 15 })],
  },
  {
    profile: artist({
      name: 'Maya Chen',
      country: 'US',
      city: 'New York',
      genres: ['uk-garage', 'bass', 'dubstep'],
      bio: 'UK garage and bass music from Brooklyn.',
      links: { soundcloud: 'mayachen', instagram: 'maya.chen', web: 'https://mayachen.example.com' },
      email: 'maya.chen@example.com',
      phone: '+1 718 555 0110',
    }),
    photo: '#5b8e7d',
    applications: [
      application([35], 'accepted', { timeSlots: [EVENING], receivedDaysAgo: 25 }),
      application([125], 'new', { timeSlots: [EVENING], receivedDaysAgo: 4 }),
    ],
  },
  {
    profile: artist({
      name: 'Léa Dubois',
      country: 'FR',
      city: 'Paris',
      genres: ['electro', 'breakbeat'],
      bio: 'Électro et breakbeat, sans compromis.',
      links: { soundcloud: 'leadubois' },
      email: 'lea.dubois@example.com',
      phone: '+33 7 98 76 54 32',
    }),
    applications: [application([95], 'new', { receivedDaysAgo: 6 })],
  },
  {
    profile: artist({
      name: 'Félix Ouellet',
      country: 'CA',
      city: 'Saguenay',
      genres: ['punk', 'indie-rock'],
      bio: 'Un groupe punk qui joue fort, très fort.',
      links: { bandcamp: 'felixouellet', instagram: 'felix.ouellet' },
      email: 'felix.ouellet@example.com',
      phone: '418 555-0111',
    }),
    applications: [application([50], 'scheduled', { prestations: ['full-band'], receivedDaysAgo: 35 })],
  },
  {
    profile: collective({
      name: 'Radio Dub Laurentides',
      members: ['Jah Pierre'],
      country: 'CA',
      city: 'Saint-Jérôme',
      genres: ['reggae-dub', 'dancehall'],
      bio: 'Un sound system, un seul membre, beaucoup de basses.',
      links: { mixcloud: 'radiodublaurentides' },
      email: 'dub.laurentides@example.com',
      phone: '450 555-0112',
    }),
    photo: '#7d5ba6',
    applications: [application([-10], 'done', { timeSlots: [MIDDAY, AFTERNOON], receivedDaysAgo: 90 })],
  },
  {
    profile: artist({
      name: 'Zoé Nguyen',
      country: 'CA',
      city: 'Laval',
      genres: ['pop', 'rnb'],
      bio: 'Pop et R&B, avec des voix superposées en direct.',
      links: { instagram: 'zoe.nguyen', tiktok: 'zoenguyen' },
      email: 'zoe.nguyen@example.com',
      phone: '450 555-0113',
    }),
    applications: [
      application([80], 'new', { prestations: ['live-performance'], otherPrestation: 'Chant', receivedDaysAgo: 7 }),
    ],
  },
  {
    profile: artist({
      name: 'Gabriel Roy',
      country: 'CA',
      city: 'Montréal',
      genres: ['trance', 'hardcore-gabber'],
      bio: 'Trance euphorique le jour, gabber la nuit.',
      links: { soundcloud: 'gabrielroy' },
      email: 'gabriel.roy@example.com',
      phone: '514 555-0114',
    }),
    applications: [application([25], 'rejected', { receivedDaysAgo: 30 })],
  },
  {
    profile: artist({
      name: 'Océane Lefebvre',
      country: 'CA',
      city: 'Montréal',
      genres: ['noise', 'experimental', 'leftfield'],
      bio: 'Bruit blanc, larsen et cassettes.',
      links: { bandcamp: 'oceanelefebvre' },
      email: 'oceane.lefebvre@example.com',
      phone: '514 555-0115',
    }),
    photo: '#264653',
    applications: [
      application([105], 'new', {
        prestations: [],
        otherPrestation: 'Installation sonore',
        details: 'Il me faudrait environ deux heures pour installer.',
        receivedDaysAgo: 8,
      }),
    ],
  },
  {
    profile: artist({
      name: 'Antoine Bergeron',
      country: 'CA',
      city: 'Longueuil',
      genres: ['house', 'tech-house'],
      bio: 'House et tech house pour les terrasses.',
      links: { instagram: 'antoine.bergeron' },
      email: 'antoine.bergeron@example.com',
      phone: '450 555-0116',
    }),
    applications: [application([-45], 'done', { timeSlots: [MIDDAY], receivedDaysAgo: 100 })],
  },
  {
    profile: artist({
      name: 'Chloé Pelletier',
      country: 'CA',
      city: 'Rimouski',
      genres: ['downtempo', 'ambient'],
      bio: 'Musique pour regarder le fleuve.',
      links: { soundcloud: 'chloepelletier', bandcamp: 'chloepelletier' },
      email: 'chloe.pelletier@example.com',
      phone: '418 555-0117',
    }),
    applications: [application([130, 131, 132], 'new', { timeSlots: [MIDDAY], receivedDaysAgo: 2 })],
  },
  {
    profile: artist({
      name: 'Olivier Fortin',
      country: 'CA',
      city: 'Montréal',
      genres: ['disco', 'funk-soul'],
      bio: 'Seulement des 45 tours.',
      links: { instagram: 'olivier.fortin' },
      email: 'olivier.fortin@example.com',
      phone: '514 555-0118',
    }),
    applications: [application([15], 'accepted', { prestations: ['vinyl'], receivedDaysAgo: 45 })],
  },
  {
    profile: artist({
      name: 'Jeanne Morin',
      country: 'CA',
      city: 'Québec',
      genres: ['techno'],
      bio: 'Techno hypnotique.',
      links: { soundcloud: 'jeannemorin' },
      email: 'jeanne.morin@example.com',
      phone: '418 555-0119',
    }),
    photo: '#e9c46a',
    applications: [],
  },
  {
    profile: artist({
      name: 'DJ 2',
      country: 'CA',
      city: 'Montréal',
      genres: ['house'],
      bio: 'Pour vérifier que « DJ 2 » vient avant « DJ 10 ».',
      links: { soundcloud: 'dj-deux' },
      email: 'dj2@example.com',
      phone: '514 555-0120',
    }),
    applications: [application([140], 'new', { receivedDaysAgo: 9 })],
  },
  {
    profile: artist({
      name: 'DJ 10',
      country: 'CA',
      city: 'Montréal',
      genres: ['house'],
      bio: 'Pour vérifier que « DJ 10 » vient après « DJ 2 ».',
      links: { soundcloud: 'dj-dix' },
      email: 'dj10@example.com',
      phone: '514 555-0121',
    }),
    applications: [application([141], 'new', { receivedDaysAgo: 9 })],
  },
]

// A collective's profile, as the server returns it, without its members.
export type CollectiveProfile = Omit<
  components['schemas']['Collective'],
  'id' | 'createdAt' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'hasPhoto' | 'members'
>

export type SeedCollective = {
  profile: CollectiveProfile
  // Its members, in order: artists of SEED_ARTISTS, by their email, or by their name for those without one, and new
  // artists, by their name, whom the server creates along with the collective.
  members: ({ seeded: string } | { name: string })[]
  // The colour of its photo, for collectives that have one.
  photo?: string
  // Its applications, which an admin added.
  applications: SeedApplication[]
}

// Seeded after the artists, whom they have as members. Unlike the artists whose `kind` is "collective", these are
// collectives of their own, with artists as members.
export const SEED_COLLECTIVES: SeedCollective[] = [
  {
    profile: {
      name: 'Onde Commune',
      country: 'CA',
      city: 'Montréal',
      description: 'Trois DJ montréalais qui jouent ensemble, à tour de rôle, des nuits entières.',
      links: { soundcloud: 'onde-commune', instagram: 'onde.commune' },
      email: 'onde.commune@example.com',
      phone: '514 555-0130',
    },
    members: [{ seeded: 'clementine@example.com' }, { seeded: 'boreale@example.com' }, { seeded: 'kwame@example.com' }],
    photo: '#ff7f51',
    applications: [
      application([58], 'accepted', {
        timeSlots: [EVENING],
        prestations: ['dj'],
        otherPrestation: 'B2B2B',
        details: 'Nous aimerions jouer toute la soirée, chacun son tour.',
        receivedDaysAgo: 12,
      }),
    ],
  },
  {
    // With what admins can leave out left out, a member who's also in another collective, one who's known only by
    // name, and one whom the server creates with the collective. Its contact is one of its members, with the same
    // email.
    profile: { name: 'Les Nuits Basses', country: '', city: '', description: '', links: {}, email: 'kwame@example.com', phone: '' },
    members: [{ seeded: 'kwame@example.com' }, { seeded: 'Marée Basse' }, { name: 'Sable Mouvant' }],
    applications: [application([120], 'new', { prestations: ['live-performance'], receivedDaysAgo: 1 })],
  },
]
