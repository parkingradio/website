import { useState } from 'react'
import type { Body, Schema } from '../../api/client'
import {
  ARTIST_KINDS,
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  GENRES,
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  checkProfile,
  pickedPhotoError,
} from '../../artist-profile'
import { checkLine } from '../../checks'
import type { Artist, Profile, GenreId } from '../../artist-profile'
import { KIND_LABELS, genreName, photoUrl } from './describe'
import { leaving, useCheckedForm } from './checked-form'
import { FieldError, FormActions, Labeled } from './fields'
import { CountryField, LinksField, PhotoField } from './profile-fields'
import type { GroupProps } from './profile-fields'

// A form for an artist's profile and photo, to add an artist or change one. Each field is checked as the server checks it
// for admins (see `checkProfile`), and says what's wrong once it's been left, or once the form is sent. The server's
// error is shown if it refuses the artist anyway, e.g. for an email address another artist has.
//
// It only adds artists, since collectives have their own form (see collective-form.tsx), but an artist whose `kind` is
// "collective", as collectives were before they had their own profiles, can still be changed, until they're migrated.

const EMPTY: Profile = {
  kind: 'artist',
  name: '',
  members: [],
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
  // The name of a collective's artist being typed, before it's pinned.
  const [memberEntry, setMemberEntry] = useState('')

  // Admins can leave out more than artists can, e.g. for artists who applied through the original Google Form.
  const checked = checkProfile(profile, { lenient: true })
  const errors: Partial<Record<Field, string>> = { ...checked.errors }
  // Only the names pinned are sent. One that's left typed would be lost, so it has to be pinned (or cleared) first.
  const unpinned = profile.kind === 'collective' ? memberEntry.trim() : ''
  if (unpinned) errors.members = `« ${unpinned} » n'est pas ajouté : appuyer sur + pour l'ajouter.`
  // The artist keeps their photo, if they have one, unless another one is chosen or it's removed.
  const photoProblem = pickedPhotoError(photo)
  if (photoProblem) errors.photo = photoProblem
  const { form, submit, busy, error, submitted, shown, leave } = useCheckedForm(errors, () => {
    // What's saved of the profile, e.g. without the members of an artist who was a collective at first. There's one,
    // since there are no errors by then, and a collective's has an email, which its type doesn't say.
    const artist = checked.profile! as Schema<'AdminArtistProfile'>
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
      {initial?.kind === 'collective' && (
        <fieldset className="admin-choices">
          <legend>Type</legend>
          {ARTIST_KINDS.map((kind) => (
            <label key={kind}>
              <input type="radio" name="kind" value={kind} checked={profile.kind === kind} onChange={() => update({ kind })} />
              {KIND_LABELS[kind]}
            </label>
          ))}
        </fieldset>
      )}

      <Labeled label={profile.kind === 'collective' ? 'Nom du collectif' : "Nom d'artiste"} error={shown('name')}>
        <input {...input('name')} maxLength={NAME_MAX_LENGTH} required />
      </Labeled>

      {profile.kind === 'collective' && (
        <MembersField
          members={profile.members}
          onChange={(members) => update({ members })}
          entry={memberEntry}
          onEntryChange={setMemberEntry}
          error={shown('members')}
          onLeave={leave('members')}
        />
      )}

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

// A collective's artists: each name is typed (`entry`), then pinned with + or Enter. Only the names pinned are sent, so
// a name left typed is an error, which the form says.
function MembersField({
  members,
  onChange,
  entry,
  onEntryChange,
  error,
  onLeave,
}: GroupProps<string[]> & { members: string[]; entry: string; onEntryChange: (entry: string) => void }) {
  const pin = () => {
    // The input's maxLength keeps the name short enough; a name with the NUL character, which the server refuses, is
    // dropped.
    const { value } = checkLine(entry, "Le nom d'un artiste du collectif", NAME_MAX_LENGTH, null)
    if (value && !members.some((member) => member.toLowerCase() === value.toLowerCase())) onChange([...members, value])
    onEntryChange('')
  }

  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Artistes du collectif</legend>
      {members.length > 0 && (
        <ul className="admin-chosen">
          {members.map((member) => (
            <li key={member}>
              {member}
              <button type="button" aria-label={`retirer ${member}`} onClick={() => onChange(members.filter((other) => other !== member))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="admin-row">
        <input
          aria-label="Nom d'un artiste du collectif"
          aria-invalid={error ? true : undefined}
          value={entry}
          maxLength={NAME_MAX_LENGTH}
          onChange={(event) => onEntryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Pins the name rather than sending the form.
              event.preventDefault()
              pin()
            }
          }}
        />
        <button type="button" aria-label="ajouter cet artiste au collectif" onClick={pin}>
          +
        </button>
      </div>
      <FieldError message={error} />
    </fieldset>
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

