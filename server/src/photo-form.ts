import type { FastifyRequest } from 'fastify'
import { PHOTO_MAX_BYTES } from './artist-profile.js'

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
