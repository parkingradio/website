import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, formData } from '../api/client'
import { DETAILS_MAX_LENGTH, OTHER_PRESTATION_MAX_LENGTH, PRESTATIONS, checkApplication, prestationName } from '../application-fields'
import type { ApplicationFields, PrestationId } from '../application-fields'
import { checkApplicant } from '../applicant'
import type { ApplicantErrors, ApplicantKind } from '../applicant'
import { LINK_SITES, NAME_MAX_LENGTH, parseLink, pickedPhotoError } from '../artist-profile'
import type { LinkSiteId } from '../artist-profile'
import { useTurnstileSiteKey } from '../config-context'
import { MAX_MEMBERS, SLOT_HOURS, TIME_SLOTS, prestationError, selectableDates } from './appliquer/choices'
import type { TimeSlotId } from './appliquer/choices'
import { DatePicker } from './appliquer/date-picker'
import { emptyMember } from './appliquer/members'
import type { Member, MemberErrors } from './appliquer/members'
import { MembersField } from './appliquer/members-field'
import { fieldId } from './appliquer/profile'
import type { Profile } from './appliquer/profile'
import { FieldError, IdentityFields, PlaceFields, PresentationFields } from './appliquer/profile-fields'
import { Turnstile } from './appliquer/turnstile'
import './appliquer.css'

// The "Appliquer" page: the form artists fill in to apply for a set, which sends their profile, or their collective's and
// each of its artists', and their application to `POST /api/applications`. It checks them as the server does (see
// `checkApplicant` and `checkApplication`), and sets a few limits of its own (see appliquer/choices.ts).

// What the ids of the fields of the profile of who applies start with, an artist's or a collective's, whose fields that
// both have keep their ids when switching between the two.
const PROFILE_ID_PREFIX = 'artiste-'

const KIND_OPTIONS: { kind: ApplicantKind; title: string; text: string }[] = [
  { kind: 'artist', title: 'Artiste', text: 'Vous jouez seul·e (ou en b2b) pendant une heure, dans une plage de notre programmation.' },
  { kind: 'collective', title: 'Collectif', text: "Vous prenez en main une plage entière avec votre line-up d'artistes." },
]

// The profile of who applies, an artist's or a collective's, whose `bio` is its description and whose genres aren't sent.
type Form = Profile & {
  kind: ApplicantKind | null
  // A collective's artists, each with their profile (an empty one to start with).
  members: Member[]
  prestations: PrestationId[]
  // "Autre" is checked, with what the artist wrote next to it.
  otherChecked: boolean
  otherPrestation: string
  email: string
  phone: string
  dates: string[]
  timeSlots: TimeSlotId[]
  details: string
}

const EMPTY: Form = {
  kind: null,
  name: '',
  members: [emptyMember(0)],
  country: null,
  city: '',
  genres: [],
  photo: null,
  bio: '',
  links: {},
  prestations: [],
  otherChecked: false,
  otherPrestation: '',
  email: '',
  phone: '',
  dates: [],
  timeSlots: [],
  details: '',
}

type Field = keyof ApplicantErrors['errors'] | keyof ApplicationFields | 'photo'

// Who applies and the application, as they're sent, before they're checked.
function sent(form: Form) {
  const { kind, name, country, city, links, email, phone } = form
  const members = form.members.map(({ name, country, city, genres, bio, links }) => ({ name, country, city, genres, bio, links }))
  return {
    artist:
      kind === 'collective'
        ? { kind, name, country, city, description: form.bio, links, email, phone, members }
        : { kind, name, country, city, genres: form.genres, bio: form.bio, links, email, phone },
    application: {
      dates: form.dates,
      timeSlots: TIME_SLOTS.filter(({ id }) => form.timeSlots.includes(id)).map(({ start, end }) => ({ start, end })),
      prestations: form.prestations,
      otherPrestation: form.otherChecked ? form.otherPrestation : '',
      details: form.details,
    },
  }
}

// A link that's wrong says why next to it, so the links as a whole only say to fix them, rather than say it again.
function linksError(error: string, typed: Partial<Record<LinkSiteId, string>>): string {
  return LINK_SITES.some((site) => parseLink(site, typed[site.id] ?? '').error) ? 'Corrigez les liens en rouge.' : error
}

// Who applies and the application to send, as the server would save them, or what's missing or wrong, by field, and by
// field of each of a collective's artists: what the server would say, and what the form asks for on top of that. The
// server checks it all again. A collective's artists are checked even before the form is sent, for their tabs to say
// whether their profiles are complete.
function checked(form: Form) {
  const { artist, application } = sent(form)
  const applicant = checkApplicant(artist)
  const fields = checkApplication(application)
  const errors: Partial<Record<Field, string>> = { ...applicant.errors, ...fields.errors }
  // A collective's description is the form's `bio`.
  if (errors.description) {
    errors.bio = errors.description
    delete errors.description
  }
  if (errors.links) errors.links = linksError(errors.links, form.links)
  const photo = pickedPhotoError(form.photo)
  if (photo) errors.photo = photo
  const prestation = prestationError(form.prestations, form.otherChecked ? form.otherPrestation : null)
  if (prestation) errors.prestations ??= prestation
  const memberErrors: MemberErrors[] =
    form.kind === 'collective'
      ? form.members.map((member, index) => {
          const memberErrors: MemberErrors = { ...applicant.memberErrors?.[index] }
          if (memberErrors.links) memberErrors.links = linksError(memberErrors.links, member.links)
          const photo = pickedPhotoError(member.photo)
          if (photo) memberErrors.photo = photo
          return memberErrors
        })
      : []
  const count = Object.keys(errors).length + memberErrors.reduce((total, member) => total + Object.keys(member).length, 0)
  if (applicant.applicant && fields.application && count === 0) {
    return { errors, memberErrors, count, applicant: applicant.applicant, application: fields.application }
  }
  return { errors, memberErrors, count }
}

// The photos of a collective's artists, as they're sent: a part for each, in order, where an empty one is no photo.
function memberPhotos(form: Form): Blob[] | undefined {
  return form.kind === 'collective' ? form.members.map((member) => member.photo ?? new Blob()) : undefined
}

// `list` with `item` in it, or without it.
function toggled<T>(list: T[], item: T, included: boolean): T[] {
  return included ? [...list, item] : list.filter((other) => other !== item)
}

type Status = { state: 'editing' | 'sending' } | { state: 'failed'; error: string } | { state: 'sent'; email: string }

const SEND_FAILED = "La candidature n'a pas pu être envoyée. Réessayez dans un moment."

function Part({ number, title, note, children }: { number: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="part">
      <div className="part-head">
        <span className="number">{number}</span>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      <div className="fields">{children}</div>
    </section>
  )
}

export function Appliquer() {
  const [form, setForm] = useState<Form>(EMPTY)
  const [status, setStatus] = useState<Status>({ state: 'editing' })
  // Errors only show once the artist tries to send the form. After that, they update as fields are fixed.
  const [attempts, setAttempts] = useState(0)
  // Computed once: the range shouldn't move under the artist's feet if the page stays open past midnight.
  const [{ first, last }] = useState(() => selectableDates(new Date()))
  const formRef = useRef<HTMLFormElement>(null)
  // The token Turnstile gives once it vouches for the artist, which the server checks. Null until then.
  const turnstileSiteKey = useTurnstileSiteKey()
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  // Incremented to get a new token, once one was sent, which shows a new widget.
  const [turnstileWidget, setTurnstileWidget] = useState(0)
  // The collective's artist whose profile is shown.
  const [memberTab, setMemberTab] = useState(0)
  const collective = form.kind === 'collective'

  // Changing anything clears why the form couldn't be sent, which may be what was just changed.
  const edit = (change: (current: Form) => Form) => {
    setForm(change)
    setStatus((current) => (current.state === 'failed' ? { state: 'editing' } : current))
  }
  const update = <K extends keyof Form>(key: K, value: Form[K]) => edit((current) => ({ ...current, [key]: value }))
  const change = (changes: Partial<Form>) => edit((current) => ({ ...current, ...changes }))
  const result = checked(form)
  const errors = attempts > 0 ? result.errors : {}
  const errorCount = attempts > 0 ? result.count : 0

  // After a failed attempt, bring the artist to the first field to fix (only then, not on every change), but not to one in
  // the profile of an artist of the collective that isn't shown.
  useEffect(() => {
    if (attempts === 0) return
    const invalid = [...(formRef.current?.querySelectorAll<HTMLElement>('[aria-invalid="true"]') ?? [])].find((field) => !field.closest('[hidden]'))
    invalid?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    invalid?.focus({ preventScroll: true })
  }, [attempts])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempts((count) => count + 1)
    // The first artist of the collective whose profile is wrong is shown, so that the form can bring the artist to it.
    const wrongMember = result.memberErrors.findIndex((member) => Object.keys(member).length > 0)
    if (wrongMember >= 0) setMemberTab(wrongMember)
    const { applicant, application } = result
    if (!applicant || !application) return
    // Without the configuration, there's no Turnstile, so no token is coming.
    if (!turnstileSiteKey) {
      setStatus({ state: 'failed', error: 'Le formulaire ne peut pas être envoyé pour le moment. Rechargez la page.' })
      return
    }
    if (!turnstileToken) {
      setStatus({
        state: 'failed',
        error: "La vérification anti-robot n'est pas terminée. Attendez quelques secondes, ou rechargez la page si elle n'apparaît pas.",
      })
      return
    }

    setStatus({ state: 'sending' })
    const sent = await api.POST('/api/applications', {
      body: { artist: applicant, application, photo: form.photo ?? undefined, memberPhoto: memberPhotos(form), turnstileToken },
      bodySerializer: formData,
    })
    if (sent.ok) {
      setStatus({ state: 'sent', email: applicant.email })
      return
    }
    // The server explains what's wrong in French, e.g. that an artist already has that email address. Otherwise, the
    // network failed, or the answer wasn't the server's, e.g. a photo too large for the proxy in front of it.
    const error = (sent.fromServer !== false && sent.error) || SEND_FAILED
    // The server may have checked the token, which can only be checked once.
    setTurnstileToken(null)
    setTurnstileWidget((count) => count + 1)
    setStatus({ state: 'failed', error })
  }

  if (status.state === 'sent') {
    return (
      <div className="appliquer">
        <div className="appliquer-inner">
          <Sent email={status.email} />
        </div>
      </div>
    )
  }

  return (
    <div className="appliquer">
      <div className="appliquer-inner">
        <header className="appliquer-header">
          <h1>Appliquer</h1>
          <p>formulaire de candidature · parking.radio</p>
        </header>

        <form ref={formRef} onSubmit={submit} noValidate>
          <Part number="01" title={collective ? 'Le collectif' : "L'artiste"}>
            <fieldset className={errors.kind ? 'field wide invalid' : 'field wide'}>
              <legend>
                Vous postulez en tant que <span className="required">*</span>
              </legend>
              <div className="applicant-types">
                {KIND_OPTIONS.map(({ kind, title, text }) => (
                  <label key={kind} className="applicant-type">
                    <input
                      type="radio"
                      name="kind"
                      checked={form.kind === kind}
                      aria-invalid={errors.kind ? true : undefined}
                      onChange={() => update('kind', kind)}
                    />
                    <span>
                      <strong>{title}</strong>
                      <span className="slot">plage d'environ {SLOT_HOURS[kind]} h</span>
                      <span className="text">{text}</span>
                    </span>
                  </label>
                ))}
              </div>
              <FieldError message={errors.kind} />
            </fieldset>
            {collective ? (
              <>
                <div className="field wide">
                  <label htmlFor={fieldId(PROFILE_ID_PREFIX, 'nom')}>
                    Nom du collectif <span className="required">*</span>
                  </label>
                  <input
                    id={fieldId(PROFILE_ID_PREFIX, 'nom')}
                    type="text"
                    maxLength={NAME_MAX_LENGTH}
                    autoComplete="nickname"
                    aria-invalid={errors.name ? true : undefined}
                    value={form.name}
                    onChange={(event) => update('name', event.target.value)}
                  />
                  <FieldError message={errors.name} />
                </div>
                <PlaceFields
                  idPrefix={PROFILE_ID_PREFIX}
                  country={form.country}
                  city={form.city}
                  onChange={change}
                  errors={errors}
                  cityPlaceholder="où le collectif est basé"
                />
                <fieldset className={errors.members ? 'field wide invalid' : 'field wide'}>
                  <legend>
                    Artistes du collectif <span className="required">*</span>{' '}
                    <span className="hint">— jusqu'à {MAX_MEMBERS}, chacun·e avec sa fiche</span>
                  </legend>
                  <MembersField
                    members={form.members}
                    onChange={(members) => update('members', members)}
                    selected={memberTab}
                    onSelect={setMemberTab}
                    memberErrors={result.memberErrors}
                    showErrors={attempts > 0}
                  />
                  <FieldError message={errors.members} />
                  <p className="flyer-note">
                    <strong>Takeovers&nbsp;:</strong> nous demandons aux collectifs de produire un flyer (carte blanche).
                  </p>
                </fieldset>
              </>
            ) : (
              <IdentityFields idPrefix={PROFILE_ID_PREFIX} profile={form} onChange={change} errors={errors} nameAutoComplete="nickname" />
            )}
          </Part>

          <Part number="02" title="Présentation">
            <PresentationFields
              idPrefix={PROFILE_ID_PREFIX}
              profile={form}
              onChange={change}
              errors={errors}
              showErrors={attempts > 0}
              collective={collective}
            />
          </Part>

          <Part number="03" title="Prestation" note="Cochez tout ce qui s'applique.">
            <fieldset className={errors.prestations ? 'field wide invalid' : 'field wide'}>
              <legend>
                Type de prestation <span className="required">*</span>
              </legend>
              <div className="chips">
                {PRESTATIONS.map((id) => (
                  <label key={id} className="chip">
                    <input
                      type="checkbox"
                      checked={form.prestations.includes(id)}
                      aria-invalid={errors.prestations ? true : undefined}
                      onChange={(event) => update('prestations', toggled(form.prestations, id, event.target.checked))}
                    />
                    <span>{prestationName(id)}</span>
                  </label>
                ))}
                <label className="chip">
                  <input type="checkbox" checked={form.otherChecked} onChange={(event) => update('otherChecked', event.target.checked)} />
                  <span>Autre</span>
                </label>
              </div>
              {form.otherChecked && (
                <input
                  className="other-prestation"
                  type="text"
                  aria-label="Autre type de prestation"
                  aria-invalid={errors.otherPrestation ? true : undefined}
                  placeholder="en quelques mots"
                  maxLength={OTHER_PRESTATION_MAX_LENGTH}
                  autoFocus
                  value={form.otherPrestation}
                  onChange={(event) => update('otherPrestation', event.target.value)}
                />
              )}
              <FieldError message={errors.prestations ?? errors.otherPrestation} />
            </fieldset>
          </Part>

          <Part
            number="04"
            title="Contact"
            note={
              collective
                ? 'La personne-contact du collectif : nous communiquerons seulement avec elle. Elle recevra une confirmation à cette adresse.'
                : 'Pour vous joindre. Vous recevrez une confirmation à cette adresse.'
            }
          >
            <div className="field">
              <label htmlFor="email">
                Adresse e-mail <span className="required">*</span>
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="vous@exemple.com"
                aria-invalid={errors.email ? true : undefined}
                value={form.email}
                onChange={(event) => update('email', event.target.value)}
              />
              <FieldError message={errors.email} />
            </div>
            <div className="field">
              <label htmlFor="phone">
                Numéro de téléphone <span className="required">*</span>
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                placeholder="ex. 418 555-0123"
                aria-invalid={errors.phone ? true : undefined}
                value={form.phone}
                onChange={(event) => update('phone', event.target.value)}
              />
              <FieldError message={errors.phone} />
            </div>
          </Part>

          <Part
            number="05"
            title="Dates"
            note="Cliquez sur les jours où vous êtes disponible, jusqu'à 14 dates. Vos disponibilités nous aident à construire la programmation, mais nous ne pouvons pas garantir qu'elles seront respectées."
          >
            <div className="field wide">
              <span className="label">
                Dates souhaitées <span className="required">*</span>
              </span>
              <DatePicker value={form.dates} onChange={(dates) => update('dates', dates)} first={first} last={last} invalid={!!errors.dates} />
              <FieldError message={errors.dates} />
            </div>
            <fieldset className="field wide">
              <legend>Plages horaires préférées</legend>
              <div className="chips">
                {TIME_SLOTS.map((slot) => (
                  <label key={slot.id} className="chip">
                    <input
                      type="checkbox"
                      checked={form.timeSlots.includes(slot.id)}
                      onChange={(event) => update('timeSlots', toggled(form.timeSlots, slot.id, event.target.checked))}
                    />
                    <span>{slot.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Part>

          <Part number="06" title="Autre">
            <div className="field wide">
              <label htmlFor="details">Questions ou détails</label>
              <textarea
                id="details"
                maxLength={DETAILS_MAX_LENGTH}
                placeholder="Besoins techniques, contraintes d'horaire, questions…"
                aria-invalid={errors.details ? true : undefined}
                value={form.details}
                onChange={(event) => update('details', event.target.value)}
              />
              <FieldError message={errors.details} />
            </div>
          </Part>

          <div className="send">
            <div />
            <div className="send-inner">
              {errorCount > 0 && (
                <p className="send-error" role="alert">
                  {errorCount === 1 ? 'Il manque un champ obligatoire ou un champ est à corriger.' : `${errorCount} champs sont à remplir ou à corriger.`}
                </p>
              )}
              {status.state === 'failed' && errorCount === 0 && (
                <p className="send-error" role="alert">
                  {status.error}
                </p>
              )}
              {turnstileSiteKey && <Turnstile key={turnstileWidget} siteKey={turnstileSiteKey} onToken={setTurnstileToken} />}
              <button className="submit" type="submit" disabled={status.state === 'sending'}>
                {status.state === 'sending' ? 'envoi…' : 'envoyer ma candidature'}
              </button>
              <p className="send-note">
                Les champs marqués d'un <span className="required">*</span> sont obligatoires. Votre candidature est envoyée à l'équipe de
                parking.radio.
              </p>
            </div>
          </div>
        </form>
        {/* GeoNames' terms ask for credit (https://www.geonames.org/export/). */}
        <p className="credits">
          Suggestions de villes&nbsp;:{' '}
          <a href="https://www.geonames.org" target="_blank" rel="noreferrer">
            GeoNames
          </a>
        </p>
      </div>
    </div>
  )
}

function Sent({ email }: { email: string }) {
  return (
    <section className="sent" tabIndex={-1} ref={(element) => element?.focus()}>
      <div className="sent-bar">
        <h2>Candidature envoyée</h2>
      </div>
      <div className="sent-body">
        <p className="big">Merci&nbsp;!</p>
        <p>
          Nous avons bien reçu votre candidature. Une confirmation vient d'être envoyée à <b>{email}</b>.
        </p>
        <p>
          En raison d'un volume élevé de candidatures, le traitement des demandes peut prendre jusqu'à un mois. Seuls les artistes et
          collectifs retenus seront contactés par courriel. Si vous n'avez reçu aucune réponse dans les trois mois suivant votre
          candidature, n'hésitez pas à postuler de nouveau. Nous ferons notre possible pour vous trouver une place dans notre
          programmation.
        </p>
      </div>
    </section>
  )
}
