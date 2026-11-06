import type { components } from '../client/src/api/schema.d.ts'

// The data seed.ts fills a database with: artists, some with a photo, and their applications, collectives of some of
// them, with their applications, and sessions and their sets, with the variety the admin pages have to handle. It's the
// same every time it's seeded, except for days, which are counted from the day it's seeded, so that the data always
// looks current: new applications and planned sessions are for the coming months, and those that are done were for past
// days.

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

// What admins can leave out of a profile, left out, as for artists brought in from the original Google Form, or whom
// they only know by name.
const LEFT_OUT = { country: '', city: '', genres: [], bio: '', links: {}, email: null, phone: '' } satisfies Partial<Profile>

function application(days: number[], status: ApplicationStatus, fields: Partial<SeedApplication> = {}): SeedApplication {
  return { days, status, timeSlots: [], performanceTypes: ['dj'], otherPerformanceType: '', details: '', ...fields }
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
    profile: {
      name: 'Clémentine Brûlée',
      country: 'CA',
      city: 'Montréal',
      genres: ['techno', 'acid'],
      bio: "Techno acide et machines analogiques, quelque part entre Détroit et l'Est de Montréal.",
      links: { soundcloud: 'clementine-brulee', instagram: 'clementine.brulee' },
      email: 'clementine@example.com',
      phone: '514 555-0101',
    },
    photo: '#e4572e',
    applications: [
      application([45, 52], 'new', { timeSlots: [EVENING], receivedDaysAgo: 2 }),
      application([-30], 'done', { timeSlots: [EVENING], receivedDaysAgo: 120 }),
    ],
  },
  {
    profile: {
      name: 'Clément Brûlé',
      country: 'FR',
      city: 'Lyon',
      genres: ['house', 'disco'],
      bio: 'House filtrée et disco française.',
      links: { soundcloud: 'clementbrule' },
      email: 'clement.brule@example.com',
      phone: '+33 6 12 34 56 78',
    },
    applications: [application([70], 'new', { performanceTypes: ['dj', 'vinyl'], receivedDaysAgo: 5 })],
  },
  {
    profile: {
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
    },
    photo: '#2e86ab',
    applications: [
      application([60, 61, 62, 67, 68, 69], 'accepted', {
        timeSlots: [AFTERNOON, EVENING],
        performanceTypes: ['dj', 'vinyl'],
        details: "J'aimerais faire un set de quatre heures, si c'est possible. Je peux apporter mes propres platines.",
        receivedDaysAgo: 20,
      }),
    ],
  },
  {
    profile: {
      name: 'DJ Poutine',
      country: 'CA',
      city: 'Sherbrooke',
      genres: ['baile-funk', 'footwork-juke'],
      bio: 'Baile funk et footwork, servis chauds.',
      links: { soundcloud: 'djpoutine', tiktok: 'djpoutine' },
      email: 'DJ.Poutine@Example.com',
      phone: '819 555-0105',
    },
    photo: '#f18f01',
    form: true,
    applications: [
      application([75, 82], 'new', { timeSlots: [EVENING], details: "C'est ma première candidature, j'espère que ça marche !" }),
    ],
  },
  {
    profile: {
      name: 'Mélisande',
      country: 'BE',
      city: 'Bruxelles',
      genres: ['italo', 'nu-disco', 'synthwave'],
      bio: 'Italo disco et synthés des années quatre-vingt.',
      links: { instagram: 'melisande.music', spotify: '0parkingradioseed00002' },
      email: 'melisande@example.org',
      phone: '+32 470 12 34 56',
    },
    form: true,
    applications: [application([100, 101, 102], 'new', { performanceTypes: ['dj', 'live-performance'] })],
  },
  {
    profile: {
      name: 'Kwame Asante',
      country: 'GH',
      city: 'Accra',
      genres: ['afrobeat', 'afro-house', 'amapiano'],
      bio: "Afrobeat et amapiano, d'Accra à Montréal.",
      links: { soundcloud: 'kwameasante', youtube: 'kwameasante' },
      email: 'kwame@example.com',
      phone: '+233 24 123 4567',
    },
    photo: '#3b1f2b',
    form: true,
    applications: [application([65], 'rejected', { timeSlots: [AFTERNOON], performanceTypes: ['dj', 'rap'] })],
  },
  {
    profile: {
      name: 'Rosalie Tremblay',
      country: 'CA',
      city: 'Trois-Rivières',
      genres: ['jazz', 'funk-soul'],
      bio: 'Saxophoniste et DJ, toujours entre deux disques de jazz.',
      links: { instagram: 'rosalie.tremblay' },
      email: 'rosalie.tremblay@example.com',
      phone: '819 555-0107',
    },
    form: true,
    applications: [
      application([55], 'accepted', {
        performanceTypes: ['full-band'],
        details: 'Nous sommes cinq musiciens. Avez-vous un piano ?',
      }),
    ],
  },
  {
    profile: {
      name: 'Noé Lavigne',
      ...LEFT_OUT,
      bio: "Venu par l'ancien formulaire Google, qui ne demandait ni la ville ni les liens.",
      email: 'noe.lavigne@example.com',
    },
    applications: [application([-200], 'done', { receivedDaysAgo: 300 })],
  },
  {
    // Known only by name.
    profile: { name: 'Marée Basse', ...LEFT_OUT },
    applications: [application([-180], 'done', { receivedDaysAgo: 280 })],
  },
  {
    profile: {
      name: 'Inès Ferreira',
      ...LEFT_OUT,
      city: 'Lisbonne',
      bio: 'Ville connue, pays inconnu.',
      email: 'ines.ferreira@example.com',
    },
    applications: [application([-150, -149], 'rejected', { receivedDaysAgo: 250 })],
  },
  {
    profile: {
      name: 'Takeshi Mori',
      ...LEFT_OUT,
      country: 'JP',
      genres: ['ambient', 'downtempo'],
      bio: 'Pays connu, ville inconnue.',
      email: 'takeshi.mori@example.com',
    },
    applications: [application([-100], 'done', { performanceTypes: ['live-performance'], receivedDaysAgo: 210 })],
  },
  {
    profile: {
      name: 'Bassline Gaspésie',
      ...LEFT_OUT,
      links: { soundcloud: 'basslinegaspesie' },
      bio: 'Drum & bass depuis Gaspé.',
      email: 'bassline.gaspesie@example.com',
    },
    applications: [],
  },
  {
    profile: {
      name: 'Amélie Côté',
      country: 'CA',
      city: 'Gatineau',
      genres: ['drum-and-bass', 'jungle'],
      bio: 'Jungle et drum & bass, avec des breaks plein les poches.',
      links: { soundcloud: 'ameliecote', mixcloud: 'ameliecote' },
      email: 'amelie.cote@example.com',
      phone: '819 555-0108',
    },
    photo: '#6a994e',
    applications: [
      application([20], 'scheduled', { timeSlots: [EVENING], receivedDaysAgo: 60 }),
      application([-90], 'done', { timeSlots: [EVENING], receivedDaysAgo: 180 }),
      application([-365], 'done', { receivedDaysAgo: 400 }),
    ],
  },
  {
    profile: {
      name: 'Émile Gagnon',
      country: 'CA',
      city: 'Montréal',
      genres: ['hip-hop', 'rap', 'trap'],
      bio: 'Rappeur et beatmaker du Plateau.',
      links: { instagram: 'emilegagnon', youtube: 'emilegagnon', spotify: '0parkingradioseed00003' },
      email: 'emile.gagnon@example.com',
      phone: '514 555-0109',
    },
    applications: [
      application([40], 'new', { timeSlots: [AFTERNOON, EVENING], performanceTypes: ['rap'], receivedDaysAgo: 1 }),
    ],
  },
  {
    profile: {
      name: 'Sofía Ramírez',
      country: 'MX',
      city: 'Ciudad de México',
      genres: ['cumbia', 'reggaeton-latin'],
      bio: 'Cumbia rebajada et reggaeton, de Mexico à Montréal.',
      links: { soundcloud: 'sofiaramirez', instagram: 'sofia.ramirez' },
      email: 'sofia.ramirez@example.com',
      phone: '+52 55 1234 5678',
    },
    photo: '#bc4b51',
    applications: [application([85, 86], 'new', { performanceTypes: ['dj', 'vinyl'], receivedDaysAgo: 3 })],
  },
  {
    profile: {
      name: 'Hugo Bellerose',
      country: 'CH',
      city: 'Genève',
      genres: ['minimal', 'tech-house'],
      bio: 'Minimal suisse, précise comme une horloge.',
      links: { ra: 'hugobellerose' },
      email: 'hugo.bellerose@example.com',
      phone: '+41 79 123 45 67',
    },
    applications: [application([110], 'rejected', { receivedDaysAgo: 15 })],
  },
  {
    profile: {
      name: 'Maya Chen',
      country: 'US',
      city: 'New York',
      genres: ['uk-garage', 'bass', 'dubstep'],
      bio: 'UK garage and bass music from Brooklyn.',
      links: { soundcloud: 'mayachen', instagram: 'maya.chen', web: 'https://mayachen.example.com' },
      email: 'maya.chen@example.com',
      phone: '+1 718 555 0110',
    },
    photo: '#5b8e7d',
    applications: [
      application([35], 'accepted', { timeSlots: [EVENING], receivedDaysAgo: 25 }),
      application([125], 'new', { timeSlots: [EVENING], receivedDaysAgo: 4 }),
    ],
  },
  {
    profile: {
      name: 'Léa Dubois',
      country: 'FR',
      city: 'Paris',
      genres: ['electro', 'breakbeat'],
      bio: 'Électro et breakbeat, sans compromis.',
      links: { soundcloud: 'leadubois' },
      email: 'lea.dubois@example.com',
      phone: '+33 7 98 76 54 32',
    },
    applications: [application([95], 'new', { receivedDaysAgo: 6 })],
  },
  {
    profile: {
      name: 'Félix Ouellet',
      country: 'CA',
      city: 'Saguenay',
      genres: ['punk', 'indie-rock'],
      bio: 'Un groupe punk qui joue fort, très fort.',
      links: { bandcamp: 'felixouellet', instagram: 'felix.ouellet' },
      email: 'felix.ouellet@example.com',
      phone: '418 555-0111',
    },
    applications: [application([50], 'scheduled', { performanceTypes: ['full-band'], receivedDaysAgo: 35 })],
  },
  {
    profile: {
      name: 'Zoé Nguyen',
      country: 'CA',
      city: 'Laval',
      genres: ['pop', 'rnb'],
      bio: 'Pop et R&B, avec des voix superposées en direct.',
      links: { instagram: 'zoe.nguyen', tiktok: 'zoenguyen' },
      email: 'zoe.nguyen@example.com',
      phone: '450 555-0113',
    },
    applications: [
      application([80], 'new', { performanceTypes: ['live-performance'], otherPerformanceType: 'Chant', receivedDaysAgo: 7 }),
    ],
  },
  {
    profile: {
      name: 'Gabriel Roy',
      country: 'CA',
      city: 'Montréal',
      genres: ['trance', 'hardcore-gabber'],
      bio: 'Trance euphorique le jour, gabber la nuit.',
      links: { soundcloud: 'gabrielroy' },
      email: 'gabriel.roy@example.com',
      phone: '514 555-0114',
    },
    applications: [application([25], 'rejected', { receivedDaysAgo: 30 })],
  },
  {
    profile: {
      name: 'Océane Lefebvre',
      country: 'CA',
      city: 'Montréal',
      genres: ['noise', 'experimental', 'leftfield'],
      bio: 'Bruit blanc, larsen et cassettes.',
      links: { bandcamp: 'oceanelefebvre' },
      email: 'oceane.lefebvre@example.com',
      phone: '514 555-0115',
    },
    photo: '#264653',
    applications: [
      application([105], 'new', {
        performanceTypes: [],
        otherPerformanceType: 'Installation sonore',
        details: 'Il me faudrait environ deux heures pour installer.',
        receivedDaysAgo: 8,
      }),
    ],
  },
  {
    profile: {
      name: 'Antoine Bergeron',
      country: 'CA',
      city: 'Longueuil',
      genres: ['house', 'tech-house'],
      bio: 'House et tech house pour les terrasses.',
      links: { instagram: 'antoine.bergeron' },
      email: 'antoine.bergeron@example.com',
      phone: '450 555-0116',
    },
    applications: [application([-45], 'done', { timeSlots: [MIDDAY], receivedDaysAgo: 100 })],
  },
  {
    profile: {
      name: 'Chloé Pelletier',
      country: 'CA',
      city: 'Rimouski',
      genres: ['downtempo', 'ambient'],
      bio: 'Musique pour regarder le fleuve.',
      links: { soundcloud: 'chloepelletier', bandcamp: 'chloepelletier' },
      email: 'chloe.pelletier@example.com',
      phone: '418 555-0117',
    },
    applications: [application([130, 131, 132], 'new', { timeSlots: [MIDDAY], receivedDaysAgo: 2 })],
  },
  {
    profile: {
      name: 'Olivier Fortin',
      country: 'CA',
      city: 'Montréal',
      genres: ['disco', 'funk-soul'],
      bio: 'Seulement des 45 tours.',
      links: { instagram: 'olivier.fortin' },
      email: 'olivier.fortin@example.com',
      phone: '514 555-0118',
    },
    applications: [application([15], 'accepted', { performanceTypes: ['vinyl'], receivedDaysAgo: 45 })],
  },
  {
    profile: {
      name: 'Jeanne Morin',
      country: 'CA',
      city: 'Québec',
      genres: ['techno'],
      bio: 'Techno hypnotique.',
      links: { soundcloud: 'jeannemorin' },
      email: 'jeanne.morin@example.com',
      phone: '418 555-0119',
    },
    photo: '#e9c46a',
    applications: [],
  },
  {
    profile: {
      name: 'DJ 2',
      country: 'CA',
      city: 'Montréal',
      genres: ['house'],
      bio: 'Pour vérifier que « DJ 2 » vient avant « DJ 10 ».',
      links: { soundcloud: 'dj-deux' },
      email: 'dj2@example.com',
      phone: '514 555-0120',
    },
    applications: [application([140], 'new', { receivedDaysAgo: 9 })],
  },
  {
    profile: {
      name: 'DJ 10',
      country: 'CA',
      city: 'Montréal',
      genres: ['house'],
      bio: 'Pour vérifier que « DJ 10 » vient après « DJ 2 ».',
      links: { soundcloud: 'dj-dix' },
      email: 'dj10@example.com',
      phone: '514 555-0121',
    },
    applications: [application([141], 'new', { receivedDaysAgo: 9 })],
  },
]

// A collective's profile, as the server returns it, without its members.
export type CollectiveProfile = Omit<
  components['schemas']['Collective'],
  'id' | 'createdAt' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'hasPhoto' | 'members'
>

// One of the artists a collective applied with through the "Appliquer" form, as it sent them, and the colour of their
// photo, for those who have one.
export type SeedMember = { profile: components['schemas']['ApplicantMember']; photo?: string }

export type SeedCollective = {
  profile: CollectiveProfile
  // The colour of its photo, for collectives that have one.
  photo?: string
  // Its applications, which an admin added, but the first one of a collective that applied through the form.
  applications: SeedApplication[]
} & (
  | {
      // For a collective that an admin added, with its applications, its members, in order: artists of SEED_ARTISTS, by
      // their email, or by their name for those without one, and new artists, by their name, whom the server creates
      // along with the collective.
      members: ({ seeded: string } | { name: string })[]
      form?: undefined
    }
  | {
      // For a collective that applied through the "Appliquer" form, which created it along with its first application,
      // and its artists, all new ones, the artists it applied with, in order.
      form: SeedMember[]
      members?: undefined
    }
)

// Seeded after the artists, whom they have as members.
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
        performanceTypes: ['dj'],
        otherPerformanceType: 'B2B2B',
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
    applications: [application([120], 'new', { performanceTypes: ['live-performance'], receivedDaysAgo: 1 })],
  },
  {
    profile: {
      name: 'Les Sœurs Ondes',
      country: 'CA',
      city: 'Québec',
      description: 'Trois synthétiseurs modulaires, une table de mixage et beaucoup de réverbération.',
      links: { bandcamp: 'soeursondes', instagram: 'soeurs.ondes' },
      email: 'soeurs.ondes@example.com',
      phone: '418 555-0103',
    },
    photo: '#a23b72',
    form: [
      {
        profile: {
          name: 'Ondine',
          country: 'CA',
          city: 'Québec',
          genres: ['ambient', 'experimental'],
          bio: 'Des nappes qui durent des heures.',
          links: { bandcamp: 'ondine-synth' },
        },
        photo: '#f18f01',
      },
      {
        profile: { name: 'Marée', country: 'CA', city: 'Lévis', genres: ['experimental'], bio: 'Des séquenceurs et des marées.', links: { instagram: 'maree.modulaire' } },
      },
      {
        profile: { name: 'Écume', country: 'FR', city: 'Brest', genres: ['ambient', 'noise'], bio: 'Bruit blanc et ressac.', links: { soundcloud: 'ecume-bruit' } },
        photo: '#c73e1d',
      },
    ],
    applications: [application([90], 'scheduled', { timeSlots: [MIDDAY], performanceTypes: ['live-performance'], otherPerformanceType: 'Synthé modulaire' })],
  },
  {
    profile: {
      name: 'Collectif Béton',
      country: 'CA',
      city: 'Montréal',
      description: 'Quatre DJ, une seule règle : jamais en dessous de 140 BPM.',
      links: { instagram: 'collectif.beton', ra: 'collectifbeton' },
      email: 'beton@example.com',
      phone: '514 555-0104',
    },
    // Only its second artist has a photo.
    form: [
      { profile: { name: 'Mathis', country: 'CA', city: 'Montréal', genres: ['hard-techno'], bio: 'Toujours plus vite.', links: { soundcloud: 'mathis-beton' } } },
      {
        profile: {
          name: 'Rosalie',
          country: 'CA',
          city: 'Laval',
          genres: ['ebm-industrial', 'hard-techno'],
          bio: 'EBM, industriel et basses saturées.',
          links: { instagram: 'rosalie.beton' },
        },
        photo: '#3b1f2b',
      },
      { profile: { name: 'Kofi', country: 'CA', city: 'Montréal', genres: ['hard-techno'], bio: 'Des sets de six heures.', links: { ra: 'kofibeton' } } },
      { profile: { name: 'Yasmine', country: 'BE', city: 'Bruxelles', genres: ['ebm-industrial'], bio: 'Bruxelles, 150 BPM.', links: { soundcloud: 'yasmine-beton' } } },
    ],
    applications: [
      application([30, 31], 'accepted', { timeSlots: [EVENING] }),
      application([-60], 'done', { timeSlots: [EVENING], receivedDaysAgo: 150 }),
    ],
  },
  {
    profile: {
      name: 'Radio Dub Laurentides',
      country: 'CA',
      city: 'Saint-Jérôme',
      description: 'Un sound system, un seul membre, beaucoup de basses.',
      links: { mixcloud: 'radiodublaurentides' },
      email: 'dub.laurentides@example.com',
      phone: '450 555-0112',
    },
    members: [{ name: 'Jah Pierre' }],
    photo: '#7d5ba6',
    applications: [application([-10], 'done', { timeSlots: [MIDDAY, AFTERNOON], receivedDaysAgo: 90 })],
  },
  {
    // Known only by name, from its past takeover, with its artists, who are new, known by name too.
    profile: { name: 'Saut de Clôture', country: '', city: '', description: '', links: {}, email: null, phone: '' },
    members: [{ name: 'Grillage' }, { name: 'Pied-de-Biche' }],
    applications: [],
  },
]

type Status = components['schemas']['SessionStatus']
type SessionType = components['schemas']['SessionType']
type SetFields = components['schemas']['SetFields']

export type SeedSet = Pick<SetFields, 'offsetMinutes' | 'durationMinutes'> &
  Partial<Pick<SetFields, 'performanceTypes' | 'otherPerformanceType' | 'genres'>> & {
    // The artists who played it, in order: artists of SEED_ARTISTS by their email, or artists without one, e.g. those of
    // a collective, by their name.
    performers: string[]
    // The video's id on YouTube, which isn't checked against YouTube. Sets have no SoundCloud track, which the server
    // would have to find on SoundCloud.
    youtubeVideo?: string
    status: Status
  }

export type SeedSession = {
  type: SessionType
  // For a takeover, its collective, by its email, or by its name for one without.
  takeover?: string
  // Its own name, which replaces the one its type gives it.
  name?: string
  // The event's id on RA, which isn't checked against RA.
  raEvent?: string
  // The day it starts, as how many days after the day it's seeded (before, if negative), in Québec, and the time it
  // starts there, or nothing for a session whose date isn't known yet.
  when?: { day: number; start: string }
  durationMinutes: number
  status: Status
  // In order. A set is given its status as soon as it's added, so that a cancelled set can be overlapped by the sets
  // after it. Cancelling the session cancels them all, and marking it as done marks none of them.
  sets: SeedSet[]
}

// The sessions are clear of 2:00 to 3:00, when clocks change: on those nights, their times could be skipped or happen
// twice, and their sets' times wouldn't be as they look.
export const SEED_SESSIONS: SeedSession[] = [
  // Onde Commune's takeover: its three artists, one after the other.
  {
    type: 'takeover',
    takeover: 'onde.commune@example.com',
    raEvent: '2201001',
    when: { day: -30, start: '20:00' },
    durationMinutes: 180,
    status: 'done',
    sets: [
      { performers: ['clementine@example.com'], offsetMinutes: 0, durationMinutes: 60, performanceTypes: ['dj'], genres: ['techno', 'acid'], youtubeVideo: 'oNdEcOmMuN1', status: 'done' },
      { performers: ['boreale@example.com'], offsetMinutes: 60, durationMinutes: 60, performanceTypes: ['vinyl'], genres: ['house'], youtubeVideo: 'oNdEcOmMuN2', status: 'done' },
      { performers: ['kwame@example.com'], offsetMinutes: 120, durationMinutes: 60, performanceTypes: ['dj'], youtubeVideo: 'oNdEcOmMuN3', status: 'done' },
    ],
  },
  // Collectif Béton's takeover, with a name of its own: a guest who isn't one of its artists, then two of its artists
  // together, until after midnight.
  {
    type: 'takeover',
    takeover: 'beton@example.com',
    name: 'BÉTON 140',
    when: { day: -60, start: '20:30' },
    durationMinutes: 300,
    status: 'done',
    sets: [
      { performers: ['DJ.Poutine@Example.com'], offsetMinutes: 0, durationMinutes: 90, performanceTypes: ['dj'], youtubeVideo: 'bEtOnGuEsT1', status: 'done' },
      {
        performers: ['Mathis', 'Rosalie'],
        offsetMinutes: 90,
        durationMinutes: 210,
        performanceTypes: ['live-performance'],
        otherPerformanceType: 'B2B machines',
        genres: ['hard-techno', 'ebm-industrial'],
        youtubeVideo: 'bEtOn140aaa',
        status: 'done',
      },
    ],
  },
  // Without links.
  {
    type: 'takeover',
    takeover: 'dub.laurentides@example.com',
    when: { day: -10, start: '14:00' },
    durationMinutes: 120,
    status: 'done',
    sets: [{ performers: ['Jah Pierre'], offsetMinutes: 0, durationMinutes: 120, status: 'done' }],
  },
  // The takeover of a collective without an email, from long ago, back to back.
  {
    type: 'takeover',
    takeover: 'Saut de Clôture',
    when: { day: -120, start: '19:00' },
    durationMinutes: 120,
    status: 'done',
    sets: [{ performers: ['Grillage', 'Pied-de-Biche'], offsetMinutes: 0, durationMinutes: 120, performanceTypes: ['dj'], status: 'done' }],
  },
  // An evening of guest mixes, where a cancelled set was replaced by one that overlaps it.
  {
    type: 'guest-mixes',
    when: { day: 30, start: '21:00' },
    durationMinutes: 150,
    status: 'planned',
    sets: [
      { performers: ['Marée Basse'], offsetMinutes: 30, durationMinutes: 60, performanceTypes: ['live-performance'], status: 'cancelled' },
      { performers: ['clementine@example.com', 'clement.brule@example.com'], offsetMinutes: 0, durationMinutes: 90, performanceTypes: ['dj'], status: 'planned' },
      { performers: ['kwame@example.com'], offsetMinutes: 90, durationMinutes: 60, performanceTypes: ['dj'], genres: ['deep-house'], status: 'planned' },
    ],
  },
  // A takeover put together before its date is known, whose last set's place isn't known either.
  {
    type: 'takeover',
    takeover: 'soeurs.ondes@example.com',
    durationMinutes: 180,
    status: 'planned',
    sets: [
      { performers: ['Ondine'], offsetMinutes: 0, durationMinutes: 60, performanceTypes: ['live-performance'], otherPerformanceType: 'Synthé modulaire', genres: ['ambient'], status: 'planned' },
      { performers: ['Marée'], offsetMinutes: 60, durationMinutes: 60, performanceTypes: ['live-performance'], genres: ['experimental'], status: 'planned' },
      { performers: ['Écume'], offsetMinutes: null, durationMinutes: 60, status: 'planned' },
    ],
  },
  // An evening whose times are being changed: two of its sets overlap, and the last one ends after it, which its page
  // marks (see "Sets' places" in docs/design/server/sessions.md).
  {
    type: 'other',
    name: 'SOIRÉE À REVOIR',
    when: { day: 45, start: '20:00' },
    durationMinutes: 120,
    status: 'planned',
    sets: [
      { performers: ['boreale@example.com'], offsetMinutes: 0, durationMinutes: 60, performanceTypes: ['vinyl'], status: 'planned' },
      { performers: ['Ondine'], offsetMinutes: 30, durationMinutes: 60, performanceTypes: ['live-performance'], status: 'planned' },
      { performers: ['Jah Pierre'], offsetMinutes: 90, durationMinutes: 60, status: 'planned' },
    ],
  },
  // Les Nuits Basses' takeover, cancelled, which cancelled its sets.
  {
    type: 'takeover',
    takeover: 'kwame@example.com',
    raEvent: '2302002',
    when: { day: 60, start: '20:00' },
    durationMinutes: 120,
    status: 'cancelled',
    sets: [
      { performers: ['Sable Mouvant'], offsetMinutes: 0, durationMinutes: 60, status: 'planned' },
      { performers: ['Marée Basse'], offsetMinutes: 60, durationMinutes: 60, status: 'planned' },
    ],
  },
  // A live performance, coming up.
  {
    type: 'live-performance',
    when: { day: 15, start: '20:00' },
    durationMinutes: 60,
    status: 'planned',
    sets: [{ performers: ['Ondine'], offsetMinutes: 0, durationMinutes: 60, performanceTypes: ['live-performance'], otherPerformanceType: 'Synthé modulaire', status: 'planned' }],
  },
  // A synth meetup, which has no sets.
  {
    type: 'synth-meetup',
    when: { day: -20, start: '18:00' },
    durationMinutes: 180,
    status: 'done',
    sets: [],
  },
]
