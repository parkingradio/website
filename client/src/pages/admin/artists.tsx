import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, formData } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Artist, GenreId } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { ArtistForm } from './artist-form'
import { ApplicationsTable } from './applications'
import {
  ENTRY_KIND_LABELS,
  KIND_LABELS,
  MISSING,
  addedBy,
  artistEntryKind,
  artistSearchFields,
  byWhom,
  collectiveSearchFields,
  comparePlaces,
  entryPath,
  genreNames,
  membersGenres,
  photoUrl,
  place,
} from './describe'
import type { EntryKind } from './describe'
import { compareText, search, useSearchQuery, useSort } from './list'
import type { SortColumn } from './list'
import { SearchField, SortHeader } from './list-controls'
import { BackToArtists, LinksList, LoadFailure, PhotoOrNone } from './profile-details'

// The artists section: every artist and collective, each artist's page, where they're changed or deleted, and adding one
// by hand, e.g. to bring in an artist who applied through the original Google Form. Collectives' pages are in
// collectives.tsx.

// An artist or a collective, as the list shows, searches and sorts them.
type Entry = { kind: EntryKind; id: string; name: string; city: string; country: string; genres: GenreId[]; searchFields: string[] }

// The columns the list can be sorted by, where artists come before collectives.
const ENTRY_COLUMNS: Record<'nom' | 'type' | 'ville', SortColumn<Entry>> = {
  nom: { compare: (a, b) => compareText(a.name, b.name) },
  type: { compare: (a, b) => Number(a.kind !== 'artist') - Number(b.kind !== 'artist') },
  ville: { compare: comparePlaces },
}

// Every artist and collective, by name.
function entries(artists: Artist[], collectives: Collective[]): Entry[] {
  const byId = new Map(artists.map((artist) => [artist.id, artist]))
  return [
    ...artists.map((artist): Entry => ({ ...artist, kind: artistEntryKind(artist), searchFields: artistSearchFields(artist) })),
    ...collectives.map((collective): Entry => {
      const genres = membersGenres(collective.members, byId)
      return { ...collective, kind: 'collective', genres, searchFields: collectiveSearchFields(collective, genres) }
    }),
  ].sort((a, b) => compareText(a.name, b.name))
}

// Every artist and collective.
export function ArtistsPage() {
  const { query, setQuery } = useSearchQuery()
  return (
    <>
      <h1>Artistes</h1>
      <div className="admin-toolbar">
        <Link to="/admin/artistes/nouveau" className="admin-button">
          ajouter un artiste
        </Link>
        <Link to="/admin/artistes/collectifs/nouveau" className="admin-button">
          ajouter un collectif
        </Link>
        <SearchField query={query} onChange={setQuery} />
      </div>
      <ArtistsList query={query} />
    </>
  )
}

// Every artist and collective, by name unless they're sorted otherwise, or those `query` finds.
function ArtistsList({ query }: { query: string }) {
  const artists = useApi('/api/admin/artists')
  const collectives = useApi('/api/admin/collectives')
  const sorting = useSort(ENTRY_COLUMNS, 'nom')

  if (artists.kind === 'error' || collectives.kind === 'error') {
    return (
      <>
        {artists.kind === 'error' && (
          <p className="admin-error" role="alert">
            Les artistes n'ont pas pu être chargés&nbsp;: {artists.message}
          </p>
        )}
        {collectives.kind === 'error' && (
          <p className="admin-error" role="alert">
            Les collectifs n'ont pas pu être chargés&nbsp;: {collectives.message}
          </p>
        )}
      </>
    )
  }
  if (artists.kind === 'loading' || collectives.kind === 'loading') return null

  const all = entries(artists.value.artists, collectives.value.collectives)
  const listed = sorting.sorted(search(all, query, (entry) => entry.searchFields))
  if (listed.length === 0) {
    return (
      <p className="admin-placeholder">
        {all.length === 0 ? 'Aucun artiste ni collectif.' : 'Aucun artiste ni collectif ne correspond à la recherche.'}
      </p>
    )
  }
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <SortHeader column="nom" sorting={sorting}>
            Nom
          </SortHeader>
          <SortHeader column="type" sorting={sorting}>
            Type
          </SortHeader>
          <SortHeader column="ville" sorting={sorting}>
            Ville
          </SortHeader>
          <th>Genres</th>
        </tr>
      </thead>
      <tbody>
        {listed.map((entry) => (
          <tr key={`${entry.kind}:${entry.id}`}>
            <td>
              <Link to={entryPath(entry.kind, entry.id)}>{entry.name}</Link>
            </td>
            <td>{ENTRY_KIND_LABELS[entry.kind]}</td>
            <td>{place(entry)}</td>
            <td>{genreNames(entry.genres)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// An artist's page. It starts afresh for each artist, rather than showing the last one while the next one loads.
export function ArtistPage() {
  const { id } = useParams() as { id: string }
  return <ArtistById key={id} id={id} />
}

function ArtistById({ id }: { id: string }) {
  const loaded = useApi('/api/admin/artists/{id}', { params: { path: { id } } })
  const applications = useApi('/api/admin/applications', { params: { query: { artist: id } } })
  // The artist as the last change left them, which replaces the one loaded.
  const [changed, setChanged] = useState<Artist | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  if (loaded.kind === 'loading') return <BackToArtists />
  if (loaded.kind === 'error') return <LoadFailure>L'artiste n'a pas pu être chargé&nbsp;: {loaded.message}</LoadFailure>
  const artist = changed ?? loaded.value.artist

  if (editing) {
    return (
      <>
        <BackToArtists />
        <h1>{artist.name}</h1>
        <ArtistForm
          artist={artist}
          submitLabel="enregistrer"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const result = await api.PUT('/api/admin/artists/{id}', { params: { path: { id } }, body, bodySerializer: formData })
            if (!result.ok) return `L'artiste n'a pas pu être enregistré : ${result.error}`
            setChanged(result.artist)
            setEditing(false)
            return null
          }}
        />
      </>
    )
  }

  const count = applications.kind === 'loaded' ? applications.value.applications.length : null
  const theirPhoto = artist.hasPhoto ? ', sa photo' : ''
  const remove = async () => {
    // Their applications are mentioned unless it's known that there are none.
    const theirApplications = count === 0 ? '' : ` et ses candidatures${count ? ` (${count})` : ''}`
    if (!window.confirm(`Supprimer définitivement ${artist.name}${theirPhoto}${theirApplications} ?`)) return
    setBusy(true)
    setError(null)
    const result = await api.DELETE('/api/admin/artists/{id}', { params: { path: { id } } })
    if (result.ok) {
      navigate('/admin/artistes')
    } else {
      setBusy(false)
      setError(`L'artiste n'a pas pu être supprimé : ${result.error}`)
    }
  }

  return (
    <>
      <BackToArtists />
      <h1>{artist.name}</h1>
      <p className="admin-meta">{addedBy(KIND_LABELS[artist.kind], artist)}</p>
      {artist.updatedBy && <p className="admin-meta">{byWhom('Modifié', artist.updatedBy, artist.updatedAt)}</p>}

      <div className="admin-toolbar">
        <button type="button" onClick={() => setEditing(true)}>
          modifier
        </button>
      </div>
      <ArtistDetails artist={artist} />

      <h2>Candidatures</h2>
      <div className="admin-toolbar">
        <Link to={`/admin/candidatures/nouvelle?artiste=${artist.id}`} className="admin-button">
          nouvelle candidature
        </Link>
      </div>
      {applications.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les candidatures n'ont pas pu être chargées&nbsp;: {applications.message}
        </p>
      )}
      {applications.kind === 'loaded' &&
        (applications.value.applications.length === 0 ? (
          <p className="admin-placeholder">Aucune candidature.</p>
        ) : (
          <ApplicationsTable applications={applications.value.applications} />
        ))}

      <h2>Supprimer</h2>
      <p>
        L'artiste{theirPhoto} et ses candidatures seront supprimés pour de bon.
        {artist.collectives.length > 0 && " L'artiste sera aussi retiré de ses collectifs, qui restent."}
      </p>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={remove} disabled={busy}>
        supprimer l'artiste
      </button>
    </>
  )
}

// Everything about an artist: their photo, or that they have none, then their profile.
function ArtistDetails({ artist }: { artist: Artist }) {
  return (
    <div className="admin-record">
      <PhotoOrNone url={artist.hasPhoto ? photoUrl('artists', artist) : null} name={artist.name} />
      <dl>
        {artist.kind === 'collective' && (
          <>
            <dt>Artistes du collectif</dt>
            <dd>{artist.members.join(', ')}</dd>
          </>
        )}
        {artist.collectives.length > 0 && (
          <>
            <dt>Collectifs</dt>
            <dd>
              <ul>
                {artist.collectives.map((collective) => (
                  <li key={collective.id}>
                    <Link to={entryPath('collective', collective.id)}>{collective.name}</Link>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>Ville</dt>
        <dd>{place(artist)}</dd>
        <dt>Genres</dt>
        <dd>{genreNames(artist.genres)}</dd>
        <dt>Liens</dt>
        <dd>
          <LinksList links={artist.links} />
        </dd>
        <dt>Adresse e-mail</dt>
        <dd>{artist.email ? <a href={`mailto:${artist.email}`}>{artist.email}</a> : MISSING}</dd>
        <dt>Téléphone</dt>
        <dd>{artist.phone ? <a href={`tel:${artist.phone}`}>{artist.phone}</a> : MISSING}</dd>
        <dt>Bio</dt>
        <dd className="admin-text">{artist.bio || MISSING}</dd>
      </dl>
    </div>
  )
}

export function NewArtistPage() {
  const navigate = useNavigate()
  return (
    <>
      <BackToArtists />
      <h1>Nouvel artiste</h1>
      <ArtistForm
        submitLabel="ajouter l'artiste"
        onSubmit={async (body) => {
          const result = await api.POST('/api/admin/artists', { body, bodySerializer: formData })
          if (!result.ok) return `L'artiste n'a pas pu être ajouté : ${result.error}`
          navigate(`/admin/artistes/${result.artist.id}`)
          return null
        }}
      />
    </>
  )
}
