import { useId, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useApi } from '../../api/use-api'
import type { Application } from '../../application-fields'
import type { Artist, GenreId } from '../../artist-profile'
import { Combobox } from '../../combobox'
import { checkSet, isPerformersApplication } from '../../session-fields'
import type { Reference, SetFields, SetFormValues } from '../../session-fields'
import { ApplicationField } from './application-field'
import { leaving, useCheckedForm } from './checked-form'
import { artistOption, formatDuration, genreNames, membersGenres } from './describe'
import { DurationField, FieldError, FormActions, Labeled, PerformanceTypesField } from './fields'
import { OrderedList } from './ordered-list'
import { ApplicationsFailure, ArtistsFailure } from './profile-details'
import { GenresField } from './profile-fields'
import type { GroupProps } from './profile-fields'

// A form for a set of a session, to add a set or change one. Like the artist form (see artist-form.tsx), each field is
// checked as the server checks it (see `checkSet`), and says what's wrong once it's been left, or once the form is sent,
// and the server's error is shown if it refuses the set anyway.

// How many of its performers' genres a set's form suggests.
const SUGGESTED_GENRES = 3

// The session a set is in, as far as its form goes: how long it lasts, which is null for a new session while its times
// aren't valid.
export type SetSession = { durationMinutes: number | null }

type SetFormProps = {
  // The session the set is in, whose duration the form says.
  session: SetSession
  // What the form starts with: a set's, to change it, or what a new one starts with.
  initial: SetFormValues
  // The artists the performers are picked from, or null when they couldn't be loaded, which leaves those of the set as
  // they are.
  artists: Artist[] | null
  // The applications the set's is picked from, or null when they couldn't be loaded, which leaves the set's as it is.
  applications: Application[] | null
  submitLabel: string
  // Sends the set's fields, which `form` has, and returns the error, if it failed.
  onSubmit: (fields: SetFields, form: SetFormValues) => Promise<ReactNode | null>
  onCancel: () => void
}

export function SetForm({ session, initial, artists, applications, submitLabel, onSubmit, onCancel }: SetFormProps) {
  const [form, setForm] = useState(initial)
  const update = (changes: Partial<SetFormValues>) => setForm((form) => ({ ...form, ...changes }))
  const checked = checkSet(form, applications)
  const errors = checked.errors ?? {}
  // There are fields, since there are no errors by then.
  const { form: formRef, submit, busy, error, shown, leave } = useCheckedForm(errors, () => onSubmit(checked.fields!, form))

  // The performers' first genres, in the order of a collective's genres, which are suggested while the set has none.
  const suggested =
    artists && form.genres.length === 0 ? membersGenres(form.performers, new Map(artists.map((artist) => [artist.id, artist]))).slice(0, SUGGESTED_GENRES) : []

  // The applications of its performers, in their order: each performer's on their own, to keep that order.
  const candidates = form.performers.flatMap((performer) => applications?.filter((application) => isPerformersApplication(application, [performer])) ?? [])
  const artistName = (application: Application) => (artists ?? form.performers).find((artist) => artist.id === application.artistId)?.name

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
        onChange={(performers) => {
          update({ performers })
          // So that it says right away when its application isn't one of theirs anymore.
          leave('application')()
        }}
        error={shown('performers')}
        onLeave={leave('performers')}
      />

      <ApplicationField
        candidates={candidates}
        applications={applications}
        own={initial.application}
        selected={form.application}
        ownerName={artistName}
        empty={
          form.performers.length === 0
            ? "Choisissez d'abord les artistes."
            : `Aucune candidature ${form.performers.length === 1 ? 'de cet artiste' : 'de ces artistes'}.`
        }
        onChange={(application) => update({ application })}
        error={shown('application')}
        onLeave={leave('application')}
      />

      <div onBlur={leaving(leave('duration'))}>
        <DurationField label="Durée" value={form.duration} onChange={(duration) => update({ duration })} error={shown('duration')} />
        <p className="admin-hint">
          {session.durationMinutes === null
            ? "La durée de la session n'est pas encore indiquée."
            : `La session dure ${formatDuration(session.durationMinutes)}.`}{' '}
          Laissez vide tant que la durée du set n'est pas connue.
        </p>
      </div>

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

// What a set's form starts with, given the artists and the applications it loaded, or null when they couldn't be: null
// shows nothing.
export type InitialSet = SetFormValues | ((loaded: { artists: Artist[] | null; applications: Application[] | null }) => SetFormValues | null)

// A set's form, under the heading `title`, and what `children` say of the set, with every artist and application to pick
// from, loaded each time it opens, so that they're current, and nothing until then. When they can't be loaded, it says
// so. With `reveal`, it's brought into view once it shows, its heading focused.
export function SetFormWithChoices({
  title,
  children,
  initial,
  reveal = false,
  ...props
}: Omit<SetFormProps, 'artists' | 'applications' | 'initial'> & { title: string; children?: ReactNode; initial: InitialSet; reveal?: boolean }) {
  const artists = useApi('/api/admin/artists')
  const applications = useApi('/api/admin/applications')
  const headingId = useId()
  const loaded = artists.kind !== 'loading' && applications.kind !== 'loading'
  const choices = { artists: artists.kind === 'loaded' ? artists.value.artists : null, applications: applications.kind === 'loaded' ? applications.value.applications : null }
  const values = !loaded ? null : typeof initial === 'function' ? initial(choices) : initial
  const shown = reveal && values !== null
  // Before the form is painted, so that it's never seen elsewhere.
  useLayoutEffect(() => {
    if (!shown) return
    const heading = document.getElementById(headingId)
    heading?.focus({ preventScroll: true })
    heading?.scrollIntoView?.({ block: 'start' })
  }, [shown, headingId])
  if (values === null) return null

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={reveal ? -1 : undefined}>
        {title}
      </h3>
      {children}
      {artists.kind === 'error' && <ArtistsFailure message={artists.message} />}
      {applications.kind === 'error' && <ApplicationsFailure message={applications.message} />}
      <SetForm {...props} initial={values} {...choices} />
    </section>
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
