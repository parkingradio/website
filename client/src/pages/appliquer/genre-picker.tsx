import { GENRES } from 'shared/artists'
import type { GenreId } from 'shared/artists'
import { GENRE_GROUPS, MAX_GENRES } from './choices'

type Props = { value: GenreId[]; onChange: (genres: GenreId[]) => void; invalid: boolean }

const genreName = (id: GenreId) => GENRES.find((genre) => genre.id === id)?.name ?? id

// Up to MAX_GENRES genres, in the order they're picked: the first one is the artist's main genre.
export function GenrePicker({ value, onChange, invalid }: Props) {
  const full = value.length >= MAX_GENRES
  const toggle = (genre: GenreId) =>
    onChange(value.includes(genre) ? value.filter((picked) => picked !== genre) : full ? value : [...value, genre])

  return (
    <>
      {/* Focusable, so that the form can bring the artist here when no genre is picked. */}
      <div className={invalid ? 'genres-picked invalid' : 'genres-picked'} aria-invalid={invalid || undefined} tabIndex={-1}>
        {value.length === 0 && <span className="placeholder">clique sur un genre ci-dessous · le premier choisi sera ton genre principal</span>}
        {value.map((genre, index) => (
          <button key={genre} type="button" onClick={() => toggle(genre)} aria-label={`Enlever ${genreName(genre)}`}>
            <b>{index + 1}</b>
            {genreName(genre)}
            <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M1 1l8 8M9 1 1 9" />
            </svg>
          </button>
        ))}
      </div>
      <div className="genre-groups">
        {GENRE_GROUPS.map((group) => (
          <div key={group.name} className="genre-group">
            <h3>{group.name}</h3>
            <div>
              {group.genres.map((genre) => {
                const rank = value.indexOf(genre)
                return (
                  <button
                    key={genre}
                    type="button"
                    className="genre"
                    aria-pressed={rank >= 0}
                    data-rank={rank >= 0 ? rank + 1 : undefined}
                    disabled={full && rank < 0}
                    onClick={() => toggle(genre)}
                  >
                    {genreName(genre)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
