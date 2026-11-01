import { CITY_MAX_LENGTH } from '../../artist-profile'
import type { GenreId } from '../../artist-profile'
import { Combobox } from '../../combobox'
import { APPLY_BIO_MAX_LENGTH, COUNTRY_OPTIONS, MAX_GENRES } from './choices'
import { GenrePicker } from './genre-picker'
import { useCitySuggestions } from './geonames'

// The fields of a profile that an artist alone and each of a collective's artists both have, with the same rules.

export function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="error">{message}</span> : null
}

type PlaceProps = {
  // The fields' ids.
  ids: { country: string; city: string }
  country: string | null
  city: string
  onChange: (place: { country: string | null; city: string }) => void
  errors: { country?: string; city?: string }
  // What the city's field says once a country is picked.
  cityPlaceholder: string
}

// "Pays" and "Ville": the city can only be typed once a country is picked, and suggests that country's cities.
export function PlaceFields({ ids, country, city, onChange, errors, cityPlaceholder }: PlaceProps) {
  const citySuggestions = useCitySuggestions(country, city)
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
  // Whose main genre the first one is, e.g. "votre", or "son" for one of a collective's artists.
  whose: string
}

// "Genres musicaux": 1 to MAX_GENRES, in order.
export function GenresField({ value, onChange, error, whose }: GenresProps) {
  return (
    <fieldset className={error ? 'field wide invalid' : 'field wide'}>
      <legend className="genres-legend">
        <span>
          Genres musicaux <span className="required">*</span>{' '}
          <span className="hint">
            — jusqu'à {MAX_GENRES}, dans l'ordre : le premier est {whose} genre principal
          </span>
        </span>
        <span className={value.length >= MAX_GENRES ? 'count full' : 'count'} aria-live="polite">
          {value.length} / {MAX_GENRES}
        </span>
      </legend>
      <GenrePicker value={value} onChange={onChange} invalid={!!error} whose={whose} />
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
export function BioField({ id, label, placeholder, value, onChange, error }: TextProps) {
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
