import { Readable } from 'node:stream'
import type { FastifyContextConfig, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ApiError, ById, firstIssue, nulError } from '../api/schemas.js'
import { PHOTO_MAX_BYTES, PHOTO_TYPES, PhotoFile } from './profile.js'
import { PHOTO_WIDTHS, SIZE_TYPE, sizeKey, sizeName, widthNamed } from './sizes.js'
import type { PhotoWidth } from './sizes.js'
import { InvalidProfile, PHOTO_ERRORS, photoName, readPhoto, validateProfile } from './store.js'
import type { PhotoErrors, Photos, SizedPhoto } from './store.js'

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
// read too. Every photo it reads stays in memory until the request is done, which `limits` bounds. Returns
// `{ tooLarge }` if a photo is over PHOTO_MAX_BYTES, with the index of the "memberPhoto" part when it's one of them, or
// undefined for the photo part, and "malformed" if the request isn't actually multipart/form-data, has more fields or
// files than `limits` allows, a field larger than it allows, or more than one photo part.
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

// Reads the profile, as JSON from the part `part`, and the photo from a request that adds an artist or a collective, and
// checks them, the profile against `schema`, then as Fastify checks a JSON body for the NUL character (see `refusingNul`
// in api/schemas.ts). Returns the checked profile and photo, with its sizes (null when there's none), or the error to
// reply with when the request is malformed or invalid, e.g. when the photo can't be read, with where in the profile, when
// it's about one of its fields. A session's fields and flyer are read the same way, with `photoPart` naming the flyer's
// part, and `errors` what's wrong with it.
export async function readProfileForm<Schema extends z.ZodType>(
  request: FastifyRequest,
  part: string,
  schema: Schema,
  { photoPart = 'photo', errors = PHOTO_ERRORS }: { photoPart?: string; errors?: PhotoErrors } = {},
): Promise<{ profile: z.output<Schema>; photo: SizedPhoto | null } | { status: 400 | 413; error: string; path?: PropertyKey[] }> {
  const form = await readPhotoForm(request, { photoPart })
  if (form === 'malformed') return INVALID_REQUEST
  if ('tooLarge' in form) return { status: 413, error: errors.tooLarge }
  const sent = jsonField(form.fields[part])
  if (sent === undefined) return INVALID_REQUEST
  try {
    const profile = validateProfile(sent, schema)
    const nul = nulError(profile)
    if (nul) return { status: 400, ...nul }
    return { profile, photo: await readPhoto(form.photo, errors) }
  } catch (error) {
    if (!(error instanceof InvalidProfile)) throw error
    return { status: 400, error: error.message, path: error.path }
  }
}

// What giving an artist or a collective a photo, or replacing theirs, sends, as multipart/form-data, which the route reads
// with `readImageForm`.
export const PhotoForm = z.object({ photo: PhotoFile })

// Reads the photo, or the flyer, from the part `part` of a request that only sends it, to give an artist or a collective
// a photo, or a session a flyer, and checks it. Other fields and files are ignored, but not a second photo (see
// `readPhotoForm`). Returns it, with its sizes, or the error to reply with when the request is malformed, has none, or
// when it's invalid, which `errors` says.
export async function readImageForm(
  request: FastifyRequest,
  part: 'photo' | 'flyer',
  errors: PhotoErrors,
): Promise<{ image: SizedPhoto } | { status: 400 | 413; error: string }> {
  const form = await readPhotoForm(request, { photoPart: part })
  if (form === 'malformed') return INVALID_REQUEST
  if ('tooLarge' in form) return { status: 413, error: errors.tooLarge }
  try {
    const image = await readPhoto(form.photo, errors)
    return image ? { image } : { status: 400, error: `The request has no ${part}` }
  } catch (error) {
    if (!(error instanceof InvalidProfile)) throw error
    return { status: 400, error: error.message }
  }
}

// The photo, as it's read from where it's kept. Streams are sent as they are, rather than serialized, so it isn't checked
// against this schema, which only says it's a file.
const Photo = z.instanceof(Readable).meta({ type: 'string', format: 'binary' })

// What a photo is of, for the admin endpoints: an artist's or a collective's photo, or a session's flyer.
type PhotoOf = 'artist' | 'collective' | 'session'
const imageOf = (what: PhotoOf) => (what === 'session' ? 'flyer' : 'photo')

const nosniff = 'Browsers are told not to guess another type (`X-Content-Type-Options: nosniff`)'

// Admins' photos can be kept, only in the browser that asked, never in a shared cache, e.g. Cloudflare's, after checking
// with the server.
const ADMIN_CACHE_CONTROL = 'private, no-cache'

// The options of an admin route that serves a photo or a flyer with `sendPhoto`, along with its summary and tags.
export function photoRoute(what: PhotoOf, { summary, tags }: { summary: string; tags: string[] }) {
  const image = imageOf(what)
  return {
    config: { admin: true, tool: null } satisfies FastifyContextConfig,
    schema: {
      summary,
      tags,
      params: ById,
      querystring: z.object({
        width: z
          .enum(PHOTO_WIDTHS.map(String) as [`${PhotoWidth}`, ...`${PhotoWidth}`[]], { error: `\`width\` must be ${PHOTO_WIDTHS.join(' or ')}.` })
          .transform((width) => Number(width) as PhotoWidth)
          .optional()
          .meta({
            description: `The width to serve it at, in pixels: ${PHOTO_WIDTHS.join(' or ')}, or narrower when it is, as WebP. Without it, it is served as it was sent`,
          }),
      }),
      response: {
        200: {
          description:
            `The ${image}, with the type it was checked to have, or, with \`width\`, its size at that width, as WebP. ${nosniff}, ` +
            'and that they can keep it, only in the browser that asked for it, never in a shared cache, but have to check with ' +
            `the server before showing it again (\`Cache-Control: ${ADMIN_CACHE_CONTROL}\`). The ${image} and each of its sizes ` +
            `have an \`ETag\` of their own, which changes whenever the ${image} does`,
          content: Object.fromEntries(PHOTO_TYPES.map((type) => [type, { schema: Photo }])),
        },
        // Without a body, which @fastify/swagger documents for a schema of type null.
        304: z.null().meta({
          description: "The request's `If-None-Match` has the `ETag` of what it asks for, so the browser already has it: it isn't sent again",
        }),
        404: ApiError,
      },
    },
    // The error about `width` is a sentence, sent as it is.
    schemaErrorFormatter: firstIssue,
  }
}

// Whether `ifNoneMatch`, a request's If-None-Match, a list of ETags, has `etag`. As HTTP says, they're compared weakly,
// e.g. when Cloudflare weakened the one it passed on: W/"x" matches "x". `*` isn't supported, since browsers never send
// it.
function hasEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  return ifNoneMatch?.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag) ?? false
}

// Sends the photo of an artist or a collective, or the flyer of a session (as `what` says), to an admin, on a route
// declared with `photoRoute`, as it was sent, or its size at `width`, or a 404 when they have none, when it's missing,
// or when it has no such size (see artists/backfill.ts). The ETag of a photo is its key, and that of a size the key it's
// kept under, which are only ever that photo's, wherever it's used (see `photoKey` in store.ts): it changes exactly when
// the photo does. So a request that already has it gets a 304 without anything being read, even when the photo is
// missing.
export async function sendPhoto(
  reply: FastifyReply,
  photos: Photos,
  row: { photoKey: string | null; photoType: string | null },
  what: PhotoOf,
  width: PhotoWidth | undefined,
) {
  // Only admins ever get a photo as it was sent: the public gets its sizes from `sendPublicSize`.
  if (reply.request.routeOptions.config.admin !== true) throw new Error('Photos are only served to admins as they were sent')
  const image = imageOf(what)
  if (!row.photoKey) return reply.status(404).send({ ok: false, error: `This ${what} has no ${image}` })
  const etag = `"${width ? sizeKey(row.photoKey, width) : row.photoKey}"`
  if (hasEtag(reply.request.headers['if-none-match'], etag)) {
    return reply.status(304).header('ETag', etag).header('Cache-Control', ADMIN_CACHE_CONTROL).send()
  }
  const photo = width ? await photos.readSize(row.photoKey, width) : await photos.read(row.photoKey)
  if (!photo && width) {
    // Until it's made, or for good when the photo can't be read: only the 404's message is logged, as for any other. A
    // photo that's missing too, which can't be told apart here, is logged when the server starts (see
    // artists/backfill.ts).
    return reply.status(404).send({ ok: false, error: `The ${image} of this ${what} has no size ${width} pixels wide` })
  }
  if (!photo) {
    const error = `The ${image} of this ${what} is missing`
    reply.log.error({ key: row.photoKey }, error)
    return reply.status(404).send({ ok: false, error })
  }
  // The type of the photo was checked from its contents when it was sent, and browsers mustn't guess another.
  return reply
    .header('Content-Type', width ? SIZE_TYPE : row.photoType!)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', ADMIN_CACHE_CONTROL)
    .header('ETag', etag)
    .send(photo)
}

// The public's sizes are named by their URL, which changes whenever what it serves does (see `publicSizes`), so anyone,
// browsers and Cloudflare included, can keep them for good, without checking with the server again.
const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// Where the public gets the sizes of a photo, by width, as public profiles and events give them.
export const PublicSizes = z.object(
  Object.fromEntries(PHOTO_WIDTHS.map((width) => [width, z.string()])) as { [Width in `${PhotoWidth}`]: z.ZodString },
)
export type PublicSizes = z.infer<typeof PublicSizes>

// The URLs of the sizes of the photo with `key`, or null when there's none, under `path`, the route of
// `publicSizeRoute`, e.g. `/api/artists/photos`: named after the photo, i.e. its content (see `photoName` in
// store.ts), and the size (see `sizeName` in sizes.ts), so that they're the same for everything that has the photo, and
// change whenever what they serve does.
export function publicSizes(path: string, key: string | null): PublicSizes | null {
  if (key === null) return null
  return Object.fromEntries(PHOTO_WIDTHS.map((width) => [width, `${path}/${photoName(key)}/${sizeName(width)}`])) as PublicSizes
}

// The options of a public route that serves the sizes of photos or flyers with `sendPublicSize`, at
// `<path>/:image/:size` (see `publicSizes`), along with its summary and tags.
export function publicSizeRoute(image: 'photo' | 'flyer', { summary, tags }: { summary: string; tags: string[] }) {
  return {
    schema: {
      summary,
      tags,
      params: z.object({
        image: z.string().meta({ description: `The ${image}'s name, as the URL of its size gives it` }),
        size: z.string().meta({ description: `The size's name, as its URL gives it, e.g. \`${sizeName(PHOTO_WIDTHS[0])}\`` }),
      }),
      response: {
        200: {
          description:
            `That size of the ${image}, as WebP. ${nosniff}, and that anyone, shared caches included, can keep it for good, ` +
            `without checking with the server again (\`Cache-Control: ${PUBLIC_CACHE_CONTROL}\`): its URL changes whenever ` +
            'what it serves does',
          content: { [SIZE_TYPE]: { schema: Photo } },
        },
        404: ApiError,
      },
    },
    // Errors, e.g. for a flyer that's no longer public, must not be kept, by browsers or by Cloudflare, which would
    // otherwise keep the 404 of a URL ending in `.webp`. Here, rather than where they're sent, so that it's also the case of
    // those that the error handler sends, which removes the headers already given.
    onSend: async (_request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      if (reply.statusCode >= 400) reply.header('Cache-Control', 'no-store')
      return payload
    },
  }
}

// Sends the size that a request to a route declared with `publicSizeRoute` asks for, of the photo named `image` that
// `find` finds, i.e. that something public has, or a 404 when there's no such size, nothing public has it, or it has no
// such size (see artists/backfill.ts).
export async function sendPublicSize(
  reply: FastifyReply,
  photos: Photos,
  image: 'photo' | 'flyer',
  params: { image: string; size: string },
  find: (name: string) => Promise<string | null>,
) {
  const width = widthNamed(params.size)
  const key = width && (await find(params.image))
  if (!width || !key) return reply.status(404).send({ ok: false, error: `No such ${image}` })
  const size = await photos.readSize(key, width)
  // As for admins (see `sendPhoto`).
  if (!size) return reply.status(404).send({ ok: false, error: `This ${image} has no size ${width} pixels wide` })
  return reply
    .header('Content-Type', SIZE_TYPE)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', PUBLIC_CACHE_CONTROL)
    .send(size)
}
