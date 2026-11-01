import { useState } from 'react'
import type { Body } from '../../api/client'
import {
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  GENRES,
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  checkProfile,
  pickedPhotoError,
} from '../../artist-profile'
import type { Artist, Profile, GenreId } from '../../artist-profile'
import { genreName, photoUrl } from './describe'
import { leaving, useCheckedForm } from './checked-form'
import { FieldError, FormActions, Labeled } from './fields'
import { CountryField, LinksField, PhotoField } from './profile-fields'
import type { GroupProps } from './profile-fields'

// A form for an artist's profile and photo, to add an artist or change one. Each field is checked as the server checks it
// for admins (see `checkProfile`), and says what's wrong once it's been left, or once the form is sent. The server's
// error is shown if it refuses the artist anyway, e.g. for an email address another artist has. Collectives have their
// own form (see collective-form.tsx).

const EMPTY: Profile = {
  name: '',
  country: 'CA',
  city: '',
  genres: [],
  bio: '',
  links: {},
  email: '',
  phone: '',
}

type Field = keyof Profile | 'photo'

type ArtistFormProps = {
  // The artist to change, or nothing for a new one.
  artist?: Artist
  submitLabel: string
  // Sends the form, as `PUT /api/admin/artists/:id` takes it, which `POST /api/admin/artists` takes too, without
  // `removePhoto`, and returns the error, if it failed.
  onSubmit: (body: Body<'put', '/api/admin/artists/{id}'>) => Promise<string | null>
  onCancel?: () => void
}

export function ArtistForm({ artist: initial, submitLabel, onSubmit, onCancel }: ArtistFormProps) {
  const [profile, setProfile] = useState<Profile>(initial ?? EMPTY)
  const [photo, setPhoto] = useState<File | null>(null)
  // Whether to remove the artist's photo, which only happens once the form is sent.
  const [removePhoto, setRemovePhoto] = useState(false)

  // Admins can leave out more than artists can, e.g. for artists who applied through the original Google Form.
  const checked = checkProfile(profile, { lenient: true })
  const errors: Partial<Record<Field, string>> = { ...checked.errors }
  // The artist keeps their photo, if they have one, unless another one is chosen or it's removed.
  const photoProblem = pickedPhotoError(photo)
  if (photoProblem) errors.photo = photoProblem
  const { form, submit, busy, error, submitted, shown, leave } = useCheckedForm(errors, () => {
    // What's saved of the profile, which there is, since there are no errors by then.
    const artist = checked.profile!
    return onSubmit({ artist, photo: photo ?? undefined, removePhoto: !photo && removePhoto ? 'true' : undefined })
  })
  const update = (changes: Partial<Profile>) => setProfile((profile) => ({ ...profile, ...changes }))

  // The props of the input of a field of the profile that's a single value.
  const input = (field: 'name' | 'city' | 'bio' | 'email' | 'phone') => ({
    value: profile[field] ?? '',
    'aria-invalid': shown(field) ? true : undefined,
    onChange: (event: { target: { value: string } }) => update({ [field]: event.target.value }),
    onBlur: leave(field),
  })

  return (
    <form ref={form} className="admin-form admin-form-wide" onSubmit={submit} noValidate>
      <Labeled label="Nom d'artiste" error={shown('name')}>
        <input {...input('name')} maxLength={NAME_MAX_LENGTH} required />
      </Labeled>

      <CountryField
        country={profile.country}
        onChange={(country) => update({ country: country as Profile['country'] })}
        error={shown('country')}
        onLeave={leave('country')}
      />

      <Labeled label="Ville" error={shown('city')}>
        <input {...input('city')} maxLength={CITY_MAX_LENGTH} />
      </Labeled>

      <GenresField genres={profile.genres} onChange={(genres) => update({ genres })} error={shown('genres')} onLeave={leave('genres')} />

      <Labeled label="Bio" error={shown('bio')}>
        <textarea {...input('bio')} rows={8} maxLength={BIO_MAX_LENGTH} />
      </Labeled>

      <LinksField
        links={profile.links}
        onChange={(links) => update({ links })}
        showAll={submitted}
        onLeave={leave('links')}
      />

      <Labeled label="Adresse e-mail" error={shown('email')}>
        <input type="email" {...input('email')} maxLength={EMAIL_MAX_LENGTH} />
      </Labeled>

      <Labeled label="Téléphone" error={shown('phone')}>
        <input type="tel" {...input('phone')} maxLength={PHONE_MAX_LENGTH} />
      </Labeled>

      <PhotoField
        current={initial?.hasPhoto ? photoUrl('artists', initial) : null}
        removed={removePhoto}
        onRemove={() => setRemovePhoto(true)}
        photo={photo}
        onChange={(photo) => {
          setPhoto(photo)
          leave('photo')()
        }}
        error={shown('photo')}
      />

      <FormActions error={error} busy={busy} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  )
}

// Every genre, as a tag: clicking one pins it, or unpins it if it was. The genres pinned are listed first, in the order
// they were pinned, which is their order of importance.
function GenresField({ genres, onChange, error, onLeave }: GroupProps<GenreId[]> & { genres: GenreId[] }) {
  const toggle = (genre: GenreId) => onChange(genres.includes(genre) ? genres.filter((other) => other !== genre) : [...genres, genre])
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Genres</legend>
      <p className="admin-hint">Le premier choisi est le genre principal.</p>
      {genres.length > 0 && (
        <ol className="admin-chosen">
          {genres.map((genre, index) => (
            <li key={genre}>
              <b>{index + 1}</b>
              {genreName(genre)}
              <button type="button" aria-label={`retirer ${genreName(genre)}`} onClick={() => toggle(genre)}>
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      {/* Focused when the genres are the first thing to fix, which is why it can be focused. */}
      <div className="admin-tags" role="group" aria-label="Tous les genres" aria-invalid={error ? true : undefined} tabIndex={-1}>
        {GENRES.map((genre) => (
          <button key={genre} type="button" aria-pressed={genres.includes(genre)} onClick={() => toggle(genre)}>
            {genreName(genre)}
          </button>
        ))}
      </div>
      <FieldError message={error} />
    </fieldset>
  )
}

