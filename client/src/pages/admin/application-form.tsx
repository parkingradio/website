import { useState } from 'react'
import type { Body } from '../../api/client'
import {
  DETAILS_MAX_LENGTH,
  OTHER_PRESTATION_MAX_LENGTH,
  PRESTATIONS,
  checkApplication,
  checkReceivedAt,
  isDay,
  isTime,
  prestationName,
} from '../../application-fields'
import type { ApplicationFields, TimeSlot } from '../../application-fields'
import type { Artist } from '../../artist-profile'
import type { Checked } from '../../checks'
import { leaving, useCheckedForm } from './checked-form'
import { FieldError, FormActions, Labeled } from './fields'

// A form for an application's fields, to create an application or change one. Each field is checked as the server checks
// it (see `checkApplication`), and says what's wrong once it's been left, or once the form is sent. The server's error is
// shown if it refuses the application anyway.

// What changing an application sends: its fields, and when it was received, if that changed.
type ApplicationChanges = Body<'put', '/api/admin/applications/{id}'>

const EMPTY: ApplicationFields = { dates: [], timeSlots: [], prestations: [], otherPrestation: '', details: '' }

type Field = keyof ApplicationFields | 'artist' | 'receivedAt'

type ApplicationFormProps = {
  // The application to change, with when it was received, or nothing for a new one.
  application?: ApplicationChanges
  // For a new application: the artists it can be for, and the one picked at first, if any.
  artists?: { all: Artist[]; initial: string | null }
  submitLabel: string
  // Sends the application, with the artist picked for a new one, and returns the error, if it failed. `receivedAt` is
  // left out unless the day it was received was picked, or changed.
  onSubmit: (fields: ApplicationChanges, artistId: string) => Promise<string | null>
  onCancel?: () => void
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

export function ApplicationForm({ application = EMPTY, artists, submitLabel, onSubmit, onCancel }: ApplicationFormProps) {
  // An artist that isn't one of those listed, e.g. from an outdated link, isn't picked.
  const [artistId, setArtistId] = useState(artists?.all.find((artist) => artist.id === artists.initial)?.id ?? '')
  // The day the application was received, as "YYYY-MM-DD", or empty for a new one, which was received now.
  const initialDay = application.receivedAt ? localDay(application.receivedAt) : ''
  const [receivedDay, setReceivedDay] = useState(initialDay)
  // Days as "YYYY-MM-DD", or empty for a field that's not filled yet.
  const [dates, setDates] = useState(application.dates.length > 0 ? application.dates : [''])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(application.timeSlots)
  const [prestations, setPrestations] = useState(application.prestations)
  const [otherPrestation, setOtherPrestation] = useState(application.otherPrestation)
  const [details, setDetails] = useState(application.details)

  const fields: ApplicationFields = {
    // An empty date, e.g. one that's only partly typed, is wrong rather than dropped, unless it's the only one.
    dates: dates.length === 1 && !dates[0] ? [] : dates,
    // A slot left entirely empty is dropped, but one that's half filled is wrong.
    timeSlots: timeSlots.filter((slot) => slot.start || slot.end),
    // In the order of the list, like the server keeps them.
    prestations: PRESTATIONS.filter((id) => prestations.includes(id)),
    otherPrestation,
    details,
  }
  const { value: receivedAt, error: receivedAtError } = checkReceivedDay(receivedDay, initialDay)
  const errors: Partial<Record<Field, string>> = { ...checkApplication(fields).errors }
  if (artists && !artistId) errors.artist = "Choisissez l'artiste."
  if (receivedAtError) errors.receivedAt = receivedAtError
  const { form, submit, busy, error, shown, leave } = useCheckedForm(errors, () => onSubmit({ ...fields, receivedAt }, artistId))

  const changeSlot = (index: number, changes: Partial<TimeSlot>) =>
    setTimeSlots(timeSlots.map((slot, i) => (i === index ? { ...slot, ...changes } : slot)))

  // Whether a slot that's been filled is wrong, to tell which one when the time slots are.
  const wrongSlot = ({ start, end }: TimeSlot) => !!shown('timeSlots') && (start || end) !== '' && !(isTime(start) && isTime(end) && start < end)

  return (
    <form ref={form} className="admin-form admin-form-wide" onSubmit={submit} noValidate>
      {artists && (
        <Labeled label="Artiste" error={shown('artist')}>
          <select value={artistId} aria-invalid={shown('artist') ? true : undefined} onChange={(event) => setArtistId(event.target.value)} onBlur={leave('artist')}>
            <option value="">choisir un artiste…</option>
            {artists.all.map((artist) => (
              <option key={artist.id} value={artist.id}>
                {artist.name} ({artist.email})
              </option>
            ))}
          </select>
        </Labeled>
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

      <fieldset className="admin-fields">
        <legend>Type de prestation</legend>
        <div className="admin-choices">
          {PRESTATIONS.map((id) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={prestations.includes(id)}
                onChange={(event) => setPrestations(event.target.checked ? [...prestations, id] : prestations.filter((other) => other !== id))}
              />
              {prestationName(id)}
            </label>
          ))}
        </div>
        <Labeled label="Autre" error={shown('otherPrestation')}>
          <input
            placeholder="en quelques mots"
            value={otherPrestation}
            maxLength={OTHER_PRESTATION_MAX_LENGTH}
            aria-invalid={shown('otherPrestation') ? true : undefined}
            onChange={(event) => setOtherPrestation(event.target.value)}
            onBlur={leave('otherPrestation')}
          />
        </Labeled>
      </fieldset>

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
