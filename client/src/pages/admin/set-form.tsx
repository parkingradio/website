import { useId, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useApi } from '../../api/use-api'
import type { Loaded } from '../../api/use-api'
import type { Application } from '../../application-fields'
import type { Artist, GenreId } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { Combobox } from '../../combobox'
import type { ComboboxFilter } from '../../combobox'
import { matching } from '../../combobox-matching'
import { checkSet, performersApplications, pickedApplication } from '../../session-fields'
import type { Reference, SessionStatus, SetFields, SetFormValues } from '../../session-fields'
import { ApplicationField } from './application-field'
import { leaving, useCheckedForm } from './checked-form'
import { artistOption, genreNames, membersGenres } from './describe'
import { DurationField, FieldError, FormActions, Labeled, PerformanceTypesField } from './fields'
import { OrderedList } from './ordered-list'
import { ApplicationsFailure, ArtistsFailure, TakeoverFailure } from './profile-details'
import { GenresField } from './profile-fields'
import type { GroupProps } from './profile-fields'

// A form for a set of a session, to add a set or change one. Like the artist form (see artist-form.tsx), each field is
// checked as the server checks it (see `checkSet`), and says what's wrong once it's been left, or once the form is sent,
// and the server's error is shown if it refuses the set anyway.

// How many of its performers' genres a set's form suggests.
const SUGGESTED_GENRES = 3

// The collective of a takeover, whose artists its sets' forms offer first.
export type TakeoverCollective = Pick<Collective, 'name' | 'members'>

type SetFormProps = {
  // What the form starts with: a set's, to change it, or what a new one starts with.
  initial: SetFormValues
  // The artists the performers are picked from, or null when they couldn't be loaded, which leaves those of the set as
  // they are.
  artists: Artist[] | null
  // The applications the set's is picked from, or null when they couldn't be loaded, which leaves the set's as it is.
  applications: Application[] | null
  // The collective of the set's session, for a takeover, or null when it isn't one, or its collective couldn't be loaded.
  takeover: TakeoverCollective | null
  // The set's status, which a new one has as planned.
  status?: SessionStatus
  submitLabel: string
  // Sends the set's fields, which `form` has, and returns the error, if it failed.
  onSubmit: (fields: SetFields, form: SetFormValues) => Promise<ReactNode | null>
  onCancel: () => void
}

export function SetForm({ initial, artists, applications, takeover, status = 'planned', submitLabel, onSubmit, onCancel }: SetFormProps) {
  const [form, setForm] = useState(initial)
  const update = (changes: Partial<SetFormValues>) => setForm((form) => ({ ...form, ...changes }))
  const checked = checkSet(form, applications)
  const errors = checked.errors ?? {}
  // There are fields, since there are no errors by then.
  const { form: formRef, submit, busy, error, shown, leave } = useCheckedForm(errors, () => onSubmit(checked.fields!, form))

  // The performers' first genres, in the order of a collective's genres, which are suggested while the set has none.
  const suggested =
    artists && form.genres.length === 0 ? membersGenres(form.performers, new Map(artists.map((artist) => [artist.id, artist]))).slice(0, SUGGESTED_GENRES) : []

  const candidates = performersApplications(applications, form.performers)
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
        takeover={takeover}
        onChange={(performers) => {
          // A planned set's application is picked as an artist is added or taken out, but not as they're reordered.
          const picks = status === 'planned' && !sameArtists(performers, form.performers)
          update({ performers, ...(picks && { application: pickedApplication(form.application, performersApplications(applications, performers)) }) })
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
        cancelled={status === 'cancelled'}
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

// Whether `a` and `b` are the same artists, whatever their order.
const sameArtists = (a: Reference[], b: Reference[]) => a.length === b.length && a.every(({ id }) => b.some((artist) => artist.id === id))

// What a set's form starts with, given the artists and the applications it loaded, or null when they couldn't be: null
// shows nothing.
export type InitialSet = SetFormValues | ((loaded: { artists: Artist[] | null; applications: Application[] | null }) => SetFormValues | null)

// A set's form, under the heading `title`, and what `children` say of the set, with every artist and application to pick
// from, loaded each time it opens, so that they're current, and nothing until then, nor until its session's `takeover`
// collective is loaded, if it's a takeover. When they can't be loaded, it says so. With `reveal`, it's brought into view
// once it shows, its heading focused.
export function SetFormWithChoices({
  title,
  children,
  initial,
  takeover,
  reveal = false,
  ...props
}: Omit<SetFormProps, 'artists' | 'applications' | 'initial' | 'takeover'> & {
  title: string
  children?: ReactNode
  initial: InitialSet
  // Its session's collective, for a takeover, or null when it isn't one.
  takeover: Loaded<TakeoverCollective> | null
  reveal?: boolean
}) {
  const artists = useApi('/api/admin/artists')
  const applications = useApi('/api/admin/applications')
  const headingId = useId()
  const loaded = artists.kind !== 'loading' && applications.kind !== 'loading' && takeover?.kind !== 'loading'
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
      {takeover?.kind === 'error' && <TakeoverFailure message={takeover.message} />}
      <SetForm {...props} initial={values} {...choices} takeover={takeover?.kind === 'loaded' ? takeover.value : null} />
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
// among the other known artists: for a takeover, its collective's first, in its order, marked with its name, which stay
// first among those that what's typed finds.
function PerformersField({
  performers,
  artists,
  takeover,
  onChange,
  error,
  onLeave,
}: GroupProps<Reference[]> & { performers: Reference[]; artists: Artist[] | null; takeover: TakeoverCollective | null }) {
  const pickerId = useId()
  const byId = new Map((artists ?? []).map((artist) => [artist.id, artist]))
  // Those of its artists who are among the known artists, e.g. not those deleted since the collective was loaded.
  const members = (takeover?.members ?? []).flatMap((member) => byId.get(member.id) ?? [])
  const memberIds = new Set(members.map((member) => member.id))
  const performerIds = new Set(performers.map((performer) => performer.id))
  const options = [...members, ...(artists ?? []).filter((artist) => !memberIds.has(artist.id))]
    .filter((artist) => !performerIds.has(artist.id))
    .map((artist) => {
      const option = artistOption(artist)
      // What marks the collective's artists.
      return takeover && memberIds.has(artist.id) ? { ...option, detail: takeover.name } : option
    })
  const filter: ComboboxFilter = (options, query) => {
    const found = matching(options, query)
    return [...found.filter((option) => memberIds.has(option.key)), ...found.filter((option) => !memberIds.has(option.key))]
  }
  const pick = (id: string) => {
    const artist = artists?.find((artist) => artist.id === id)
    if (artist) onChange([...performers, { id, name: artist.name }])
  }
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Artistes</legend>
      <p className="admin-hint">Dans leur ordre de présentation.</p>
      <OrderedList items={performers} keyOf={(performer) => performer.id} label={(performer) => performer.name} onChange={onChange} nextFocus={pickerId} />
      <div className="admin-field">
        <label htmlFor={pickerId}>Ajouter un artiste</label>
        <Combobox
          id={pickerId}
          options={options}
          selected={null}
          onSelect={pick}
          filter={filter}
          placeholder={artists ? 'choisir un artiste…' : "les artistes n'ont pas pu être chargés"}
          disabled={!artists}
          invalid={!!error}
        />
      </div>
      <FieldError message={error} />
    </fieldset>
  )
}
