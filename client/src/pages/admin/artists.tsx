import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, formData } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { ArtistForm } from './artist-form'
import { OwnApplications } from './applications'
import { OwnSets } from './sessions'
import {
  KIND_LABELS,
  MISSING,
  addedBy,
  artistEntry,
  byWhom,
  collectiveEntry,
  deletedWith,
  comparePlaces,
  entryPath,
  genreNames,
  photoUrl,
  place,
} from './describe'
import type { Entry } from './describe'
import { compareText, search, useSearchQuery, useSort } from './list'
import type { SortColumn } from './list'
import { SearchField, SortHeader } from './list-controls'
import { ArtistsFailure, BackToArtists, CollectivesFailure, LinksList, LoadFailure, PhotoOrNone } from './profile-details'

// The artists section: every artist and collective, each artist's page, where they're changed or deleted, and adding one
// by hand, e.g. to bring in an artist who applied through the original Google Form. Collectives' pages are in
// collectives.tsx.

// The columns the list can be sorted by, where artists come before collectives.
const ENTRY_COLUMNS: Record<'name' | 'type' | 'city', SortColumn<Entry>> = {
  name: { compare: (a, b) => compareText(a.name, b.name) },
  type: { compare: (a, b) => Number(a.kind !== 'artist') - Number(b.kind !== 'artist') },
  city: { compare: comparePlaces },
}

// Every artist and collective, by name.
function entries(artists: Artist[], collectives: Collective[]): Entry[] {
  const byId = new Map(artists.map((artist) => [artist.id, artist]))
  return [...artists.map(artistEntry), ...collectives.map((collective) => collectiveEntry(collective, byId))].sort((a, b) => compareText(a.name, b.name))
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
  const sorting = useSort(ENTRY_COLUMNS, 'name')

  if (artists.kind === 'error' || collectives.kind === 'error') {
    return (
      <>
        {artists.kind === 'error' && <ArtistsFailure message={artists.message} />}
        {collectives.kind === 'error' && <CollectivesFailure message={collectives.message} />}
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
          <SortHeader column="name" sorting={sorting}>
            Nom
          </SortHeader>
          <SortHeader column="type" sorting={sorting}>
            Type
          </SortHeader>
          <SortHeader column="city" sorting={sorting}>
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
            <td>{KIND_LABELS[entry.kind]}</td>
            <td>{place(entry)}</td>
            <td>{entry.genres && genreNames(entry.genres)}</td>
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
  const sessions = useApi('/api/admin/sessions', { params: { query: { artist: id } } })
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
  // What deleting the artist takes them out of, once it's known that they have some.
  const takenOutOf = [
    ...(artist.collectives.length > 0 ? ['ses collectifs'] : []),
    // The sessions where they played a set.
    ...(sessions.kind === 'loaded' && sessions.value.sessions.length > 0 ? ['ses sets'] : []),
  ]
  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement ${deletedWith(artist.name, artist.hasPhoto, count)} ?`)) return
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
      <p className="admin-meta">{addedBy(KIND_LABELS.artist, artist)}</p>
      {artist.updatedBy && <p className="admin-meta">{byWhom('Modifié', artist.updatedBy, artist.updatedAt)}</p>}

      <div className="admin-toolbar">
        <button type="button" onClick={() => setEditing(true)}>
          modifier
        </button>
      </div>
      <ArtistDetails artist={artist} />

      <OwnApplications applications={applications} newPath={`/admin/candidatures/nouvelle?artist=${artist.id}`} />

      <OwnSets sessions={sessions} artistId={artist.id} />

      <h2>Supprimer</h2>
      <p>
        L'artiste{theirPhoto} et ses candidatures seront supprimés pour de bon.
        {takenOutOf.length > 0 && ` L'artiste sera aussi retiré de ${takenOutOf.join(' et de ')}, qui restent.`}
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
