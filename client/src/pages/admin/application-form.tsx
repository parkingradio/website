import { useId, useState } from 'react'
import type { Body } from '../../api/client'
import {
  DETAILS_MAX_LENGTH,
  PERFORMANCE_TYPES,
  checkApplication,
  checkReceivedAt,
  isDay,
  isTime,
} from '../../application-fields'
import type { ApplicationFields, TimeSlot } from '../../application-fields'
import type { Artist } from '../../artist-profile'
import type { Checked } from '../../checks'
import type { Collective } from '../../collective-profile'
import { Combobox } from '../../combobox'
import type { ComboboxOption } from '../../combobox'
import { leaving, useCheckedForm } from './checked-form'
import { KIND_LABELS, artistOption, collectiveOption, entryPath } from './describe'
import type { Owner } from './describe'
import { compareText } from './list'
import { FieldError, FormActions, Labeled, PerformanceTypesField } from './fields'

// A form for an application's fields, to create an application or change one. Each field is checked as the server checks
// it (see `checkApplication`), and says what's wrong once it's been left, or once the form is sent. The server's error is
// shown if it refuses the application anyway.

// What changing an application sends: its fields, and when it was received, if that changed.
type ApplicationChanges = Body<'put', '/api/admin/applications/{id}'>

const EMPTY: ApplicationFields = { dates: [], timeSlots: [], performanceTypes: [], otherPerformanceType: '', details: '' }

type Field = keyof ApplicationFields | 'owner' | 'receivedAt'

type ApplicationFormProps = {
  // The application to change, with when it was received, or nothing for a new one.
  application?: ApplicationChanges
  // For a new application: the artists and collectives it can be for, and the one picked at first, if any.
  owners?: { artists: Artist[]; collectives: Collective[]; initial: Owner | null }
  submitLabel: string
  // Sends the application, with who it's for for a new one, and returns the error, if it failed. `receivedAt` is left out
  // unless the day it was received was picked, or changed.
  onSubmit: (fields: ApplicationChanges, owner: Owner) => Promise<string | null>
  onCancel?: () => void
}

// The artists and collectives a new application can be for, by name, where collectives say so.
function ownerOptions(artists: Artist[], collectives: Collective[]): (ComboboxOption & { owner: Owner })[] {
  return [
    ...artists.map((artist) => ({ ...artistOption(artist), owner: { kind: 'artist' as const, id: artist.id } })),
    ...collectives.map((collective) => {
      const option = collectiveOption(collective)
      const detail = [KIND_LABELS.collective, option.detail].filter(Boolean).join(', ')
      return { ...option, detail, owner: { kind: 'collective' as const, id: collective.id } }
    }),
  ]
    // Keyed by the address of their page, which tells artists and collectives apart.
    .map((option) => ({ ...option, key: entryPath(option.owner.kind, option.owner.id) }))
    .sort((a, b) => compareText(a.label, b.label))
}

// The day of `instant` (ISO 8601), as "YYYY-MM-DD", in the browser's time zone, where the admin pages show dates.
function localDay(instant: string): string {
  const date = new Date(instant)
  const pad = (part: number, length: number) => String(part).padStart(length, '0')
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`
}

// When an application was received, to send, from the day picked: the start of that day in the browser's time zone, or
// nothing if it's still `initialDay`, so that the time it was received at is kept. Returns what's wrong with the day
// instead, if anything.
function checkReceivedDay(day: string, initialDay: string): Checked<string | undefined> {
  if (day === initialDay) return { value: undefined }
  // Only a new application can be left without a day, as received now.
  if (!day) return { error: 'Choisissez le jour où la candidature a été reçue.' }
  // Browsers let years have more than 4 digits, which aren't dates the server takes.
  if (!isDay(day)) return { error: 'La date de réception est invalide.' }
  const receivedAt = new Date(`${day}T00:00`)
  const error = checkReceivedAt(receivedAt)
  return error === null ? { value: receivedAt.toISOString() } : { error }
}

export function ApplicationForm({ application = EMPTY, owners, submitLabel, onSubmit, onCancel }: ApplicationFormProps) {
  const ownerId = useId()
  const options = owners ? ownerOptions(owners.artists, owners.collectives) : []
  // An artist or a collective that isn't one of those listed, e.g. from an outdated link, isn't picked.
  const [ownerPicked, setOwnerPicked] = useState(owners?.initial ? entryPath(owners.initial.kind, owners.initial.id) : null)
  const owner = options.find((option) => option.key === ownerPicked)?.owner
  // The day the application was received, as "YYYY-MM-DD", or empty for a new one, which was received now.
  const initialDay = application.receivedAt ? localDay(application.receivedAt) : ''
  const [receivedDay, setReceivedDay] = useState(initialDay)
  // Days as "YYYY-MM-DD", or empty for a field that's not filled yet.
  const [dates, setDates] = useState(application.dates.length > 0 ? application.dates : [''])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(application.timeSlots)
  const [performanceTypes, setPerformanceTypes] = useState(application.performanceTypes)
  const [otherPerformanceType, setOtherPerformanceType] = useState(application.otherPerformanceType)
  const [details, setDetails] = useState(application.details)

  const fields: ApplicationFields = {
    // An empty date, e.g. one that's only partly typed, is wrong rather than dropped, unless it's the only one.
    dates: dates.length === 1 && !dates[0] ? [] : dates,
    // A slot left entirely empty is dropped, but one that's half filled is wrong.
    timeSlots: timeSlots.filter((slot) => slot.start || slot.end),
    // In the order of the list, like the server keeps them.
    performanceTypes: PERFORMANCE_TYPES.filter((id) => performanceTypes.includes(id)),
    otherPerformanceType,
    details,
  }
  const { value: receivedAt, error: receivedAtError } = checkReceivedDay(receivedDay, initialDay)
  const errors: Partial<Record<Field, string>> = { ...checkApplication(fields).errors }
  if (owners && !owner) errors.owner = "Choisissez l'artiste ou le collectif."
  if (receivedAtError) errors.receivedAt = receivedAtError
  // There's an owner for a new application, since there are no errors by then.
  const { form, submit, busy, error, shown, leave } = useCheckedForm(errors, () => onSubmit({ ...fields, receivedAt }, owner!))

  const changeSlot = (index: number, changes: Partial<TimeSlot>) =>
    setTimeSlots(timeSlots.map((slot, i) => (i === index ? { ...slot, ...changes } : slot)))

  // Whether a slot that's been filled is wrong, to tell which one when the time slots are.
  const wrongSlot = ({ start, end }: TimeSlot) => !!shown('timeSlots') && (start || end) !== '' && !(isTime(start) && isTime(end) && start < end)

  return (
    <form ref={form} className="admin-form admin-form-wide" onSubmit={submit} noValidate>
      {owners && (
        <div className="admin-field">
          <label htmlFor={ownerId}>Artiste ou collectif</label>
          <Combobox
            id={ownerId}
            options={options}
            selected={ownerPicked}
            onSelect={setOwnerPicked}
            onBlur={leave('owner')}
            invalid={!!shown('owner')}
            placeholder="choisir un artiste ou un collectif…"
          />
          <FieldError message={shown('owner')} />
        </div>
      )}

      <Labeled label="Reçue le" error={shown('receivedAt')}>
        <input
          type="date"
          value={receivedDay}
          aria-invalid={shown('receivedAt') ? true : undefined}
          onChange={(event) => setReceivedDay(event.target.value)}
          onBlur={leave('receivedAt')}
        />
      </Labeled>
      <p className="admin-hint">Le jour où l'artiste a envoyé sa candidature.{!application.receivedAt && " Sans date, c'est aujourd'hui."}</p>

      <fieldset className="admin-fields" onBlur={leaving(leave('dates'))}>
        <legend>Dates souhaitées</legend>
        {dates.map((date, index) => (
          <div className="admin-row" key={index}>
            <input
              type="date"
              aria-label={`Date ${index + 1}`}
              aria-invalid={shown('dates') && (!date || !isDay(date)) ? true : undefined}
              value={date}
              onChange={(event) => setDates(dates.map((other, i) => (i === index ? event.target.value : other)))}
            />
            {dates.length > 1 && (
              <button type="button" aria-label={`retirer la date ${index + 1}`} onClick={() => setDates(dates.filter((_, i) => i !== index))}>
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setDates([...dates, ''])}>
          ajouter une date
        </button>
        <FieldError message={shown('dates')} />
      </fieldset>

      <fieldset className="admin-fields" onBlur={leaving(leave('timeSlots'))}>
        <legend>Plages horaires</legend>
        <p className="admin-hint">Heure du Québec. Sans plage horaire, l'artiste peut jouer à toute heure.</p>
        {timeSlots.map((slot, index) => (
          <div className="admin-row" key={index}>
            <input
              type="time"
              aria-label={`Début de la plage ${index + 1}`}
              aria-invalid={wrongSlot(slot) || undefined}
              value={slot.start}
              onChange={(event) => changeSlot(index, { start: event.target.value })}
            />
            à
            <input
              type="time"
              aria-label={`Fin de la plage ${index + 1}`}
              aria-invalid={wrongSlot(slot) || undefined}
              value={slot.end}
              onChange={(event) => changeSlot(index, { end: event.target.value })}
            />
            <button type="button" aria-label={`retirer la plage ${index + 1}`} onClick={() => setTimeSlots(timeSlots.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setTimeSlots([...timeSlots, { start: '', end: '' }])}>
          ajouter une plage horaire
        </button>
        <FieldError message={shown('timeSlots')} />
      </fieldset>

      <PerformanceTypesField
        performanceTypes={performanceTypes}
        otherPerformanceType={otherPerformanceType}
        onChange={setPerformanceTypes}
        onOtherChange={setOtherPerformanceType}
        error={shown('otherPerformanceType')}
        onLeave={leave('otherPerformanceType')}
      />

      <Labeled label="Questions ou détails" error={shown('details')}>
        <textarea
          value={details}
          rows={5}
          maxLength={DETAILS_MAX_LENGTH}
          aria-invalid={shown('details') ? true : undefined}
          onChange={(event) => setDetails(event.target.value)}
          onBlur={leave('details')}
        />
      </Labeled>

      <FormActions error={error} busy={busy} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  )
}
