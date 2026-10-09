import { useState } from 'react'
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
} from 'shared/artists'
import type { ArtistProfile, GenreId, LinkSiteId } from 'shared/artists'
import { checkLine } from 'shared/checks'
import { pickedPhotoError } from '../../artist-profile'
import { Combobox } from '../../combobox'
import { COUNTRY_OPTIONS, KIND_LABELS, genreName } from './describe'
import { leaving, useCheckedForm } from './checked-form'
import { FieldError, FormActions, Labeled } from './fields'

// A form for an artist's profile and photo, to add an artist or change one. Each field is checked with the rules the
// server checks it with (see `checkProfile`), and says what's wrong once it's been left, or once the form is sent. The
// server's error is shown if it refuses the artist anyway, e.g. for an email address another artist has.

const EMPTY: ArtistProfile = {
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

type Field = keyof ArtistProfile | 'photo'

type ArtistFormProps = {
  // The profile to change, or nothing for a new artist, who must then have a photo.
  artist?: ArtistProfile
  submitLabel: string
  // Sends the form, as `POST` or `PUT /api/admin/artists[/:id]` expect it, and returns the error, if it failed.
  onSubmit: (form: FormData) => Promise<string | null>
  onCancel?: () => void
}

export function ArtistForm({ artist: initial, submitLabel, onSubmit, onCancel }: ArtistFormProps) {
  const isNew = initial === undefined
  const [profile, setProfile] = useState<ArtistProfile>(initial ?? EMPTY)
  const [photo, setPhoto] = useState<File | null>(null)
  // The name of a collective's artist being typed, before it's pinned.
  const [memberEntry, setMemberEntry] = useState('')

  const checked = checkProfile(profile)
  const errors: Partial<Record<Field, string>> = { ...checked.errors }
  // Only the names pinned are sent. One that's left typed would be lost, so it has to be pinned (or cleared) first.
  const unpinned = profile.kind === 'collective' ? memberEntry.trim() : ''
  if (unpinned) errors.members = `« ${unpinned} » n'est pas ajouté : appuyer sur + pour l'ajouter.`
  // A new artist needs a photo. Otherwise, the artist keeps theirs unless another one is chosen. When the browser doesn't
  // know the photo's type, which the server tells from its contents anyway, only its size is checked.
  const photoProblem = isNew || photo ? pickedPhotoError(photo) : null
  if (photoProblem) errors.photo = photoProblem
  const { form, submit, busy, error, submitted, shown, leave } = useCheckedForm(errors, () => {
    // What's saved of the profile, e.g. without the members of an artist who was a collective at first. There's one,
    // since there are no errors by then.
    const sent = new FormData()
    sent.append('artist', JSON.stringify(checked.profile!))
    if (photo) sent.append('photo', photo)
    return onSubmit(sent)
  })
  const update = (changes: Partial<ArtistProfile>) => setProfile((profile) => ({ ...profile, ...changes }))

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
          selected={profile.country || null}
          onSelect={(country) => update({ country })}
          onBlur={leave('country')}
          invalid={!!shown('country')}
          placeholder="nom du pays"
        />
        <FieldError message={shown('country')} />
      </div>

      <Labeled label="Ville" error={shown('city')}>
        <input {...input('city')} maxLength={CITY_MAX_LENGTH} required />
      </Labeled>

      <GenresField genres={profile.genres} onChange={(genres) => update({ genres })} error={shown('genres')} onLeave={leave('genres')} />

      <Labeled label="Bio" error={shown('bio')}>
        <textarea {...input('bio')} rows={8} maxLength={BIO_MAX_LENGTH} required />
      </Labeled>

      <LinksField
        links={profile.links}
        onChange={(links) => update({ links })}
        error={shown('links')}
        showAll={submitted}
        onLeave={leave('links')}
      />

      <Labeled label="Adresse e-mail" error={shown('email')}>
        <input type="email" {...input('email')} maxLength={EMAIL_MAX_LENGTH} required />
      </Labeled>

      <Labeled label="Téléphone" error={shown('phone')}>
        <input type="tel" {...input('phone')} maxLength={PHONE_MAX_LENGTH} required />
      </Labeled>

      <Labeled label="Photo" error={shown('photo')}>
        <input
          type="file"
          accept={PHOTO_TYPES.join(',')}
          required={isNew}
          aria-invalid={shown('photo') ? true : undefined}
          onChange={(event) => {
            setPhoto(event.target.files?.[0] ?? null)
            leave('photo')()
          }}
        />
      </Labeled>
      <p className="admin-hint">JPEG, PNG ou WebP.{!isNew && ' Laisser vide pour garder la photo actuelle.'}</p>

      <FormActions error={error} busy={busy} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
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
      <p className="admin-hint">Au moins un. Le premier choisi est le genre principal.</p>
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
          <button key={genre.id} type="button" aria-pressed={genres.includes(genre.id)} onClick={() => toggle(genre.id)}>
            {genre.name}
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
  error,
  showAll,
  onLeave,
}: GroupProps<Partial<Record<LinkSiteId, string>>> & {
  links: Partial<Record<LinkSiteId, string>>
  // Whether to show the errors of the inputs that haven't been left too, once the form is sent.
  showAll: boolean
}) {
  const [left, setLeft] = useState<Set<LinkSiteId>>(new Set())
  const parsed = LINK_SITES.map((site) => ({ site, raw: links[site.id] ?? '', ...parseLink(site, links[site.id] ?? '') }))
  // Each link says what's wrong with it. The field's error is then about one of them, and otherwise that there's no
  // link, which the first one is marked with, so that it's the one to fix.
  const noLink = parsed.some((link) => link.error) ? undefined : error
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Liens</legend>
      <p className="admin-hint">Au moins un. Un lien ou un nom de profil, qui est tout ce qui en est gardé.</p>
      {parsed.map(({ site, raw, value, error }, index) => {
        const shownError = error && (showAll || left.has(site.id)) ? error : null
        return (
          <div className="admin-field" key={site.id}>
            <label>
              {site.name}
              <input
                value={raw}
                spellCheck={false}
                aria-invalid={shownError || (noLink && index === 0) ? true : undefined}
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
      <FieldError message={noLink} />
    </fieldset>
  )
}
