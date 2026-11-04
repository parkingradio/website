import { CITY_MAX_LENGTH, NAME_MAX_LENGTH } from '../../artist-profile'
import type { GenreId } from '../../artist-profile'
import { Combobox } from '../../combobox'
import { APPLY_BIO_MAX_LENGTH, COUNTRY_OPTIONS, MAX_GENRES } from './choices'
import { GenrePicker } from './genre-picker'
import { useCitySuggestions } from './geonames'
import { LinksField } from './links-field'
import { PhotoField } from './photo-field'
import { fieldId } from './profile'
import type { Profile } from './profile'

// An artist's profile, which an artist applying alone and each of a collective's artists both fill in, with the same
// fields and rules: their identity (`IdentityFields`), then their presentation (`PresentationFields`).

type ProfileErrors = Partial<Record<keyof Profile, string>>

type IdentityProps = {
  idPrefix: string
  profile: Profile
  onChange: (changes: Partial<Profile>) => void
  errors: ProfileErrors
  // What the browser can fill the name with, e.g. "nickname" for the visitor's own, rather than nothing.
  nameAutoComplete?: string
}

// "Nom d'artiste", "Pays", "Ville" and "Genres musicaux".
export function IdentityFields({ idPrefix, profile, onChange, errors, nameAutoComplete = 'off' }: IdentityProps) {
  return (
    <>
      <div className="field wide">
        <label htmlFor={fieldId(idPrefix, 'nom')}>
          Nom d'artiste <span className="required">*</span>
        </label>
        <input
          id={fieldId(idPrefix, 'nom')}
          type="text"
          maxLength={NAME_MAX_LENGTH}
          autoComplete={nameAutoComplete}
          aria-invalid={errors.name ? true : undefined}
          value={profile.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <FieldError message={errors.name} />
      </div>
      <PlaceFields
        idPrefix={idPrefix}
        country={profile.country}
        city={profile.city}
        onChange={onChange}
        errors={errors}
        cityPlaceholder="nom de la ville"
      />
      <GenresField value={profile.genres} onChange={(genres) => onChange({ genres })} error={errors.genres} />
    </>
  )
}

type PresentationProps = {
  idPrefix: string
  profile: Profile
  onChange: (changes: Partial<Profile>) => void
  errors: ProfileErrors
  // Show every link's error, not only those of the fields that were left (set once the form was sent).
  showErrors: boolean
  // A collective's presentation, which has a description rather than a bio.
  collective?: boolean
}

// "Photo", "Bio" and "Liens".
export function PresentationFields({ idPrefix, profile, onChange, errors, showErrors, collective = false }: PresentationProps) {
  return (
    <>
      <div className="field wide">
        <label htmlFor={fieldId(idPrefix, 'photo')}>
          Photo de profil <span className="hint">— une photo de presse {collective ? 'du collectif' : "de l'artiste"}, en bonne qualité</span>
        </label>
        <PhotoField id={fieldId(idPrefix, 'photo')} value={profile.photo} onChange={(photo) => onChange({ photo })} invalid={!!errors.photo} />
        {/* Keyed on the photo, so that another wrong one, picked in its place, is announced again. */}
        <FieldError key={profile.photo && `${profile.photo.name}:${profile.photo.size}:${profile.photo.lastModified}`} message={errors.photo} alert />
      </div>
      <BioField
        id={fieldId(idPrefix, 'bio')}
        label={collective ? 'Description' : 'Bio'}
        placeholder={collective ? 'Quelques lignes sur le collectif.' : "Quelques lignes sur l'artiste ou le projet."}
        value={profile.bio}
        onChange={(bio) => onChange({ bio })}
        error={errors.bio}
      />
      <fieldset className={errors.links ? 'field wide invalid' : 'field wide'}>
        <legend>
          Liens <span className="required">*</span> <span className="hint">— au moins un</span>
        </legend>
        <LinksField
          idPrefix={idPrefix}
          values={profile.links}
          onChange={(links) => onChange({ links })}
          showErrors={showErrors}
          invalid={!!errors.links}
        />
        <FieldError message={errors.links} />
      </fieldset>
    </>
  )
}

// `alert` for an error that shows without the form being sent, e.g. a photo's as soon as it's picked, for screen readers
// to announce it.
export function FieldError({ message, alert = false }: { message: string | undefined; alert?: boolean }) {
  return message ? (
    <span className="error" role={alert ? 'alert' : undefined}>
      {message}
    </span>
  ) : null
}

type PlaceProps = {
  // What the fields' ids start with (see `fieldId`).
  idPrefix: string
  country: string | null
  city: string
  onChange: (place: { country: string | null; city: string }) => void
  errors: { country?: string; city?: string }
  // What the city's field says once a country is picked.
  cityPlaceholder: string
}

// "Pays" and "Ville": the city can only be typed once a country is picked, and suggests that country's cities.
export function PlaceFields({ idPrefix, country, city, onChange, errors, cityPlaceholder }: PlaceProps) {
  const citySuggestions = useCitySuggestions(country, city)
  const ids = { country: fieldId(idPrefix, 'pays'), city: fieldId(idPrefix, 'ville') }
  return (
    <>
      <div className="field">
        <label htmlFor={ids.country}>
          Pays <span className="required">*</span>
        </label>
        <Combobox
          id={ids.country}
          options={COUNTRY_OPTIONS}
          selected={country}
          placeholder="tapez pour chercher…"
          invalid={!!errors.country}
          // The cities suggested are those of the country, so another country starts the city over.
          onSelect={(picked) => picked !== country && onChange({ country: picked, city: '' })}
        />
        <FieldError message={errors.country} />
      </div>
      <div className="field">
        <label htmlFor={ids.city}>
          Ville <span className="required">*</span>
        </label>
        <Combobox
          id={ids.city}
          placeholder={country ? cityPlaceholder : "choisissez d'abord un pays"}
          disabled={!country}
          invalid={!!errors.city}
          maxLength={CITY_MAX_LENGTH}
          options={citySuggestions}
          text={{ value: city, onChange: (typed) => onChange({ country, city: typed }) }}
        />
        <FieldError message={errors.city} />
      </div>
    </>
  )
}

type GenresProps = {
  value: GenreId[]
  onChange: (genres: GenreId[]) => void
  error: string | undefined
}

// "Genres musicaux": 1 to MAX_GENRES, in order.
function GenresField({ value, onChange, error }: GenresProps) {
  return (
    <fieldset className={error ? 'field wide invalid' : 'field wide'}>
      <legend className="genres-legend">
        <span>
          Genres musicaux <span className="required">*</span>{' '}
          <span className="hint">— jusqu'à {MAX_GENRES}, dans l'ordre : le premier est le genre principal</span>
        </span>
        <span className={value.length >= MAX_GENRES ? 'count full' : 'count'} aria-live="polite">
          {value.length} / {MAX_GENRES}
        </span>
      </legend>
      <GenrePicker value={value} onChange={onChange} invalid={!!error} />
      <FieldError message={error} />
    </fieldset>
  )
}

type TextProps = {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
}

// A bio, or a collective's description, up to APPLY_BIO_MAX_LENGTH.
function BioField({ id, label, placeholder, value, onChange, error }: TextProps) {
  return (
    <div className="field wide">
      <label htmlFor={id}>
        {label} <span className="required">*</span>
      </label>
      <textarea
        id={id}
        maxLength={APPLY_BIO_MAX_LENGTH}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="count-chars">
        {value.length} / {APPLY_BIO_MAX_LENGTH}
      </span>
      <FieldError message={error} />
    </div>
  )
}
