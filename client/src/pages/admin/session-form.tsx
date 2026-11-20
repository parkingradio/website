import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Loaded } from '../../api/use-api'
import type { Schema } from '../../api/client'
import type { Application } from '../../application-fields'
import { pickedPhotoError } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { Combobox } from '../../combobox'
import type { ComboboxFilter, ComboboxOption } from '../../combobox'
import { formatLongQuebecDay } from '../../quebec-time'
import {
  DESCRIPTION_MAX_LENGTH,
  SESSION_TYPES,
  TYPE_DESCRIPTIONS,
  checkSession,
  durationOf,
  isCollectivesApplication,
  sessionTimes,
  startChanges,
  typeName,
} from '../../session-fields'
import type { ListedSet, RaEventLink, Reference, SessionFields, SessionFormValues, SessionType } from '../../session-fields'
import { raEventId } from '../../session-links'
import { ApplicationField } from './application-field'
import { leaving, useCheckedForm } from './checked-form'
import { SESSION_TYPE_LABELS, collectiveOption, formatDuration, formatQuebecDay } from './describe'
import { DurationField, FieldError, FormActions, Labeled } from './fields'
import { ListedSets } from './listed-sets'
import type { OpenListedSet } from './listed-sets'
import { compareText, search } from './list'
import { PhotoField } from './profile-fields'
import type { GroupProps, ImageChange } from './profile-fields'

// A form for a session and its flyer, to add a session, with the sets listed to be added with it, or change one, but not
// its sets. Like the artist form (see artist-form.tsx), each field is checked as the server checks it (see
// `checkSession`), and says what's wrong once it's been left, or once the form is sent, and the server's error is shown
// if it refuses the session anyway.

export type SessionFormProps = {
  // What the form starts with: a session's, to change it, or what a new one starts with.
  initial: SessionFormValues
  // Whether the session is announced, which it has to have a date for.
  announced?: boolean
  // Whether the session is cancelled, which a new one isn't.
  cancelled?: boolean
  // The address of the session's flyer, if it has one.
  flyer?: string | null
  // The collectives a takeover's is picked from, or null when they couldn't be loaded, which leaves the session's as it
  // is.
  collectives: Collective[] | null
  // The applications a takeover's is picked from, or null when they couldn't be loaded, which leaves the session's as it
  // is.
  applications: Application[] | null
  // Every one of Parking Radio's events, read from RA, which the form doesn't wait for.
  raEvents: Loaded<Schema<'RaEvents'>>
  // For a new session: the sets listed to be added with it at first, which can be changed in the form, and are sent
  // with it.
  sets?: ListedSet[]
  submitLabel: string
  // Sends the session's fields, as `PATCH /api/admin/sessions/:id` takes them, and `POST /api/admin/sessions` too, with
  // the listed sets for a new session, and what changes of its flyer, which is never 'remove'
  // for a new session, and returns the error, if it failed.
  onSubmit: (session: SessionFields, flyer: ImageChange, sets: ListedSet[]) => Promise<ReactNode | null>
  onCancel?: () => void
}

export function SessionForm({
  initial,
  announced = false,
  cancelled = false,
  flyer: current = null,
  collectives,
  applications,
  raEvents,
  sets: initialSets,
  submitLabel,
  onSubmit,
  onCancel,
}: SessionFormProps) {
  const formId = useId()
  const [form, setForm] = useState(initial)
  const [sets, setSets] = useState(initialSets)
  const update = (changes: Partial<SessionFormValues>) => setForm((form) => ({ ...form, ...changes }))
  const [flyer, setFlyer] = useState<File | null>(null)
  // Whether to remove the session's flyer, which only happens once the form is sent.
  const [removeFlyer, setRemoveFlyer] = useState(false)
  const times = sessionTimes(form)
  const checked = checkSession(form, times, applications, announced)
  const errors: Partial<Record<keyof SessionFormValues | 'flyer', string>> = { ...checked.errors }
  const flyerProblem = pickedPhotoError(flyer, 'flyer')
  if (flyerProblem) errors.flyer = flyerProblem
  // The listed set whose form is open, if any.
  const [openSet, setOpenSet] = useState<OpenListedSet | null>(null)
  // The collective whose artists the listed sets' forms offer first, for a takeover.
  const takeover = (form.type === 'takeover' && collectives?.find((collective) => collective.id === form.takeover?.id)) || null
  const { form: formRef, submit, busy, error, shown, leave } = useCheckedForm(errors, () => {
    // There are fields, since there are no errors by then.
    return onSubmit(checked.fields!, flyer ?? (removeFlyer ? 'remove' : null), sets ?? [])
  })

  return (
    <>
      <form id={formId} ref={formRef} className="admin-form admin-form-wide" onSubmit={submit} noValidate>
        <TimesField
          form={form}
          times={times}
          onChange={(changes) => {
            update(changes)
            // So that it says right away when an announced session is left without a date.
            if ('undated' in changes) leave('undated')()
          }}
          errors={{
            undated: shown('undated'),
            day: shown('day'),
            start: shown('start'),
            endDay: shown('endDay'),
            end: shown('end'),
            duration: shown('duration'),
          }}
          onLeave={leave('day', 'start', 'endDay', 'end', 'duration')}
        />

        <TypeField type={form.type} onChange={(type) => update({ type })} error={shown('type')} onLeave={leave('type')} />

        {form.type === 'takeover' && (
          <>
            <TakeoverField
              takeover={form.takeover}
              collectives={collectives}
              onChange={(takeover) => {
                update({ takeover })
                // So that it says right away when its application isn't the collective's.
                leave('application')()
              }}
              error={shown('takeover')}
              onLeave={leave('takeover')}
            />
            <ApplicationField
              candidates={applications?.filter((application) => isCollectivesApplication(application, form.takeover)) ?? []}
              applications={applications}
              own={initial.application}
              selected={form.application}
              cancelled={cancelled}
              empty={form.takeover ? 'Aucune candidature de ce collectif.' : "Choisissez d'abord le collectif."}
              onChange={(application) => update({ application })}
              error={shown('application')}
              onLeave={leave('application')}
            />
          </>
        )}

        <NameField form={form} onChange={(name) => update({ name })} error={shown('name')} onLeave={leave('name')} />

        <DescriptionField form={form} onChange={(description) => update({ description })} error={shown('description')} onLeave={leave('description')} />

        <PhotoField
          image="flyer"
          current={current}
          removed={removeFlyer}
          onRemove={() => setRemoveFlyer(true)}
          photo={flyer}
          onChange={(flyer) => {
            setFlyer(flyer)
            leave('flyer')()
          }}
          error={shown('flyer')}
        />

        <RaEventField event={form.raEvent} own={initial.raEvent} raEvents={raEvents} onChange={(raEvent) => update({ raEvent })} />

        {!sets && <FormActions error={error} busy={busy} submitLabel={submitLabel} onCancel={onCancel} />}
      </form>
      {sets && (
        <>
          <ListedSets
            sets={sets}
            durationMinutes={'errors' in times ? null : times.durationMinutes}
            open={openSet}
            takeover={takeover}
            busy={busy}
            onChange={setSets}
            onOpen={setOpenSet}
          />
          {/* After the sets, whose forms can't be within the session's. */}
          <div className="admin-form admin-form-wide">
            <FormActions
              form={formId}
              error={error}
              busy={busy}
              submitLabel={submitLabel}
              onCancel={onCancel}
              unavailable={openSet ? `${openSet.index === null ? 'Ajoutez' : 'Enregistrez'} d'abord le set, ou annulez-le.` : null}
            />
          </div>
        </>
      )}
    </>
  )
}

// The days and times the session starts and ends at, in Québec time, then how long it lasts, once they're valid. Or only
// its duration, while its date isn't known.
function TimesField({
  form,
  times,
  onChange,
  errors,
  onLeave,
}: {
  form: SessionFormValues
  times: ReturnType<typeof sessionTimes>
  onChange: (changes: Partial<SessionFormValues>) => void
  errors: Partial<Record<'undated' | 'day' | 'start' | 'endDay' | 'end' | 'duration', string>>
  onLeave: () => void
}) {
  // How long the session lasts, once its days and times are valid.
  const lasts = 'start' in times && times.start ? times.durationMinutes : null
  // Checking "date à déterminer" keeps how long the session lasts, when its times say it.
  const setUndated = (undated: boolean) => {
    const dated = sessionTimes({ ...form, undated: false })
    onChange(undated && 'start' in dated ? { undated, duration: durationOf(dated.durationMinutes) } : { undated })
  }
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Quand</legend>
      <div className="admin-choices">
        <label>
          <input
            type="checkbox"
            checked={form.undated}
            aria-invalid={errors.undated ? true : undefined}
            onChange={(event) => setUndated(event.target.checked)}
          />
          date à déterminer
        </label>
      </div>
      <FieldError message={errors.undated} alert />
      {form.undated ? (
        <DurationField label="Durée" value={form.duration} onChange={(duration) => onChange({ duration })} error={errors.duration} />
      ) : (
        <>
          <DayAndTime
            label="Début"
            day={form.day}
            time={form.start}
            onDay={(day) => onChange(startChanges(form, { day }))}
            onTime={(start) => onChange(startChanges(form, { start }))}
            dayError={errors.day}
            timeError={errors.start}
          />
          <DayAndTime
            label="Fin"
            day={form.endDay}
            time={form.end}
            onDay={(endDay) => onChange({ endDay })}
            onTime={(end) => onChange({ end })}
            dayError={errors.endDay}
            timeError={errors.end}
          />
          {lasts !== null && (
            <p className="admin-hint" role="status">
              Dure {formatDuration(lasts)}.
            </p>
          )}
        </>
      )}
    </fieldset>
  )
}

// A day and a time, in Québec time, under `label`, with what's wrong with either.
function DayAndTime({
  label,
  day,
  time,
  onDay,
  onTime,
  dayError,
  timeError,
}: {
  label: string
  day: string
  time: string
  onDay: (day: string) => void
  onTime: (time: string) => void
  dayError: string | undefined
  timeError: string | undefined
}) {
  const id = useId()
  return (
    <div className="admin-field">
      <span id={id}>{label}</span>
      <div className="admin-row admin-times" role="group" aria-labelledby={id}>
        <label>
          date
          <input type="date" value={day} aria-invalid={dayError ? true : undefined} onChange={(event) => onDay(event.target.value)} />
        </label>
        <label>
          heure
          <input type="time" value={time} aria-invalid={timeError ? true : undefined} onChange={(event) => onTime(event.target.value)} />
        </label>
      </div>
      <FieldError message={dayError ?? timeError} />
    </div>
  )
}

// The session's type, one of which is picked.
function TypeField({ type, onChange, error, onLeave }: GroupProps<SessionType> & { type: SessionType | null }) {
  const name = useId()
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Type</legend>
      <div className="admin-choices">
        {SESSION_TYPES.map((value) => (
          <label key={value}>
            <input type="radio" name={name} checked={type === value} aria-invalid={error ? true : undefined} onChange={() => onChange(value)} />
            {SESSION_TYPE_LABELS[value]}
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </fieldset>
  )
}

// The collective whose takeover the session is, which a takeover has to have. When the collectives couldn't be loaded,
// the session's stays.
function TakeoverField({
  takeover,
  collectives,
  onChange,
  error,
  onLeave,
}: GroupProps<Reference> & { takeover: Reference | null; collectives: Collective[] | null }) {
  const id = useId()
  const listed = collectives ? collectives.map(collectiveOption).sort((a, b) => compareText(a.label, b.label)) : takeover ? [{ key: takeover.id, label: takeover.name }] : []
  return (
    <div className="admin-field">
      <label htmlFor={id}>Collectif</label>
      <Combobox
        id={id}
        options={listed}
        onBlur={onLeave}
        invalid={!!error}
        selected={takeover?.id ?? null}
        onSelect={(key) => {
          const collective = collectives?.find((collective) => collective.id === key)
          if (collective) onChange({ id: collective.id, name: collective.name })
        }}
        placeholder="choisir un collectif…"
        disabled={!collectives}
      />
      <FieldError message={error} />
    </div>
  )
}

// The session's own name, which a session of type "other" needs, and which replaces the one the other types give it,
// which the empty field shows.
function NameField({ form, onChange, error, onLeave }: GroupProps<string> & { form: SessionFormValues }) {
  const placeholder = (form.type && typeName(form.type, form.takeover)) ?? (form.type === 'takeover' ? 'NOM DU COLLECTIF TAKEOVER' : 'p. ex. LISTENING PARTY')
  return (
    <Labeled label="Nom" error={error}>
      <input
        value={form.name}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onLeave}
      />
    </Labeled>
  )
}

// The session's own description, which replaces the one its type gives it, which the empty field shows, and which can be
// taken as a start, to change a few words of it.
function DescriptionField({ form, onChange, error, onLeave }: GroupProps<string> & { form: SessionFormValues }) {
  const id = useId()
  const typed = form.type && TYPE_DESCRIPTIONS[form.type]
  return (
    <div className="admin-field">
      <label htmlFor={id}>Description</label>
      <textarea
        id={id}
        value={form.description}
        rows={8}
        maxLength={DESCRIPTION_MAX_LENGTH}
        placeholder={typed || undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onLeave}
      />
      <FieldError message={error} />
      {typed && form.description !== typed && (
        <p className="admin-hint">
          Vide, c'est celle de son type.{' '}
          <button type="button" onClick={() => onChange(typed)}>
            reprendre le texte par défaut
          </button>
        </p>
      )}
    </div>
  )
}

const NO_EVENT: ComboboxOption = { key: '', label: 'Aucun événement RA' }

// The options of the event on RA, keyed by their event's number (see "The session form" in
// docs/design/client/admin/sessions.md), with each one's event and what it's searched by.
function raEventChoices(loaded: Loaded<Schema<'RaEvents'>>, own: RaEventLink | null) {
  const read = loaded.kind === 'loaded' ? [...loaded.value.upcoming, ...loaded.value.past] : []
  const choices = new Map<string, { event: RaEventLink; searched: string[] }>(
    read.map((event) => [event.id, { event: { id: event.id, url: event.url }, searched: [event.title, formatLongQuebecDay(event.start)] }]),
  )
  const options = [NO_EVENT]
  if (own && !choices.has(own.id)) {
    options.push({ key: own.id, label: `Événement RA n° ${own.id}` })
    // Its number is searched exactly, like the others'.
    choices.set(own.id, { event: own, searched: ['Événement RA'] })
  }
  options.push(...read.map((event) => ({ key: event.id, label: `${event.title}, ${formatQuebecDay(event.start)}`, detail: `n° ${event.id}` })))
  // As the lists are searched, by title and day, and, when only digits are typed, by its number too, or part of it,
  // exactly, since Parking Radio's are close to each other. Or by a link to its page, with or without its `https://`.
  const filter: ComboboxFilter = (options, query) => {
    const typed = query.trim()
    const digits = /^\d+$/.test(typed)
    // Only what's typed as a link is taken as one: a bare number is searched as a number, below.
    const linked = digits ? null : raEventId(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
    if (linked) return options.filter((option) => option.key === linked)
    const found = search(options, typed, (option) => choices.get(option.key)?.searched ?? [option.label])
    if (!digits) return found
    const searched = new Set(found)
    return options.filter((option) => searched.has(option) || option.key.includes(typed))
  }
  return { options, choices, filter }
}

// The event on RA, picked among Parking Radio's events, or the session's own (`own`), or none, with a link to its page.
function RaEventField({
  event,
  own,
  raEvents: loaded,
  onChange,
}: {
  event: RaEventLink | null
  own: RaEventLink | null
  raEvents: Loaded<Schema<'RaEvents'>>
  onChange: (event: RaEventLink | null) => void
}) {
  const id = useId()
  const { options, choices, filter } = useMemo(() => raEventChoices(loaded, own), [loaded, own])
  return (
    <div className="admin-field">
      <label htmlFor={id}>Événement RA</label>
      <Combobox
        id={id}
        options={options}
        selected={event?.id ?? ''}
        onSelect={(key) => onChange(choices.get(key)?.event ?? null)}
        filter={filter}
        placeholder={loaded.kind === 'loading' ? 'chargement des événements…' : 'choisir un événement…'}
      />
      {event && (
        <p className="admin-hint">
          <a href={event.url} target="_blank" rel="noreferrer">
            {event.url}
          </a>
        </p>
      )}
      {loaded.kind === 'error' && <p className="admin-hint">Les événements n'ont pas pu être lus sur RA&nbsp;: {loaded.message.replace(/\.$/, '')}.</p>}
    </div>
  )
}
