import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { Artist, GenreId } from '../../artist-profile'
import { Combobox } from '../../combobox'
import { quebecDayAndTime } from '../../quebec-time'
import { after, checkSet, durationOf, setPlace } from '../../session-fields'
import type { Reference, Session, SetFields, SetFormValues, SetPlace } from '../../session-fields'
import { leaving, useCheckedForm } from './checked-form'
import { artistOption, formatDuration, genreNames, membersGenres, nextDay, sessionWithin } from './describe'
import { DurationField, FieldError, FormActions, Labeled, PerformanceTypesField } from './fields'
import { OrderedList } from './ordered-list'
import { GenresField } from './profile-fields'
import type { GroupProps } from './profile-fields'

// A form for a set of a session, to add a set or change one. Like the artist form (see artist-form.tsx), each field is
// checked as the server checks it (see `checkSet`), and says what's wrong once it's been left, or once the form is sent,
// and the server's error is shown if it refuses the set anyway.

// How many of its performers' genres a set's form suggests.
const SUGGESTED_GENRES = 3

type SetFormProps = {
  // The session the set is in, which its times are relative to.
  session: Session
  // What the form starts with: a set's, to change it, or what a new one starts with.
  initial: SetFormValues
  // The artists the performers are picked from, or null when they couldn't be loaded, which leaves those of the set as
  // they are.
  artists: Artist[] | null
  submitLabel: string
  // Sends the set's fields, and returns the error, if it failed.
  onSubmit: (fields: SetFields) => Promise<ReactNode | null>
  onCancel: () => void
}

export function SetForm({ session, initial, artists, submitLabel, onSubmit, onCancel }: SetFormProps) {
  const [form, setForm] = useState(initial)
  const update = (changes: Partial<SetFormValues>) => setForm((form) => ({ ...form, ...changes }))
  const place = setPlace(form, session)
  const checked = checkSet(form, session, place)
  const errors = checked.errors ?? {}
  // There are fields, since there are no errors by then.
  const { form: formRef, submit, busy, error, shown, leave } = useCheckedForm(errors, () => onSubmit(checked.fields!))

  // The performers' first genres, in the order of a collective's genres, which are suggested while the set has none.
  const suggested =
    artists && form.genres.length === 0 ? membersGenres(form.performers, new Map(artists.map((artist) => [artist.id, artist]))).slice(0, SUGGESTED_GENRES) : []

  const input = (field: 'soundcloudTrack' | 'youtubeVideo') => ({
    value: form[field],
    'aria-invalid': shown(field) ? true : undefined,
    onChange: (event: { target: { value: string } }) => update({ [field]: event.target.value }),
    onBlur: leave(field),
  })

  return (
    <form ref={formRef} className="admin-form admin-form-wide" onSubmit={submit} noValidate>
      <PerformersField
        performers={form.performers}
        artists={artists}
        onChange={(performers) => update({ performers })}
        error={shown('performers')}
        onLeave={leave('performers')}
      />

      <PlaceField
        form={form}
        session={session}
        place={'errors' in place ? null : place}
        onChange={update}
        errors={{ start: shown('start'), end: shown('end'), offset: shown('offset'), duration: shown('duration') }}
        onLeave={leave('start', 'end', 'offset', 'duration')}
      />

      <PerformanceTypesField
        performanceTypes={form.performanceTypes}
        otherPerformanceType={form.otherPerformanceType}
        onChange={(performanceTypes) => update({ performanceTypes })}
        onOtherChange={(otherPerformanceType) => update({ otherPerformanceType })}
        error={shown('otherPerformanceType')}
        onLeave={leave('otherPerformanceType')}
      />

      <GenresField genres={form.genres} onChange={(genres) => update({ genres })} error={shown('genres')} onLeave={leave('genres')}>
        {suggested.length > 0 && <GenresSuggestion genres={suggested} onPick={() => update({ genres: suggested })} />}
      </GenresField>

      <Labeled label="SoundCloud" error={shown('soundcloudTrack')}>
        <input {...input('soundcloudTrack')} type="url" placeholder="https://soundcloud.com/…" />
      </Labeled>

      <Labeled label="YouTube" error={shown('youtubeVideo')}>
        <input {...input('youtubeVideo')} type="url" placeholder="https://www.youtube.com/watch?v=…" />
      </Labeled>

      <FormActions error={error} busy={busy} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  )
}

function GenresSuggestion({ genres, onPick }: { genres: GenreId[]; onPick: () => void }) {
  return (
    <p className="admin-hint">
      Genres de ses artistes&nbsp;: {genreNames(genres)}.{' '}
      <button type="button" onClick={onPick}>
        reprendre les genres des artistes
      </button>
    </p>
  )
}

// The set's artists, in order, each of whom can be moved up or down or removed, then the field that picks another one
// among the known artists. The set's artists are offered too, so that typing one of their names finds them, but they
// can't be picked again.
function PerformersField({ performers, artists, onChange, error, onLeave }: GroupProps<Reference[]> & { performers: Reference[]; artists: Artist[] | null }) {
  const pickerId = useId()
  const options = (artists ?? []).map((artist) =>
    performers.some((performer) => performer.id === artist.id) ? { ...artistOption(artist), detail: 'déjà dans le set', disabled: true } : artistOption(artist),
  )
  const pick = (id: string) => {
    const artist = artists?.find((artist) => artist.id === id)
    if (artist) onChange([...performers, { id, name: artist.name }])
  }
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Artistes</legend>
      <p className="admin-hint">Dans leur ordre de présentation. Un artiste qui n'est pas encore connu s'ajoute d'abord dans la section «&nbsp;artistes&nbsp;».</p>
      <OrderedList items={performers} keyOf={(performer) => performer.id} label={(performer) => performer.name} onChange={onChange} nextFocus={pickerId} />
      <div className="admin-field">
        <label htmlFor={pickerId}>Ajouter un artiste</label>
        <Combobox
          id={pickerId}
          options={options}
          selected={null}
          onSelect={pick}
          placeholder={artists ? 'choisir un artiste…' : "les artistes n'ont pas pu être chargés"}
          disabled={!artists}
          invalid={!!error}
        />
      </div>
      <FieldError message={error} />
    </fieldset>
  )
}

// When a set that starts `offsetMinutes` after `sessionStart` and lasts `durationMinutes` is on a later day than the
// session's start, since a start time before the session's is the next day's: e.g. ", commence le lendemain, dimanche
// 15 novembre 2026", or else ", finit le lendemain, ...", or "" when it's all on the session's day.
function laterDay(sessionStart: string, offsetMinutes: number, durationMinutes: number): string {
  const start = new Date(sessionStart)
  const day = quebecDayAndTime(start).day
  const setStart = after(start, offsetMinutes)
  return nextDay('commence', setStart, day) || nextDay('finit', after(setStart, durationMinutes), day)
}

// Where the set is in its session: in a session with a date, the times it starts and ends, in Québec time; in a session
// without one, its start, after the session's, and its duration; or only its duration, while its place isn't known.
function PlaceField({
  form,
  session,
  place,
  onChange,
  errors,
  onLeave,
}: {
  form: SetFormValues
  session: Session
  // Its offset and duration, once its times are valid.
  place: SetPlace | null
  onChange: (changes: Partial<SetFormValues>) => void
  errors: Partial<Record<'start' | 'end' | 'offset' | 'duration', string>>
  onLeave: () => void
}) {
  const dated = session.start !== null
  const durationMinutes = place?.durationMinutes ?? null
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Horaire</legend>
      <p className="admin-hint">
        {dated ? `La session a lieu ${sessionWithin(session)}.` : `La session dure ${formatDuration(session.durationMinutes)}.`}
        {dated && !form.unplaced && ' Heure du Québec.'}
      </p>
      <div className="admin-choices">
        <label>
          <input
            type="checkbox"
            checked={form.unplaced}
            onChange={(event) => {
              // Keeps how long the set lasts, when its times say it.
              const unplaced = event.target.checked
              onChange(unplaced && durationMinutes !== null ? { unplaced, duration: durationOf(durationMinutes) } : { unplaced })
            }}
          />
          horaire à déterminer
        </label>
      </div>
      {form.unplaced ? (
        <DurationField label="Durée" value={form.duration} onChange={(duration) => onChange({ duration })} error={errors.duration} />
      ) : dated ? (
        <>
          <div className="admin-row admin-times">
            <label>
              Début
              <input type="time" value={form.start} aria-invalid={errors.start ? true : undefined} onChange={(event) => onChange({ start: event.target.value })} />
            </label>
            <label>
              Fin
              <input type="time" value={form.end} aria-invalid={errors.end ? true : undefined} onChange={(event) => onChange({ end: event.target.value })} />
            </label>
          </div>
          {place !== null && place.offsetMinutes !== null && (
            <p className="admin-hint" role="status">
              Dure {formatDuration(place.durationMinutes!)}
              {laterDay(session.start!, place.offsetMinutes, place.durationMinutes!)}.
            </p>
          )}
          <FieldError message={errors.start ?? errors.end} />
        </>
      ) : (
        <>
          <DurationField label="Début, après celui de la session" value={form.offset} onChange={(offset) => onChange({ offset })} error={errors.offset} />
          <DurationField label="Durée" value={form.duration} onChange={(duration) => onChange({ duration })} error={errors.duration} />
        </>
      )}
    </fieldset>
  )
}
