import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import type { ApplicationFields, ApplyResponse } from 'shared/applications'
import { PHOTO_TOO_LARGE } from 'shared/artists'
import type { ArtistProfile } from 'shared/artists'
import type { ApiError } from 'shared/error'
import { applicationEmails } from '../application-emails.js'
import { InvalidApplication, validateApplication } from '../applications.js'
import type { ApplicationsSettingsStore } from '../applications-settings.js'
import type { ApplyStore } from '../apply.js'
import { EmailTaken, InvalidProfile, forgetPhoto, storePhoto, validatePhoto, validateProfile } from '../artists.js'
import type { Photos, SentPhoto } from '../artists.js'
import { clientAddress, visitorAddress } from '../client-address.js'
import type { Email, SendEmail } from '../email.js'
import { jsonField, readPhotoForm } from '../photo-form.js'
import type { PhotoForm } from '../photo-form.js'
import { keepQueryValuesPrivate } from '../query-errors.js'
import type { TurnstileVerifier } from '../turnstile.js'

// The public endpoint where new artists apply for a set. Artists see its errors, so they're in French.

// Enough for an artist to retry a few times after errors, but low enough to stop a flood of applications.
export const APPLICATIONS_PER_WINDOW = 5
const APPLICATIONS_WINDOW = '1 hour'

const INVALID_REQUEST: ApiError = { ok: false, error: 'Candidature invalide.' }
const EMAIL_TAKEN: ApiError = { ok: false, error: 'Un artiste est déjà inscrit avec cette adresse e-mail.' }
const TURNSTILE_REFUSED: ApiError = { ok: false, error: 'La vérification anti-robot a échoué. Réessayez.' }
const TURNSTILE_UNAVAILABLE: ApiError = {
  ok: false,
  error: "La vérification anti-robot n'a pas pu être faite. Réessayez dans quelques minutes.",
}

// Checks the profile, photo and application that were sent. Returns the cleaned-up versions to save, or the error for
// the first one that isn't valid.
function validated(form: PhotoForm): { profile: ArtistProfile; photo: SentPhoto | null; application: ApplicationFields } | ApiError {
  const sentArtist = jsonField(form.fields.artist)
  const sentApplication = jsonField(form.fields.application)
  if (sentArtist === undefined || sentApplication === undefined) return INVALID_REQUEST
  try {
    return { profile: validateProfile(sentArtist), photo: validatePhoto(form.photo), application: validateApplication(sentApplication) }
  } catch (error) {
    if (!(error instanceof InvalidProfile || error instanceof InvalidApplication)) throw error
    return { ok: false, error: error.message }
  }
}

type EmailOptions = {
  settings: Pick<ApplicationsSettingsStore, 'load'>
  // Null when the server can't send emails, e.g. in development, where MAIL_DOMAIN isn't set.
  sendEmail: SendEmail | null
}

// Emails the application to the recipients chosen on the admin pages, and confirms it to the artist. The application
// is saved by then, so failures are only logged.
async function emailApplication(
  log: FastifyBaseLogger,
  { settings, sendEmail }: EmailOptions,
  sent: { profile: ArtistProfile; application: ApplicationFields },
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
  photos: Pick<Photos, 'store' | 'delete'>
  verifyTurnstile: TurnstileVerifier
}

export async function applyRoutes(app: FastifyInstance, { store, photos, verifyTurnstile, settings, sendEmail }: ApplyOptions) {
  // Only routes that opt in through `config.rateLimit` are limited.
  await app.register(rateLimit, { global: false, keyGenerator: clientAddress })
  // Needed by `readPhotoForm`, which sets its own limits.
  await app.register(multipart)

  // The rate limit's error already has a French message. Other errors that Fastify or a plugin raises get the generic
  // one.
  keepQueryValuesPrivate(app, 'Failed to save an application sent by an artist', (error) =>
    error.statusCode === 429 ? error.message : INVALID_REQUEST.error,
  )

  app.post<{ Reply: ApplyResponse | ApiError }>(
    '/api/applications',
    {
      config: {
        rateLimit: {
          max: APPLICATIONS_PER_WINDOW,
          timeWindow: APPLICATIONS_WINDOW,
          // The plugin throws this error, and the error handler set by `keepQueryValuesPrivate` sends its message.
          errorResponseBuilder: () =>
            Object.assign(new Error('Trop de candidatures envoyées depuis votre connexion. Réessayez plus tard.'), { statusCode: 429 }),
        },
      },
    },
    async (request, reply) => {
      const form = await readPhotoForm(request)
      if (form === 'too-large') return reply.status(413).send({ ok: false, error: PHOTO_TOO_LARGE })
      if (form === 'malformed') return reply.status(400).send(INVALID_REQUEST)
      const sent = validated(form)
      if ('error' in sent) return reply.status(400).send(sent)

      // This comes after the checks above because Cloudflare only accepts each token once. That way, if the profile,
      // application or photo isn't valid, the artist can fix it and send it again with the same token.
      const token = typeof form.fields.turnstileToken === 'string' ? form.fields.turnstileToken : ''
      const verified = await verifyTurnstile(token, visitorAddress(request)).catch((error: unknown) => {
        request.log.error({ err: error }, 'Failed to check a Turnstile token with Cloudflare')
        return null
      })
      if (!verified) return reply.status(502).send(TURNSTILE_UNAVAILABLE)
      if (!verified.success) {
        // With a wrong secret key, every application is refused, so it's logged as an error to get noticed.
        const misconfigured = verified.errorCodes.some((code) => code.includes('secret'))
        request.log[misconfigured ? 'error' : 'info']({ errorCodes: verified.errorCodes }, 'Turnstile refused an application')
        return reply.status(400).send(TURNSTILE_REFUSED)
      }

      // Only new artists can apply here, so an existing email gets a 409. That tells the sender the email belongs to an
      // artist, which is why it's only checked now: finding that out takes passing Turnstile, like applying does.
      const photo = await storePhoto(photos, sent.photo)
      let applied: { artistId: string; applicationId: string }
      try {
        applied = await store.apply({ ...sent.profile, ...photo }, sent.application)
      } catch (error) {
        await forgetPhoto(photos, request.log, photo.photoKey)
        if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
        throw error
      }
      const log = request.log.child(applied)
      log.info('An artist applied')
      // The application is saved, so nothing about its emails, even unexpected, can make the request fail.
      await emailApplication(log, { settings, sendEmail }, sent).catch((error: unknown) => {
        log.error({ err: error }, 'Failed to email an application')
      })
      return { ok: true }
    },
  )
}
