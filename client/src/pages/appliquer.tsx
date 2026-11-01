import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, formData } from '../api/client'
import { DETAILS_MAX_LENGTH, OTHER_PRESTATION_MAX_LENGTH, PRESTATIONS, checkApplication, prestationName } from '../application-fields'
import type { ApplicationFields, PrestationId } from '../application-fields'
import { checkApplicant } from '../applicant'
import type { ApplicantKind } from '../applicant'
import { CITY_MAX_LENGTH, LINK_SITES, NAME_MAX_LENGTH, countryOptions, parseLink, pickedPhotoError } from '../artist-profile'
import type { Profile, GenreId, LinkSiteId } from '../artist-profile'
import { Combobox } from '../combobox'
import { useTurnstileSiteKey } from '../config-context'
import { APPLY_BIO_MAX_LENGTH, MAX_GENRES, MAX_MEMBERS, PRIORITY_COUNTRIES, SLOT_HOURS, TIME_SLOTS, prestationError, selectableDates } from './appliquer/choices'
import type { TimeSlotId } from './appliquer/choices'
import { DatePicker } from './appliquer/date-picker'
import { useCitySuggestions } from './appliquer/geonames'
import { GenrePicker } from './appliquer/genre-picker'
import { LinksField } from './appliquer/links-field'
import { PhotoField } from './appliquer/photo-field'
import { Turnstile } from './appliquer/turnstile'
import './appliquer.css'

// The "Appliquer" page: the form artists fill in to apply for a set, which sends their profile and their application
// to `POST /api/applications`. It checks them as the server does (see `checkApplicant` and `checkApplication`), and sets
// a few limits of its own (see appliquer/choices.ts).

// With their codes, e.g. to find the United States by typing "US".
const COUNTRY_OPTIONS = countryOptions(PRIORITY_COUNTRIES).map((option) => ({ ...option, detail: option.key }))

const KIND_OPTIONS: { kind: ApplicantKind; title: string; text: string }[] = [
  { kind: 'artist', title: 'Artiste', text: 'Vous jouez seul·e (ou en b2b) pendant une heure, dans une plage de notre programmation.' },
  { kind: 'collective', title: 'Collectif', text: "Vous prenez en main une plage entière avec votre line-up d'artistes." },
]

type Form = {
  kind: ApplicantKind | null
  name: string
  // A collective's artists, one field each (an empty one to start with).
  members: string[]
  country: string | null
  city: string
  genres: GenreId[]
  photo: File | null
  bio: string
  // What the artist typed for each site, as is.
  links: Partial<Record<LinkSiteId, string>>
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
  members: [''],
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

type Field = keyof Profile | 'kind' | 'members' | keyof ApplicationFields | 'photo'

// The profile and the application, as they're sent, before they're checked.
function sent(form: Form) {
  return {
    artist: {
      kind: form.kind,
      name: form.name,
      members: form.kind === 'collective' ? form.members : [],
      country: form.country,
      city: form.city,
      genres: form.genres,
      bio: form.bio,
      links: form.links,
      email: form.email,
      phone: form.phone,
    },
    application: {
      dates: form.dates,
      timeSlots: TIME_SLOTS.filter(({ id }) => form.timeSlots.includes(id)).map(({ start, end }) => ({ start, end })),
      prestations: form.prestations,
      otherPrestation: form.otherChecked ? form.otherPrestation : '',
      details: form.details,
    },
  }
}

// The profile and the application to send, as the server would save them, or what's missing or wrong, by field: what
// the server would say, and what the form asks for on top of that. The server checks it all again.
function checked(form: Form) {
  const { artist, application } = sent(form)
  const applicant = checkApplicant(artist)
  const fields = checkApplication(application)
  const errors: Partial<Record<Field, string>> = { ...applicant.errors, ...fields.errors }
  // A link that's wrong says why next to it, so the links as a whole only say to fix it, rather than say it again.
  if (errors.links && LINK_SITES.some((site) => parseLink(site, form.links[site.id] ?? '').error)) errors.links = 'Corrigez les liens en rouge.'
  const photo = pickedPhotoError(form.photo)
  if (photo) errors.photo = photo
  const prestation = prestationError(form.prestations, form.otherChecked ? form.otherPrestation : null)
  if (prestation) errors.prestations ??= prestation
  if (applicant.applicant && fields.application && Object.keys(errors).length === 0) {
    return { errors, applicant: applicant.applicant, application: fields.application }
  }
  return { errors }
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

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="error">{message}</span> : null
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
  const citySuggestions = useCitySuggestions(form.country, form.city)

  // Changing anything clears why the form couldn't be sent, which may be what was just changed.
  const edit = (change: (current: Form) => Form) => {
    setForm(change)
    setStatus((current) => (current.state === 'failed' ? { state: 'editing' } : current))
  }
  const update = <K extends keyof Form>(key: K, value: Form[K]) => edit((current) => ({ ...current, [key]: value }))
  const result = checked(form)
  const errors = attempts > 0 ? result.errors : {}
  const errorCount = Object.keys(errors).length

  // After a failed attempt, bring the artist to the first field to fix (only then, not on every change).
  useEffect(() => {
    if (attempts === 0) return
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    invalid?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    invalid?.focus({ preventScroll: true })
  }, [attempts])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setAttempts((count) => count + 1)
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
      body: { artist: applicant, application, photo: form.photo ?? undefined, turnstileToken },
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
          <Part number="01" title="L'artiste">
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
            <div className="field wide">
              <label htmlFor="artist-name">
                {form.kind === 'collective' ? 'Nom du collectif' : "Nom d'artiste"} <span className="required">*</span>
              </label>
              <input
                id="artist-name"
                type="text"
                maxLength={NAME_MAX_LENGTH}
                autoComplete="nickname"
                aria-invalid={errors.name ? true : undefined}
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
              />
              <FieldError message={errors.name} />
            </div>
            {form.kind === 'collective' && (
              <fieldset className={errors.members ? 'field wide invalid' : 'field wide'}>
                <legend>
                  Artistes du collectif <span className="required">*</span>{' '}
                  <span className="hint">— jusqu'à {MAX_MEMBERS}, ceux et celles qui représentent le collectif</span>
                </legend>
                <div className="members">
                  {form.members.map((member, index) => (
                    <div key={index} className="member">
                      <span className="member-number">{index + 1}</span>
                      <input
                        type="text"
                        aria-label={`Artiste ${index + 1} du collectif`}
                        maxLength={NAME_MAX_LENGTH}
                        aria-invalid={errors.members && index === 0 ? true : undefined}
                        autoFocus={index > 0 && index === form.members.length - 1 && !member}
                        value={member}
                        onChange={(event) => update('members', form.members.map((m, i) => (i === index ? event.target.value : m)))}
                      />
                      {form.members.length > 1 && (
                        <button
                          type="button"
                          className="member-remove"
                          aria-label={`Enlever l'artiste ${index + 1}`}
                          onClick={() => update('members', form.members.filter((_, i) => i !== index))}
                        >
                          <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                            <path d="M1 1l8 8M9 1 1 9" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {form.members.length < MAX_MEMBERS && (
                  <button type="button" className="add-member" onClick={() => update('members', [...form.members, ''])}>
                    + ajouter un artiste ({form.members.length} / {MAX_MEMBERS})
                  </button>
                )}
                <FieldError message={errors.members} />
                <p className="flyer-note">
                  <strong>Takeovers&nbsp;:</strong> nous demandons aux collectifs de produire un flyer (carte blanche).
                </p>
              </fieldset>
            )}
            <div className="field">
              <label htmlFor="artiste-pays">
                Pays <span className="required">*</span>
              </label>
              <Combobox
                // Not "country", which Safari takes as an address field to fill from the visitor's contact card, on top of
                // the countries suggested here.
                id="artiste-pays"
                options={COUNTRY_OPTIONS}
                selected={form.country}
                placeholder="tapez pour chercher…"
                invalid={!!errors.country}
                // The cities suggested are those of the country, so another country starts the city over.
                onSelect={(country) => edit((current) => (country === current.country ? current : { ...current, country, city: '' }))}
              />
              <FieldError message={errors.country} />
            </div>
            <div className="field">
              <label htmlFor="artiste-ville">
                Ville <span className="required">*</span>
              </label>
              <Combobox
                // Like the country: not "city", and no autofill, which would suggest the visitor's own city on top of
                // those suggested here.
                id="artiste-ville"
                placeholder={form.country ? 'nom de votre ville' : "choisissez d'abord un pays"}
                disabled={!form.country}
                invalid={!!errors.city}
                maxLength={CITY_MAX_LENGTH}
                options={citySuggestions}
                text={{ value: form.city, onChange: (city) => update('city', city) }}
              />
              <FieldError message={errors.city} />
            </div>
            <fieldset className={errors.genres ? 'field wide invalid' : 'field wide'}>
              <legend className="genres-legend">
                <span>
                  Genres musicaux <span className="required">*</span>{' '}
                  <span className="hint">— jusqu'à {MAX_GENRES}, dans l'ordre : le premier est votre genre principal</span>
                </span>
                <span className={form.genres.length >= MAX_GENRES ? 'count full' : 'count'} aria-live="polite">
                  {form.genres.length} / {MAX_GENRES}
                </span>
              </legend>
              <GenrePicker value={form.genres} onChange={(genres) => update('genres', genres)} invalid={!!errors.genres} />
              <FieldError message={errors.genres} />
            </fieldset>
          </Part>

          <Part number="02" title="Présentation">
            <div className="field wide">
              <label htmlFor="photo">
                Photo <span className="hint">— une photo de presse en bonne qualité pour notre site web</span>
              </label>
              <PhotoField value={form.photo} onChange={(photo) => update('photo', photo)} invalid={!!errors.photo} />
              <FieldError message={errors.photo} />
            </div>
            <div className="field wide">
              <label htmlFor="bio">
                Bio <span className="required">*</span>
              </label>
              <textarea
                id="bio"
                maxLength={APPLY_BIO_MAX_LENGTH}
                placeholder="Quelques lignes sur vous ou votre projet."
                aria-invalid={errors.bio ? true : undefined}
                value={form.bio}
                onChange={(event) => update('bio', event.target.value)}
              />
              <span className="count-chars">
                {form.bio.length} / {APPLY_BIO_MAX_LENGTH}
              </span>
              <FieldError message={errors.bio} />
            </div>
            <fieldset className={errors.links ? 'field wide invalid' : 'field wide'}>
              <legend>
                Liens <span className="required">*</span>{' '}
                <span className="hint">— au moins un</span>
              </legend>
              <LinksField values={form.links} onChange={(links) => update('links', links)} showErrors={attempts > 0} invalid={!!errors.links} />
              <FieldError message={errors.links} />
            </fieldset>
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

          <Part number="04" title="Contact" note="Pour vous répondre. Vous recevrez une confirmation à cette adresse.">
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
          Nous avons bien reçu votre candidature. Une confirmation vient d'être envoyée à <b>{email}</b>. Nous vous recontacterons par e-mail
          dès que nous aurons regardé les dates.
        </p>
      </div>
    </section>
  )
}
