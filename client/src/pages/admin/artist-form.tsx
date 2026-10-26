import { useEffect, useRef, useState } from 'react'
import { checkLine } from 'shared/checks'
import type { Body } from '../../api/client'
import {
  ARTIST_KINDS,
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  GENRES,
  LINK_SITES,
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  PHOTO_TYPES,
  checkProfile,
  parseLink,
  pickedPhotoError,
} from '../../artist-profile'
import type { Artist, ArtistLinks, Profile, GenreId, LinkSiteId } from '../../artist-profile'
import { Combobox } from '../../combobox'
import { COUNTRY_OPTIONS, KIND_LABELS, genreName, photoUrl } from './describe'
import { leaving, useCheckedForm } from './checked-form'
import { FieldError, FormActions, Labeled } from './fields'

// A form for an artist's profile and photo, to add an artist or change one. Each field is checked as the server checks it
// for admins (see `checkProfile`), and says what's wrong once it's been left, or once the form is sent. The server's
// error is shown if it refuses the artist anyway, e.g. for an email address another artist has.

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
    // since there are no errors by then.
    return onSubmit({ artist: checked.profile!, photo: photo ?? undefined, removePhoto: !photo && removePhoto ? 'true' : undefined })
  })
  const update = (changes: Partial<Profile>) => setProfile((profile) => ({ ...profile, ...changes }))

  // The props of the input of a field of the profile that's a single value.
  const input = (field: 'name' | 'city' | 'bio' | 'email' | 'phone') => ({
    value: profile[field],
    'aria-invalid': shown(field) ? true : undefined,
    onChange: (event: { target: { value: string } }) => update({ [field]: event.target.value }),
    onBlur: leave(field),
  })

  return (
    <form ref={form} className="admin-form admin-form-wide" onSubmit={submit} noValidate>
      <fieldset className="admin-choices">
        <legend>Type</legend>
        {ARTIST_KINDS.map((kind) => (
          <label key={kind}>
            <input type="radio" name="kind" value={kind} checked={profile.kind === kind} onChange={() => update({ kind })} />
            {KIND_LABELS[kind]}
          </label>
        ))}
      </fieldset>

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

      <div className="admin-field">
        <label htmlFor="artist-country">Pays</label>
        <Combobox
          id="artist-country"
          options={COUNTRY_OPTIONS}
          selected={profile.country}
          onSelect={(country) => update({ country: country as Profile['country'] })}
          onBlur={leave('country')}
          invalid={!!shown('country')}
        />
        <FieldError message={shown('country')} />
      </div>

      <Labeled label="Ville" error={shown('city')}>
        <input {...input('city')} maxLength={CITY_MAX_LENGTH} />
      </Labeled>

      <GenresField genres={profile.genres} onChange={(genres) => update({ genres })} error={shown('genres')} onLeave={leave('genres')} />

      <Labeled label="Bio" error={shown('bio')}>
        <textarea {...input('bio')} rows={8} maxLength={BIO_MAX_LENGTH} required />
      </Labeled>

      <LinksField
        links={profile.links}
        onChange={(links) => update({ links })}
        showAll={submitted}
        onLeave={leave('links')}
      />

      <Labeled label="Adresse e-mail" error={shown('email')}>
        <input type="email" {...input('email')} maxLength={EMAIL_MAX_LENGTH} required />
      </Labeled>

      <Labeled label="Téléphone" error={shown('phone')}>
        <input type="tel" {...input('phone')} maxLength={PHONE_MAX_LENGTH} />
      </Labeled>

      <PhotoField
        current={initial?.hasPhoto ? photoUrl(initial) : null}
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

// The photo picked, or else the artist's, if they have one and it isn't removed, each with an × that takes it away,
// then the input that picks a photo, which replaces the artist's. An × goes away once clicked, so the focus goes to the
// input rather than being lost.
function PhotoField({
  current,
  removed,
  onRemove,
  photo,
  onChange,
  error,
}: {
  // The address of the artist's photo, if they have one, and whether it's to be removed.
  current: string | null
  removed: boolean
  onRemove: () => void
  photo: File | null
  onChange: (photo: File | null) => void
  error: string | undefined
}) {
  const input = useRef<HTMLInputElement>(null)
  // The address of the photo picked, to show it, made when it's picked and released once it's replaced or the form is
  // gone. When the browser doesn't know the photo's type, it's shown anyway: the server tells it from its contents.
  const [preview, setPreview] = useState<string | null>(null)
  const shown = useRef<string | null>(null)
  useEffect(() => () => {
    if (shown.current) URL.revokeObjectURL(shown.current)
  }, [])

  const pick = (file: File | null) => {
    if (shown.current) URL.revokeObjectURL(shown.current)
    shown.current = file && (!file.type || PHOTO_TYPES.includes(file.type)) ? URL.createObjectURL(file) : null
    setPreview(shown.current)
    onChange(file)
  }
  const kept = current && !removed ? current : null

  return (
    <div className="admin-field">
      <label htmlFor="artist-photo">Photo</label>
      {photo ? (
        <div className="admin-photo">
          {preview ? <img src={preview} alt="Photo choisie" /> : <span>{photo.name}</span>}
          <button
            type="button"
            aria-label="retirer la photo choisie"
            onClick={() => {
              // So that picking the same file again still counts as a change.
              if (input.current) input.current.value = ''
              pick(null)
              input.current?.focus()
            }}
          >
            ×
          </button>
        </div>
      ) : (
        kept && (
          <div className="admin-photo">
            <img src={kept} alt="Photo actuelle" />
            <button
              type="button"
              aria-label="retirer la photo"
              onClick={() => {
                onRemove()
                input.current?.focus()
              }}
            >
              ×
            </button>
          </div>
        )
      )}
      <input
        ref={input}
        id="artist-photo"
        type="file"
        accept={PHOTO_TYPES.join(',')}
        aria-invalid={error ? true : undefined}
        onChange={(event) => pick(event.target.files?.[0] ?? null)}
      />
      <FieldError message={error} />
      <p className="admin-hint">
        Facultative. JPEG, PNG ou WebP.
        {kept && !photo && ' En choisir une autre remplace la photo actuelle.'}
        {current && removed && !photo && " La photo actuelle sera retirée à l'enregistrement."}
      </p>
    </div>
  )
}

// The props of a field made of several inputs, which is left once the focus leaves all of them.
type GroupProps<T> = {
  onChange: (value: T) => void
  error: string | undefined
  onLeave: () => void
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
    // The input's maxLength keeps the name short enough, so there's nothing else that can be wrong with it.
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

// One input per site. Each one is checked once it's been left, when what was pasted in it is also reduced to what's
// kept of it, e.g. the profile name, with a link to check that it's the right one.
function LinksField({
  links,
  onChange,
  showAll,
  onLeave,
}: Omit<GroupProps<ArtistLinks>, 'error'> & {
  links: ArtistLinks
  // Whether to show the errors of the inputs that haven't been left too, once the form is sent.
  showAll: boolean
}) {
  const [left, setLeft] = useState<Set<LinkSiteId>>(new Set())
  const parsed = LINK_SITES.map((site) => ({ site, raw: links[site.id] ?? '', ...parseLink(site, links[site.id] ?? '') }))
  // Each link says what's wrong with it, which is what the field's error is about, since admins can leave out the links.
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Liens</legend>
      <p className="admin-hint">Un lien ou un nom de profil, qui est tout ce qui en est gardé.</p>
      {parsed.map(({ site, raw, value, error }) => {
        const shownError = error && (showAll || left.has(site.id)) ? error : null
        return (
          <div className="admin-field" key={site.id}>
            <label>
              {site.name}
              <input
                value={raw}
                spellCheck={false}
                aria-invalid={shownError ? true : undefined}
                placeholder={site.prefix ?? (site.subdomainOf ? `….${site.subdomainOf}` : 'https://…')}
                onChange={(event) => onChange({ ...links, [site.id]: event.target.value })}
                onBlur={() => {
                  setLeft((left) => new Set(left).add(site.id))
                  if (value && value !== raw) onChange({ ...links, [site.id]: value })
                }}
              />
            </label>
            <FieldError message={shownError} />
            {value && (
              <a className="admin-link-check" href={site.url(value)} target="_blank" rel="noreferrer">
                vérifier ↗
              </a>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
