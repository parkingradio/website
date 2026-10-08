import { useState } from 'react'
import { DETAILS_MAX_LENGTH, PRESTATION_MAX_LENGTH, checkApplication, isDay, isTime } from 'shared/applications'
import type { ApplicationFields, TimeSlot } from 'shared/applications'
import type { Artist } from 'shared/artists'
import { leaving, useCheckedForm } from './checked-form'
import { FieldError, FormActions, Labeled } from './fields'

// A form for an application's fields, to create an application or change one. Each field is checked with the rules
// the server checks it with (see `checkApplication`), and says what's wrong once it's been left, or once the form is
// sent. The server's error is shown if it refuses the application anyway.

// The prestations that are offered as choices. Any other can be written in.
const PRESTATION_CHOICES = ['DJ', 'Performance live', 'Rap', 'Full band']

const EMPTY: ApplicationFields = { dates: [], timeSlots: [], prestations: [], details: '' }

type Field = keyof ApplicationFields | 'artist'

// Whether two prestations are the same, which the server also decides whatever their case.
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const isChoice = (prestation: string) => PRESTATION_CHOICES.some((choice) => same(choice, prestation))

type ApplicationFormProps = {
  // The application to change, or nothing for a new one.
  application?: ApplicationFields
  // For a new application: the artists it can be for, and the one picked at first, if any.
  artists?: { all: Artist[]; initial: string | null }
  submitLabel: string
  // Sends the application, with the artist picked for a new one, and returns the error, if it failed.
  onSubmit: (fields: ApplicationFields, artistId: string) => Promise<string | null>
  onCancel?: () => void
}

export function ApplicationForm({ application = EMPTY, artists, submitLabel, onSubmit, onCancel }: ApplicationFormProps) {
  // An artist that isn't one of those listed, e.g. from an outdated link, isn't picked.
  const [artistId, setArtistId] = useState(artists?.all.find((artist) => artist.id === artists.initial)?.id ?? '')
  // Days as "YYYY-MM-DD", or empty for a field that's not filled yet.
  const [dates, setDates] = useState(application.dates.length > 0 ? application.dates : [''])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>(application.timeSlots)
  // The prestations checked, and those written in, each as it was written, so that changing something else doesn't
  // change them.
  const [chosen, setChosen] = useState(application.prestations.filter(isChoice))
  const [others, setOthers] = useState(application.prestations.filter((prestation) => !isChoice(prestation)))
  const [details, setDetails] = useState(application.details)

  const fields: ApplicationFields = {
    // An empty date, e.g. one that's only partly typed, is wrong rather than dropped, unless it's the only one.
    dates: dates.length === 1 && !dates[0] ? [] : dates,
    // A slot left entirely empty is dropped, but one that's half filled is wrong.
    timeSlots: timeSlots.filter((slot) => slot.start || slot.end),
    prestations: [...chosen, ...others],
    details,
  }
  const errors: Partial<Record<Field, string>> = { ...checkApplication(fields).errors }
  if (artists && !artistId) errors.artist = "Choisis l'artiste."
  const { form, submit, busy, error, shown, leave } = useCheckedForm(errors, () => onSubmit(fields, artistId))

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

      <fieldset className="admin-fields" onBlur={leaving(leave('prestations'))}>
        <legend>Type de prestation</legend>
        <div className="admin-choices">
          {PRESTATION_CHOICES.map((choice) => (
            <label key={choice}>
              <input
                type="checkbox"
                checked={chosen.some((prestation) => same(prestation, choice))}
                onChange={(event) =>
                  setChosen(event.target.checked ? [...chosen, choice] : chosen.filter((prestation) => !same(prestation, choice)))
                }
              />
              {choice}
            </label>
          ))}
        </div>
        {others.map((other, index) => (
          <div className="admin-row" key={index}>
            <input
              aria-label={`Autre prestation ${index + 1}`}
              value={other}
              maxLength={PRESTATION_MAX_LENGTH}
              aria-invalid={shown('prestations') ? true : undefined}
              onChange={(event) => setOthers(others.map((prestation, i) => (i === index ? event.target.value : prestation)))}
            />
            <button type="button" aria-label={`retirer l'autre prestation ${index + 1}`} onClick={() => setOthers(others.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setOthers([...others, ''])}>
          ajouter une autre prestation
        </button>
        <FieldError message={shown('prestations')} />
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
