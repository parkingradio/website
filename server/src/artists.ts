import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import {
  ARTIST_KINDS,
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  COUNTRIES,
  EMAIL_MAX_LENGTH,
  GENRES,
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  isEmailAddress,
  isPhoneNumber,
  linkSite,
  parseLink,
} from 'shared/artists'
import type { ArtistProfile, LinkSiteId } from 'shared/artists'
import type { db as Database } from './db.js'
import type { PrivateFiles } from './private-bucket.js'
import { artists } from './schema.js'
import { violatesConstraint } from './query-errors.js'
import { isUuid } from './uuid.js'

// Checks the profiles and photos sent for artists against the rules in shared/src/artists.ts, keeps artists in the
// database, and keeps their photos in the private bucket.

// Thrown when a profile or photo is invalid. Its message tells the artist what's wrong, in French.
export class InvalidProfile extends Error {}

// The text in `value`, trimmed. `field` names it in the error when it's too long, e.g. "La bio", and `missing` is
// the error when there's none, if it's required. The error is an `Invalid`, an InvalidProfile unless said otherwise.
export function text(value: unknown, field: string, maxLength: number, missing: string | null, Invalid = InvalidProfile): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed && missing) throw new Invalid(missing)
  if (trimmed.length > maxLength) throw new Invalid(`${field} dépasse ${maxLength} caractères.`)
  return trimmed
}

// Like `text`, for a field that's a single line, e.g. a name: each run of spaces, tabs or line breaks in it becomes a
// single space.
export function line(value: unknown, field: string, maxLength: number, missing: string | null, Invalid = InvalidProfile): string {
  return text(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, field, maxLength, missing, Invalid)
}

// Checks a profile, and returns what's saved of it: trimmed, without blank entries, and with links reduced to
// profile names. Throws an InvalidProfile otherwise.
export function validateProfile(sent: unknown): ArtistProfile {
  const artist: Partial<ArtistProfile> = sent !== null && typeof sent === 'object' ? sent : {}

  const kind = artist.kind
  if (!kind || !ARTIST_KINDS.includes(kind)) {
    throw new InvalidProfile('Indique si tu postules comme artiste ou comme collectif.')
  }
  const collective = kind === 'collective'
  const name = line(
    artist.name,
    collective ? 'Le nom du collectif' : "Le nom d'artiste",
    NAME_MAX_LENGTH,
    collective ? 'Indique le nom du collectif.' : "Indique ton nom d'artiste.",
  )

  // Only a collective lists its artists. Blank entries and duplicates, whatever their case, are dropped.
  const members: string[] = []
  const seen = new Set<string>()
  for (const member of collective && Array.isArray(artist.members) ? artist.members : []) {
    const memberName = line(member, "Le nom d'un artiste du collectif", NAME_MAX_LENGTH, null)
    if (!memberName || seen.has(memberName.toLowerCase())) continue
    seen.add(memberName.toLowerCase())
    members.push(memberName)
  }
  if (collective && members.length === 0) throw new InvalidProfile('Indique au moins un artiste du collectif.')

  const country = typeof artist.country === 'string' ? artist.country : ''
  if (!COUNTRIES.includes(country)) throw new InvalidProfile('Choisis ton pays.')
  const city = line(artist.city, 'La ville', CITY_MAX_LENGTH, 'Indique ta ville.')

  // Duplicates are dropped, keeping the first, so that the order still says which genres matter most.
  const genres = Array.isArray(artist.genres) ? [...new Set(artist.genres)] : []
  if (genres.length === 0) throw new InvalidProfile('Choisis au moins un genre.')
  if (!genres.every((genre) => GENRES.some(({ id }) => id === genre))) throw new InvalidProfile("Un des genres n'est pas dans la liste.")

  const bio = text(artist.bio, 'La bio', BIO_MAX_LENGTH, 'Écris quelques lignes de bio.')

  const links: Partial<Record<LinkSiteId, string>> = {}
  for (const [id, raw] of Object.entries(artist.links ?? {})) {
    const site = linkSite(id)
    if (!site || typeof raw !== 'string') throw new InvalidProfile('Un des liens est invalide.')
    const { value, error } = parseLink(site, raw)
    if (error) throw new InvalidProfile(`${site.name} : ${error}.`)
    if (value) links[site.id] = value
  }
  if (Object.keys(links).length === 0) throw new InvalidProfile('Ajoute au moins un lien.')

  const email = line(artist.email, "L'adresse e-mail", EMAIL_MAX_LENGTH, 'Indique ton adresse e-mail.')
  if (!isEmailAddress(email)) throw new InvalidProfile('Indique une adresse e-mail valide.')
  const phone = line(artist.phone, 'Le numéro de téléphone', PHONE_MAX_LENGTH, 'Indique ton numéro de téléphone.')
  if (!isPhoneNumber(phone)) throw new InvalidProfile('Indique un numéro de téléphone valide.')

  return { email, kind, name, members, country, city, genres, bio, links, phone }
}

// A photo that was sent, and its MIME type, as checked from its contents.
export type SentPhoto = { body: Buffer; type: string }

// Checks that the photo is a JPEG, PNG or WebP image, from its first bytes rather than trusting what the browser
// says, and returns it with its MIME type. Throws an InvalidProfile otherwise, including when there's no photo. Its
// size is limited when it's received.
export function validatePhoto(body: Buffer | undefined): SentPhoto {
  if (body?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { body, type: 'image/jpeg' }
  if (body?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { body, type: 'image/png' }
  if (body?.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') return { body, type: 'image/webp' }
  throw new InvalidProfile('Ajoute une photo en JPEG, PNG ou WebP.')
}

export type StoredArtist = typeof artists.$inferSelect

// Where the photo of an artist is stored (see `Photos`), and its MIME type.
type StoredPhoto = Pick<StoredArtist, 'photoKey' | 'photoType'>

// Thrown when saving an artist with the email of another one, whatever its case.
export class EmailTaken extends Error {}

// The artists, as the admin pages manage them. Each method that's about one artist returns null when there's no such
// artist, which is the case of any id that isn't a UUID.
export type ArtistsStore = {
  // By name, whatever its case.
  list(): Promise<StoredArtist[]>
  get(id: string): Promise<StoredArtist | null>
  // Throws an EmailTaken.
  create(artist: ArtistProfile & StoredPhoto & { createdBy: string }): Promise<StoredArtist>
  // Replaces the artist's profile, and their photo when there's a new one. Returns the artist as they were, so that
  // a photo that was replaced can be deleted, and as they are then. Throws an EmailTaken.
  update(
    id: string,
    changes: ArtistProfile & Partial<StoredPhoto> & { updatedBy: string; updatedAt: Date },
  ): Promise<{ before: StoredArtist; after: StoredArtist } | null>
  // Returns the artist as they were, so that their photo can be deleted too.
  delete(id: string): Promise<StoredArtist | null>
}

export function artistsStore(db: typeof Database): ArtistsStore {
  return {
    async list() {
      return db.select().from(artists).orderBy(asc(sql`lower(${artists.name})`))
    },

    async get(id) {
      if (!isUuid(id)) return null
      const [row] = await db.select().from(artists).where(eq(artists.id, id))
      return row ?? null
    },

    async create(artist) {
      try {
        const [row] = await db.insert(artists).values(artist).returning()
        return row
      } catch (error) {
        if (violatesConstraint(error, 'artists_email_lower_idx')) throw new EmailTaken()
        throw error
      }
    },

    async update(id, changes) {
      if (!isUuid(id)) return null
      try {
        return await db.transaction(async (tx) => {
          const [before] = await tx.select().from(artists).where(eq(artists.id, id)).for('update')
          if (!before) return null
          const [after] = await tx.update(artists).set(changes).where(eq(artists.id, id)).returning()
          return { before, after }
        })
      } catch (error) {
        if (violatesConstraint(error, 'artists_email_lower_idx')) throw new EmailTaken()
        throw error
      }
    },

    async delete(id) {
      if (!isUuid(id)) return null
      const [row] = await db.delete(artists).where(eq(artists.id, id)).returning()
      return row ?? null
    },
  }
}

// Artists' photos. They're personal data, so they're private files (see private-bucket.ts), under `artists/`, rather
// than public assets.
export type Photos = Pick<PrivateFiles, 'read' | 'delete'> & {
  // Stores the photo under a new key, and returns that key.
  store(photo: SentPhoto): Promise<string>
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export function artistPhotos(files: PrivateFiles): Photos {
  return {
    async store({ body, type }) {
      const key = `artists/${randomUUID()}.${EXTENSIONS[type] ?? 'bin'}`
      await files.put(key, body, type)
      return key
    },
    read: files.read,
    delete: files.delete,
  }
}
