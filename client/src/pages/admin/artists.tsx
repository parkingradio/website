import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { LINK_SITES } from 'shared/artists'
import type { Artist, ArtistResponse, ArtistsResponse, DeleteArtistResponse } from 'shared/artists'
import type { ApplicationsResponse } from 'shared/applications'
import { deleteJson, sendForm } from '../../api'
import { ArtistForm } from './artist-form'
import { ApplicationsTable } from './applications'
import { KIND_LABELS, byWhom, dateFormat, genreName, photoUrl, place } from './describe'
import { useApi } from './use-api'

// The artists section: every artist, each one's page, where they're changed or deleted, and adding one by hand, e.g. to
// bring in an application that came through the Google Form.

function BackToArtists() {
  return (
    <Link to="/admin/artistes" className="admin-back">
      ← tous les artistes
    </Link>
  )
}

// Every artist, by name.
export function ArtistsPage() {
  const artists = useApi<ArtistsResponse>('/api/admin/artists')
  const applications = useApi<ApplicationsResponse>('/api/admin/applications')

  const header = (
    <>
      <h1>Artistes</h1>
      <div className="admin-toolbar">
        <Link to="/admin/artistes/nouveau" className="admin-button">
          ajouter un artiste
        </Link>
      </div>
    </>
  )
  if (artists.kind === 'loading') return header
  if (artists.kind === 'error') {
    return (
      <>
        {header}
        <p className="admin-error" role="alert">
          Les artistes n'ont pas pu être chargés&nbsp;: {artists.message}
        </p>
      </>
    )
  }

  // How many applications each artist has, once they're loaded. The list goes without them otherwise, and says so.
  const counts = new Map<string, number>()
  if (applications.kind === 'loaded') {
    for (const { artistId } of applications.value.applications) counts.set(artistId, (counts.get(artistId) ?? 0) + 1)
  }

  const listed = artists.value.artists
  return (
    <>
      {header}
      {applications.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les candidatures n'ont pas pu être chargées&nbsp;: {applications.message}
        </p>
      )}
      {listed.length === 0 ? (
        <p className="admin-placeholder">Aucun artiste.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Type</th>
              <th>Ville</th>
              <th>Genres</th>
              {applications.kind === 'loaded' && <th>Candidatures</th>}
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
                <td>{artist.genres.map(genreName).join(', ')}</td>
                {applications.kind === 'loaded' && <td>{counts.get(artist.id) ?? 0}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

// An artist's page. It starts afresh for each artist, rather than showing the last one while the next one loads.
export function ArtistPage() {
  const { id } = useParams() as { id: string }
  return <ArtistById key={id} id={id} />
}

function ArtistById({ id }: { id: string }) {
  const url = `/api/admin/artists/${encodeURIComponent(id)}`
  const loaded = useApi<ArtistResponse>(url)
  const applications = useApi<ApplicationsResponse>(`/api/admin/applications?artist=${encodeURIComponent(id)}`)
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
          onSubmit={async (form) => {
            const result = await sendForm<ArtistResponse>('PUT', url, form)
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
    const result = await deleteJson<DeleteArtistResponse>(url)
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
        <dd>{artist.genres.map(genreName).join(', ')}</dd>
        <dt>Liens</dt>
        <dd>
          <ul>
            {LINK_SITES.filter((site) => artist.links[site.id]).map((site) => (
              <li key={site.id}>
                {site.name}&nbsp;:{' '}
                <a href={site.url(artist.links[site.id]!)} target="_blank" rel="noreferrer">
                  {artist.links[site.id]}
                </a>
              </li>
            ))}
          </ul>
        </dd>
        <dt>Adresse e-mail</dt>
        <dd>
          <a href={`mailto:${artist.email}`}>{artist.email}</a>
        </dd>
        <dt>Téléphone</dt>
        <dd>
          <a href={`tel:${artist.phone}`}>{artist.phone}</a>
        </dd>
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
        onSubmit={async (form) => {
          const result = await sendForm<ArtistResponse>('POST', '/api/admin/artists', form)
          if (!result.ok) return `L'artiste n'a pas pu être ajouté : ${result.error}`
          navigate(`/admin/artistes/${result.artist.id}`)
          return null
        }}
      />
    </>
  )
}
