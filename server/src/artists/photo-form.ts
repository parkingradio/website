import { Readable } from 'node:stream'
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { nulError } from '../api/schemas.js'
import { PHOTO_MAX_BYTES, PHOTO_TYPES } from './profile.js'
import { InvalidProfile, PHOTO_ERRORS, validatePhoto, validateProfile } from './store.js'
import type { PhotoErrors, Photos, SentPhoto } from './store.js'

// Reading requests that send a photo with a few fields, e.g. a profile, and serving photos, for the routes of artists,
// collectives and applications, and the same for sessions' flyers, which follow the same rules.

// The contents of a multipart/form-data request that sends a photo with a few fields: the fields, as they were sent, the
// photo from the "photo" part (or the part the request names, e.g. "flyer"), if there's one, and, for a request that
// reads them, the photos of a collective's artists, from the "memberPhoto" parts, in order, where an empty part is no
// photo.
export type PhotoForm = { fields: Record<string, unknown>; photo: Buffer | undefined; memberPhotos: (Buffer | undefined)[] }

// What a request with a photo can send. The photo can be up to PHOTO_MAX_BYTES. There's room for a few more fields and
// files than a route reads, e.g. a form's submit button.
export type FormLimits = { files: number; fields: number; fieldSize: number }
const LIMITS: FormLimits = { files: 5, fields: 10, fieldSize: 64 * 1024 }

// Reads a PhotoForm from `request`, with the photo from the part named `photoPart`. The route must have registered the
// multipart plugin. Files other than the photos it reads are ignored: with `memberPhotos`, the "memberPhoto" parts are
// read too. Every photo it reads stays in memory until
// the request is done, which `limits` bounds. Returns `{ tooLarge }` if a photo is over PHOTO_MAX_BYTES, with the index
// of the "memberPhoto" part when it's one of them, or undefined for the "photo" part, and "malformed" if the request
// isn't actually multipart/form-data, has more fields or files than `limits` allows, a field larger than it allows, or
// more than one photo part.
export async function readPhotoForm(
  request: FastifyRequest,
  {
    limits = LIMITS,
    memberPhotos: readMemberPhotos = false,
    photoPart = 'photo',
  }: { limits?: FormLimits; memberPhotos?: boolean; photoPart?: string } = {},
): Promise<PhotoForm | 'malformed' | { tooLarge: number | undefined }> {
  if (!request.isMultipart()) return 'malformed'

  const fields: Record<string, unknown> = {}
  let photo: Buffer | undefined
  let photoParts = 0
  const memberPhotos: (Buffer | undefined)[] = []
  // The "memberPhoto" part being read, if it's one of them, for the error when it's too large.
  let member: number | undefined
  try {
    for await (const part of request.parts({ limits: { ...limits, fileSize: PHOTO_MAX_BYTES } })) {
      if (part.type === 'field') {
        // A field larger than `fieldSize` is cut short, rather than refused.
        if (part.valueTruncated) return 'malformed'
        fields[part.fieldname] = part.value
      } else if (part.fieldname === photoPart) {
        // Only the first photo is kept. Any other one is still read, and thrown away: otherwise the rest of the request
        // would never be read, and the connection couldn't be used for the next request.
        if (++photoParts > 1) {
          part.file.resume()
          continue
        }
        photo = await nonEmpty(part.toBuffer())
      } else if (part.fieldname === 'memberPhoto' && readMemberPhotos) {
        member = memberPhotos.length
        memberPhotos.push(await nonEmpty(part.toBuffer()))
        member = undefined
      } else {
        part.file.resume() // drain anything unexpected
      }
    }
  } catch (error) {
    if (error instanceof request.server.multipartErrors.RequestFileTooLargeError) return { tooLarge: member }
    request.log.info({ err: error }, 'Malformed multipart request')
    return 'malformed'
  }
  return photoParts > 1 ? 'malformed' : { fields, photo, memberPhotos }
}

// A form whose file input was left empty still sends the part, without any content, which is no photo.
async function nonEmpty(body: Promise<Buffer>): Promise<Buffer | undefined> {
  const read = await body
  return read.length > 0 ? read : undefined
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
// collective, and checks them, the profile against `schema`, then as Fastify checks a JSON body for the NUL character
// (see `refusingNul` in api/schemas.ts), along with the "removePhoto" field, which only changing one reads. Returns the
// checked profile and photo (null when there's none), or the error to reply with when the request is malformed or
// invalid. A session's fields and flyer are read the same way, with `image` naming the flyer's part, the field that
// removes it, and its errors.
export async function readProfileForm<Schema extends z.ZodType>(
  request: FastifyRequest,
  part: string,
  schema: Schema,
  { part: photoPart = 'photo', remove = 'removePhoto', errors = PHOTO_ERRORS }: { part?: string; remove?: string; errors?: PhotoErrors } = {},
): Promise<{ profile: z.output<Schema>; photo: SentPhoto | null; removePhoto: boolean } | { status: 400 | 413; error: string }> {
  const form = await readPhotoForm(request, { photoPart })
  if (form === 'malformed') return INVALID_REQUEST
  if ('tooLarge' in form) return { status: 413, error: errors.tooLarge }
  const sent = jsonField(form.fields[part])
  if (sent === undefined) return INVALID_REQUEST
  try {
    const profile = validateProfile(sent, schema)
    const nul = nulError(profile)
    if (nul) return { status: 400, error: nul }
    return { profile, photo: validatePhoto(form.photo, errors), removePhoto: form.fields[remove] === 'true' }
  } catch (error) {
    if (!(error instanceof InvalidProfile)) throw error
    return { status: 400, error: error.message }
  }
}

// The photo, as it's read from where it's kept. Streams are sent as they are, rather than serialized, so it isn't
// checked against this schema, which only says it's a file.
const Photo = z.instanceof(Readable).meta({ type: 'string', format: 'binary' })

// The response of the endpoints that serve a photo, an artist's or a collective's, or a session's flyer (see
// `sendPhoto`).
function imageResponse(image: 'photo' | 'flyer') {
  return {
    description:
      `The ${image}, with the type it was checked to have. Browsers are told not to guess another ` +
      '(`X-Content-Type-Options: nosniff`) or to keep it (`Cache-Control: private, no-store`)',
    content: Object.fromEntries(PHOTO_TYPES.map((type) => [type, { schema: Photo }])),
  }
}
export const PhotoResponse = imageResponse('photo')
export const FlyerResponse = imageResponse('flyer')

// Sends the photo of an artist or a collective, or the flyer of a session (as `what` and `image` say), or a 404 when they
// have none, or when it's missing.
export async function sendPhoto(
  reply: FastifyReply,
  log: FastifyBaseLogger,
  photos: Photos,
  row: { photoKey: string | null; photoType: string | null },
  what: 'artist' | 'collective' | 'session',
  image: 'photo' | 'flyer' = 'photo',
) {
  if (!row.photoKey) return reply.status(404).send({ ok: false, error: `This ${what} has no ${image}` })
  const photo = await photos.read(row.photoKey)
  if (!photo) {
    log.error({ key: row.photoKey }, `The ${image} of a ${what} is missing`)
    return reply.status(404).send({ ok: false, error: `The ${image} of this ${what} is missing` })
  }
  // The type was checked from the photo's contents when it was sent, and browsers mustn't guess another.
  return reply
    .header('Content-Type', row.photoType!)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, no-store')
    .send(photo)
}
