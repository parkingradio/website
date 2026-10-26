import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, formData } from '../../api/client'
import { useApi } from '../../api/use-api'
import { ARTIST_KINDS, LINK_SITES } from '../../artist-profile'
import type { Artist } from '../../artist-profile'
import { ArtistForm } from './artist-form'
import { ApplicationsTable } from './applications'
import { KIND_LABELS, MISSING, artistSearchFields, byWhom, countryOf, dateFormat, genreNames, photoUrl, place } from './describe'
import { compareText, search, useSearchQuery, useSort } from './list'
import type { SortColumn } from './list'
import { SearchField, SortHeader } from './list-controls'

// The artists section: every artist, each one's page, where they're changed or deleted, and adding one by hand, e.g. to
// bring in an application that came through the Google Form.

// The columns the list of artists can be sorted by: artists come before collectives, and places are sorted by city, then
// country. What's left out comes first.
const ARTIST_COLUMNS: Record<'nom' | 'type' | 'ville', SortColumn<Artist>> = {
  nom: { compare: (a, b) => compareText(a.name, b.name) },
  type: { compare: (a, b) => ARTIST_KINDS.indexOf(a.kind) - ARTIST_KINDS.indexOf(b.kind) },
  ville: { compare: (a, b) => compareText(a.city, b.city) || compareText(countryOf(a), countryOf(b)) },
}

function BackToArtists() {
  return (
    <Link to="/admin/artistes" className="admin-back">
      ← tous les artistes
    </Link>
  )
}

// Every artist.
export function ArtistsPage() {
  const { query, setQuery } = useSearchQuery()
  return (
    <>
      <h1>Artistes</h1>
      <div className="admin-toolbar">
        <Link to="/admin/artistes/nouveau" className="admin-button">
          ajouter un artiste
        </Link>
        <SearchField query={query} onChange={setQuery} />
      </div>
      <ArtistsList query={query} />
    </>
  )
}

// Every artist, by name unless they're sorted otherwise, or those `query` finds.
function ArtistsList({ query }: { query: string }) {
  const artists = useApi('/api/admin/artists')
  const sorting = useSort(ARTIST_COLUMNS, 'nom')

  if (artists.kind === 'loading') return null
  if (artists.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les artistes n'ont pas pu être chargés&nbsp;: {artists.message}
      </p>
    )
  }

  const all = artists.value.artists
  const listed = sorting.sorted(search(all, query, artistSearchFields))
  if (listed.length === 0) {
    return <p className="admin-placeholder">{all.length === 0 ? 'Aucun artiste.' : 'Aucun artiste ne correspond à la recherche.'}</p>
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
        {listed.map((artist) => (
          <tr key={artist.id}>
            <td>
              <Link to={`/admin/artistes/${artist.id}`}>{artist.name}</Link>
            </td>
            <td>{KIND_LABELS[artist.kind]}</td>
            <td>{place(artist)}</td>
            <td>{genreNames(artist.genres)}</td>
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
  if (loaded.kind === 'error') {
    return (
      <>
        <BackToArtists />
        <p className="admin-error" role="alert">
          L'artiste n'a pas pu être chargé&nbsp;: {loaded.message}
        </p>
      </>
    )
  }
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
      <p className="admin-meta">
        {KIND_LABELS[artist.kind]},{' '}
        {byWhom('ajouté', artist.createdBy, artist.createdAt) ??
          `inscrit par le formulaire «\u00a0appliquer\u00a0» le ${dateFormat.format(new Date(artist.createdAt))}.`}
      </p>
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
      <p>L'artiste{theirPhoto} et ses candidatures seront supprimés pour de bon.</p>
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
  // The sites the artist has a link to, in the order of LINK_SITES.
  const linkSites = LINK_SITES.filter((site) => artist.links[site.id])
  return (
    <div className="admin-record">
      {artist.hasPhoto ? (
        <img src={photoUrl(artist)} alt={`Photo de ${artist.name}`} />
      ) : (
        <div className="admin-no-photo">Pas de photo</div>
      )}
      <dl>
        {artist.kind === 'collective' && (
          <>
            <dt>Artistes du collectif</dt>
            <dd>{artist.members.join(', ')}</dd>
          </>
        )}
        <dt>Ville</dt>
        <dd>{place(artist)}</dd>
        <dt>Genres</dt>
        <dd>{genreNames(artist.genres)}</dd>
        <dt>Liens</dt>
        <dd>
          {linkSites.length > 0 ? (
            <ul>
              {linkSites.map((site) => (
                <li key={site.id}>
                  {site.name}&nbsp;:{' '}
                  <a href={site.url(artist.links[site.id]!)} target="_blank" rel="noreferrer">
                    {artist.links[site.id]}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            MISSING
          )}
        </dd>
        <dt>Adresse e-mail</dt>
        <dd>
          <a href={`mailto:${artist.email}`}>{artist.email}</a>
        </dd>
        <dt>Téléphone</dt>
        <dd>{artist.phone ? <a href={`tel:${artist.phone}`}>{artist.phone}</a> : MISSING}</dd>
        <dt>Bio</dt>
        <dd className="admin-text">{artist.bio}</dd>
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
