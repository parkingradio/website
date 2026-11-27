import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { clientAddress } from '../api/client-address.js'
import { useApiErrors } from '../api/errors.js'
import { ApiError, Ok, zodRoutes } from '../api/schemas.js'
import { checkTurnstile } from '../api/turnstile.js'
import type { TurnstileVerifier } from '../api/turnstile.js'
import { jsonField, readPhotoForm } from '../artists/photo-form.js'
import type { FormLimits, PhotoForm } from '../artists/photo-form.js'
import { PHOTO_TOO_LARGE, PHOTO_UNREADABLE, PhotoFile } from '../artists/profile.js'
import { EmailTaken, InvalidProfile, PHOTO_ERRORS, forgetPhoto, storePhoto, validatePhoto, withSizes } from '../artists/store.js'
import type { PhotoFolder } from '../artists/keys.js'
import type { NewPhoto, Photos, SentPhoto, SizedPhoto } from '../artists/store.js'
import type { Email, SendEmail } from '../core/email.js'
import { Applicant, applied, memberError, validateApplicant } from './applicant.js'
import type { Applied } from './applicant.js'
import type { ApplyStore } from './apply-store.js'
import { applicationEmails } from './emails.js'
import { ApplicationFields } from './fields.js'
import type { ApplicationsSettingsStore } from './settings.js'
import { InvalidApplication, validateApplication } from './store.js'

// The public endpoint where new artists and collectives apply for a set (see docs/design/server/applications.md). Artists see its
// errors, so they're in French.

// Enough for an artist to retry a few times after errors, but low enough to stop a flood of applications.
export const APPLICATIONS_PER_WINDOW = 5
const APPLICATIONS_WINDOW = '1 hour'

const INVALID_REQUEST: z.infer<typeof ApiError> = { ok: false, error: 'Candidature invalide.' }
const INTERNAL_ERROR = 'Une erreur est survenue. Réessayez plus tard.'
const EMAIL_TAKEN: z.infer<typeof ApiError> = { ok: false, error: 'Un artiste est déjà inscrit avec cette adresse e-mail.' }
const COLLECTIVE_EMAIL_TAKEN: z.infer<typeof ApiError> = { ok: false, error: 'Un collectif est déjà inscrit avec cette adresse e-mail.' }
const TURNSTILE_REFUSED: z.infer<typeof ApiError> = { ok: false, error: 'La vérification anti-robot a échoué. Réessayez.' }
const TURNSTILE_UNAVAILABLE: z.infer<typeof ApiError> = {
  ok: false,
  error: "La vérification anti-robot n'a pas pu être faite. Réessayez dans quelques minutes.",
}

// What applying sends, as multipart/form-data. The route reads it itself (see `validated`), checking who applies and the
// application against these schemas, but in its own order, with its own errors: before the token, which can only be
// checked once.
const ApplyForm = z.object({
  artist: Applicant,
  application: ApplicationFields,
  photo: PhotoFile.optional(),
  memberPhoto: z.array(PhotoFile).optional().meta({
    description:
      "For a collective, its artists' photos, a part each, in the order of its artists, where an empty part is no photo. " +
      'Those after the last photo can be left out',
  }),
  turnstileToken: z.string().meta({ description: 'The token the Turnstile widget gave the page' }),
})

// What the request can send (see `readPhotoForm`): the photos of a collective and a few of its artists, and room for a
// few other fields and files. The profiles are in a single field, which bounds how many artists a collective can send.
const LIMITS: FormLimits = { files: 10, fields: 10, fieldSize: 256 * 1024 }

// Who applies, as they're saved, and the photos they sent: an artist's or a collective's, and for a collective, each of
// its artists', in order.
type Sent = { applied: Applied; photo: SentPhoto | null; memberPhotos: (SentPhoto | null)[]; application: ApplicationFields }

// Checks who applies, the types of the photos and the application that were sent. Returns what to save of them, or the
// error for the first one that isn't valid. The photos are only read once the token is checked (see `sized`).
function validated(form: PhotoForm): Sent | z.infer<typeof ApiError> {
  const sentArtist = jsonField(form.fields.artist)
  const sentApplication = jsonField(form.fields.application)
  if (sentArtist === undefined || sentApplication === undefined) return INVALID_REQUEST
  try {
    const applicant = applied(validateApplicant(sentArtist))
    const members = 'members' in applicant ? applicant.members.length : 0
    // A photo for an artist the collective doesn't have.
    if (form.memberPhotos.length > members) return INVALID_REQUEST
    const photo = validatePhoto(form.photo)
    const memberPhotos = Array.from({ length: members }, (_, index) => {
      try {
        return validatePhoto(form.memberPhotos[index])
      } catch (error) {
        throw error instanceof InvalidProfile ? new InvalidProfile(memberError(index, error.message)) : error
      }
    })
    return { applied: applicant, photo, memberPhotos, application: validateApplication(sentApplication) }
  } catch (error) {
    if (!(error instanceof InvalidProfile || error instanceof InvalidApplication)) throw error
    return { ok: false, error: error.message }
  }
}

// Reads the photos that were sent, one after another, and returns them with their sizes, or the error for the first one
// that can't be read. That's what takes the most work and memory, so it's only done once Turnstile has accepted the token.
async function sized(sent: Sent): Promise<{ photo: SizedPhoto | null; memberPhotos: (SizedPhoto | null)[] } | z.infer<typeof ApiError>> {
  try {
    const photo = sent.photo && (await withSizes(sent.photo))
    const memberPhotos: (SizedPhoto | null)[] = []
    for (const [index, memberPhoto] of sent.memberPhotos.entries()) {
      memberPhotos.push(memberPhoto && (await withSizes(memberPhoto, { ...PHOTO_ERRORS, unreadable: memberError(index, PHOTO_UNREADABLE) })))
    }
    return { photo, memberPhotos }
  } catch (error) {
    if (!(error instanceof InvalidProfile)) throw error
    return { ok: false, error: error.message }
  }
}

// Stores the photos that were sent, one at a time, each in its folder, and returns them, or null for none. If one can't
// be stored, those that were are deleted, unless something uses them, and the error is thrown: storing them all at once
// would leave those still being stored behind.
async function storePhotos(photos: ApplyOptions['photos'], log: FastifyBaseLogger, sent: { photo: SizedPhoto | null; folder: PhotoFolder }[]) {
  const stored: (NewPhoto | null)[] = []
  try {
    for (const { photo, folder } of sent) stored.push(await storePhoto(photos, photo, folder))
  } catch (error) {
    await forgetPhotos(photos, log, stored)
    throw error
  }
  return stored
}

async function forgetPhotos(photos: ApplyOptions['photos'], log: FastifyBaseLogger, stored: (NewPhoto | null)[]) {
  await Promise.all(stored.map((photo) => forgetPhoto(photos, log, photo?.key)))
}

type EmailOptions = {
  settings: Pick<ApplicationsSettingsStore, 'load'>
  // Null when the server can't send emails, e.g. in development, where MAIL_DOMAIN isn't set.
  sendEmail: SendEmail | null
}

// Emails the application to the recipients chosen on the admin pages, and confirms it to the artist, or the
// collective's contact. The application is saved by then, so failures are only logged.
async function emailApplication(
  log: FastifyBaseLogger,
  { settings, sendEmail }: EmailOptions,
  sent: Pick<Sent, 'applied' | 'application'>,
) {
  if (!sendEmail) {
    log.warn('Not emailing the application: MAIL_DOMAIN is not set')
    return
  }
  // Null when they couldn't be loaded, which is logged, so that it isn't also logged as nobody having been chosen.
  const recipients = await settings.load().then(
    (loaded) => loaded?.recipients ?? [],
    (error: unknown) => {
      log.error({ err: error }, 'Failed to load who applications are emailed to')
      return null
    },
  )
  if (recipients?.length === 0) log.warn('Not emailing the application to anyone: no recipients were chosen on the admin pages')
  const { toRecipients, confirmation } = applicationEmails({ ...sent, recipients: recipients ?? [] })

  const send = async (email: Email, failure: string) => {
    try {
      await sendEmail(email)
    } catch (error) {
      // An EmailNotSent, which leaves the addresses out.
      log.error({ err: error }, failure)
    }
  }
  await Promise.all([
    toRecipients && send(toRecipients, 'Failed to email an application to its recipients'),
    send(confirmation, 'Failed to confirm an application to the artist'),
  ])
}

type ApplyOptions = EmailOptions & {
  store: ApplyStore
  photos: Pick<Photos, 'store' | 'deleteUnused'>
  verifyTurnstile: TurnstileVerifier
}

export async function applyRoutes(app: FastifyInstance, { store, photos, verifyTurnstile, settings, sendEmail }: ApplyOptions) {
  // Only routes that opt in through `config.rateLimit` are limited.
  await app.register(rateLimit, { global: false, keyGenerator: clientAddress })
  // Needed by `readPhotoForm`, which sets its own limits.
  await app.register(multipart)

  // The errors that Fastify or a plugin raises are in French too, like the route's own: the rate limit's already has a
  // French message, other 4xx get the generic one, and unexpected errors say that something went wrong.
  useApiErrors(app, {
    clientError: (error) => (error.statusCode === 429 ? error.message : INVALID_REQUEST.error),
    internalError: INTERNAL_ERROR,
  })
  const api = zodRoutes(app)

  api.post(
    '/api/applications',
    {
      config: {
        rateLimit: {
          max: APPLICATIONS_PER_WINDOW,
          timeWindow: APPLICATIONS_WINDOW,
          // The plugin throws this error, and the error handler set above sends its message.
          errorResponseBuilder: () =>
            Object.assign(new Error('Trop de candidatures envoyées depuis votre connexion. Réessayez plus tard.'), { statusCode: 429 }),
        },
      },
      schema: {
        summary: 'A new artist or collective applies, with their profile, their application and maybe a photo',
        tags: ['Applications'],
        multipart: ApplyForm,
        response: { 200: Ok, 400: ApiError, 409: ApiError, 413: ApiError, 429: ApiError, 502: ApiError },
      },
    },
    async (request, reply) => {
      const form = await readPhotoForm(request, { limits: LIMITS, memberPhotos: true })
      if (form === 'malformed') return reply.status(400).send(INVALID_REQUEST)
      if ('tooLarge' in form) {
        const error = form.tooLarge === undefined ? PHOTO_TOO_LARGE : memberError(form.tooLarge, PHOTO_TOO_LARGE)
        return reply.status(413).send({ ok: false, error })
      }
      const sent = validated(form)
      if ('error' in sent) return reply.status(400).send(sent)

      // This comes after the checks above because Cloudflare only accepts each token once. That way, if a profile, the
      // application or a photo's type isn't valid, the artist can fix it and send it again with the same token. A photo
      // that can't be read is only found after it, though (see `sized`).
      const token = typeof form.fields.turnstileToken === 'string' ? form.fields.turnstileToken : ''
      const turnstile = await checkTurnstile(request, verifyTurnstile, token)
      if (turnstile === 'unavailable') return reply.status(502).send(TURNSTILE_UNAVAILABLE)
      if (turnstile === 'refused') return reply.status(400).send(TURNSTILE_REFUSED)
      const sizedPhotos = await sized(sent)
      if ('error' in sizedPhotos) return reply.status(400).send(sizedPhotos)

      // Only new artists and collectives can apply here, so an existing email gets a 409. That tells the sender the email
      // belongs to an artist, or a collective, which is why it's only checked now: finding that out takes passing
      // Turnstile, like applying does.
      const { applied, application } = sent
      const how =
        'artist' in applied
          ? {
              folder: 'artists' as const,
              save: ([photo]: (NewPhoto | null)[]) => store.apply({ ...applied.artist, photo }, application),
              taken: EMAIL_TAKEN,
              done: 'An artist applied',
            }
          : {
              folder: 'collectives' as const,
              // Its artists' photos become theirs.
              save: ([photo, ...memberPhotos]: (NewPhoto | null)[]) =>
                store.applyAsCollective(
                  { ...applied.collective, photo },
                  applied.members.map((member, index) => ({ ...member, photo: memberPhotos[index] })),
                  application,
                ),
              taken: COLLECTIVE_EMAIL_TAKEN,
              done: 'A collective applied',
            }
      const stored = await storePhotos(photos, request.log, [
        { photo: sizedPhotos.photo, folder: how.folder },
        ...sizedPhotos.memberPhotos.map((photo) => ({ photo, folder: 'artists' as const })),
      ])
      let ids: Awaited<ReturnType<typeof how.save>>
      try {
        ids = await how.save(stored)
      } catch (error) {
        await forgetPhotos(photos, request.log, stored)
        if (error instanceof EmailTaken) return reply.status(409).send(how.taken)
        throw error
      }
      const log = request.log.child(ids)
      log.info(how.done)
      // The application is saved, so nothing about its emails, even unexpected, can make the request fail.
      await emailApplication(log, { settings, sendEmail }, sent).catch((error: unknown) => {
        log.error({ err: error }, 'Failed to email an application')
      })
      return { ok: true as const }
    },
  )
}
