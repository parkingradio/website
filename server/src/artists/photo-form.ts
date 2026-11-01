import { Readable } from 'node:stream'
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { PHOTO_MAX_BYTES, PHOTO_TOO_LARGE, PHOTO_TYPES } from './profile.js'
import { InvalidProfile, validatePhoto, validateProfile } from './store.js'
import type { Photos, SentPhoto } from './store.js'

// Reading requests that send a photo with a few fields, e.g. a profile, and serving photos, for the routes of artists,
// collectives and applications.

// The contents of a multipart/form-data request that sends a photo with a few fields: the fields, as they were sent,
// and the photo from the "photo" part, if there's one.
export type PhotoForm = { fields: Record<string, unknown>; photo: Buffer | undefined }

// The photo can be up to PHOTO_MAX_BYTES. There's room for a few more fields and files than a route reads, e.g. a
// form's submit button.
const LIMITS = { files: 5, fileSize: PHOTO_MAX_BYTES, fields: 10, fieldSize: 64 * 1024 }

// Reads a PhotoForm from `request`. The route must have registered the multipart plugin. Files other than the photo are
// ignored. Returns "too-large" if the photo is over PHOTO_MAX_BYTES, and "malformed" if the request isn't actually
// multipart/form-data, has more fields or files than LIMITS allows, or has more than one photo.
export async function readPhotoForm(request: FastifyRequest): Promise<PhotoForm | 'malformed' | 'too-large'> {
  if (!request.isMultipart()) return 'malformed'

  const fields: Record<string, unknown> = {}
  let photo: Buffer | undefined
  let photoParts = 0
  try {
    for await (const part of request.parts({ limits: LIMITS })) {
      if (part.type === 'file' && part.fieldname === 'photo') {
        // Only the first photo is kept, because each photo stays in memory until the request is done. Any other photo
        // is still read, and thrown away. Otherwise the rest of the request would never be read, and the connection
        // couldn't be used for the next request.
        if (++photoParts > 1) {
          part.file.resume()
          continue
        }
        // A form whose file input was left empty still sends the part, without any content.
        const body = await part.toBuffer()
        if (body.length > 0) photo = body
      } else if (part.type === 'file') {
        part.file.resume() // drain anything unexpected
      } else {
        fields[part.fieldname] = part.value
      }
    }
  } catch (error) {
    if (error instanceof request.server.multipartErrors.RequestFileTooLargeError) return 'too-large'
    request.log.info({ err: error }, 'Malformed multipart request')
    return 'malformed'
  }
  return photoParts > 1 ? 'malformed' : { fields, photo }
}

// The value of a field sent as JSON, or undefined when it isn't JSON. The multipart plugin has already parsed it when
// its part says it's application/json.
export function jsonField(value: unknown): unknown {
  if (typeof value === 'object') return value
  try {
    return JSON.parse(typeof value === 'string' ? value : '')
  } catch {
    return undefined
  }
}

export const INVALID_REQUEST = { status: 400, error: 'Invalid request' } as const

// Reads the profile, as JSON from the part `part`, and the photo from a request that adds or changes an artist or a
// collective, and checks them, the profile against `schema`, along with the "removePhoto" field, which only changing
// one reads. Returns the checked profile and photo (null when there's none), or the error to reply with when the
// request is malformed or invalid.
export async function readProfileForm<Schema extends z.ZodType>(
  request: FastifyRequest,
  part: string,
  schema: Schema,
): Promise<{ profile: z.output<Schema>; photo: SentPhoto | null; removePhoto: boolean } | { status: 400 | 413; error: string }> {
  const form = await readPhotoForm(request)
  if (form === 'too-large') return { status: 413, error: PHOTO_TOO_LARGE }
  if (form === 'malformed') return INVALID_REQUEST
  const sent = jsonField(form.fields[part])
  if (sent === undefined) return INVALID_REQUEST
  try {
    return { profile: validateProfile(sent, schema), photo: validatePhoto(form.photo), removePhoto: form.fields.removePhoto === 'true' }
  } catch (error) {
    if (!(error instanceof InvalidProfile)) throw error
    return { status: 400, error: error.message }
  }
}

// The photo, as it's read from where it's kept. Streams are sent as they are, rather than serialized, so it isn't
// checked against this schema, which only says it's a file.
const Photo = z.instanceof(Readable).meta({ type: 'string', format: 'binary' })

// The response of the endpoints that serve a photo, an artist's or a collective's (see `sendPhoto`).
export const PhotoResponse = {
  description:
    'The photo, with the type it was checked to have. Browsers are told not to guess another ' +
    '(`X-Content-Type-Options: nosniff`) or to keep it (`Cache-Control: private, no-store`)',
  content: Object.fromEntries(PHOTO_TYPES.map((type) => [type, { schema: Photo }])),
}

// Sends the photo of an artist or a collective (as `what` says), or a 404 when they have none, or when it's missing.
export async function sendPhoto(
  reply: FastifyReply,
  log: FastifyBaseLogger,
  photos: Photos,
  row: { photoKey: string | null; photoType: string | null },
  what: 'artist' | 'collective',
) {
  if (!row.photoKey) return reply.status(404).send({ ok: false, error: `This ${what} has no photo` })
  const photo = await photos.read(row.photoKey)
  if (!photo) {
    log.error({ key: row.photoKey }, `The photo of a ${what} is missing`)
    return reply.status(404).send({ ok: false, error: `The photo of this ${what} is missing` })
  }
  // The type was checked from the photo's contents when it was sent, and browsers mustn't guess another.
  return reply
    .header('Content-Type', row.photoType!)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, no-store')
    .send(photo)
}
