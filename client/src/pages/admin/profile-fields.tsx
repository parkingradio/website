import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GENRES, LINK_SITES, PHOTO_MAX_BYTES, PHOTO_TYPES, parseLink } from '../../artist-profile'
import type { ArtistLinks, GenreId, LinkSiteId } from '../../artist-profile'
import { Combobox } from '../../combobox'
import { COUNTRY_OPTIONS, genreName } from './describe'
import { leaving } from './checked-form'
import { FieldError } from './fields'

// The fields that the forms for artists' and collectives' profiles share, and the genres, which sets' have too.

// The props of a field made of several inputs, which is left once the focus leaves all of them.
export type GroupProps<T> = {
  onChange: (value: T) => void
  error: string | undefined
  onLeave: () => void
}

// The country, typed, with the matching countries suggested, of which one has to be picked, "Pays inconnu" leaving it
// out.
export function CountryField({ country, onChange, error, onLeave }: GroupProps<string> & { country: string }) {
  const id = useId()
  return (
    <div className="admin-field">
      <label htmlFor={id}>Pays</label>
      <Combobox id={id} options={COUNTRY_OPTIONS} selected={country} onSelect={onChange} onBlur={onLeave} invalid={!!error} />
      <FieldError message={error} />
    </div>
  )
}

// The photo picked, or else the artist's or collective's, if there's one and it isn't removed, each with an × that takes
// it away, then the input that picks a photo, which replaces theirs. An × goes away once clicked, so the focus goes to the
// input rather than being lost.
export function PhotoField({
  current,
  removed,
  onRemove,
  photo,
  onChange,
  error,
}: {
  // The address of their photo, if there's one, and whether it's to be removed.
  current: string | null
  removed: boolean
  onRemove: () => void
  photo: File | null
  onChange: (photo: File | null) => void
  error: string | undefined
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  // The address of the photo picked, to show it, made when it's picked and released once it's replaced or the form is
  // gone. When the browser doesn't know the photo's type, it's shown anyway: the server tells it from its contents.
  const [preview, setPreview] = useState<string | null>(null)
  const shown = useRef<string | null>(null)
  useEffect(() => () => {
    if (shown.current) URL.revokeObjectURL(shown.current)
  }, [])

  // How many photos were picked, which keys the error, so that another wrong one, picked in its place, is announced again.
  const [picks, setPicks] = useState(0)

  const pick = (file: File | null) => {
    if (shown.current) URL.revokeObjectURL(shown.current)
    shown.current = file && (!file.type || PHOTO_TYPES.includes(file.type)) ? URL.createObjectURL(file) : null
    setPreview(shown.current)
    setPicks((count) => count + 1)
    onChange(file)
  }
  const kept = current && !removed ? current : null

  return (
    <div className="admin-field">
      <label htmlFor={id}>Photo</label>
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
        id={id}
        type="file"
        accept={PHOTO_TYPES.join(',')}
        aria-invalid={error ? true : undefined}
        onChange={(event) => pick(event.target.files?.[0] ?? null)}
      />
      <FieldError key={picks} message={error} alert />
      <p className="admin-hint">
        Facultative. JPEG, PNG ou WebP, jusqu'à {PHOTO_MAX_BYTES / 1024 / 1024} Mo.
        {kept && !photo && ' En choisir une autre remplace la photo actuelle.'}
        {current && removed && !photo && " La photo actuelle sera retirée à l'enregistrement."}
      </p>
    </div>
  )
}

// One input per site. Each one is checked once it's been left, when what was pasted in it is also reduced to what's
// kept of it, e.g. the profile name, with a link to check that it's the right one.
export function LinksField({
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

// Every genre, as a tag: clicking one pins it, or unpins it if it was. The genres pinned are listed first, in the order
// they were pinned, which is their order of importance. `children` come before them, e.g. genres to suggest.
export function GenresField({ genres, onChange, error, onLeave, children }: GroupProps<GenreId[]> & { genres: GenreId[]; children?: ReactNode }) {
  const toggle = (genre: GenreId) => onChange(genres.includes(genre) ? genres.filter((other) => other !== genre) : [...genres, genre])
  return (
    <fieldset className="admin-fields" onBlur={leaving(onLeave)}>
      <legend>Genres</legend>
      <p className="admin-hint">Le premier choisi est le genre principal.</p>
      {children}
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

