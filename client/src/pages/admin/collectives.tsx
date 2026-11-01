import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, formData } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { CollectiveForm } from './collective-form'
import { BackToArtists, LinksList, LoadFailure, PhotoOrNone } from './profile-details'
import { MISSING, addedBy, byWhom, entryPath, genreNames, membersGenres, photoUrl, place } from './describe'

// The pages of the artists section about collectives: a collective's page, where it's changed or deleted, and adding one
// by hand. They're listed with the artists (see artists.tsx).

// A collective's page. It starts afresh for each collective, rather than showing the last one while the next one loads.
export function CollectivePage() {
  const { id } = useParams() as { id: string }
  return <CollectiveById key={id} id={id} />
}

function CollectiveById({ id }: { id: string }) {
  const loaded = useApi('/api/admin/collectives/{id}', { params: { path: { id } } })
  // Loaded again once the collective is saved with new artists, which the server creates.
  const [artistsVersion, setArtistsVersion] = useState(0)
  const artists = useApi('/api/admin/artists', { version: artistsVersion })
  // The collective as the last change left it, which replaces the one loaded.
  const [changed, setChanged] = useState<Collective | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  if (loaded.kind === 'error') return <LoadFailure>Le collectif n'a pas pu être chargé&nbsp;: {loaded.message}</LoadFailure>
  if (loaded.kind === 'loading' || artists.kind === 'loading') return <BackToArtists />
  const collective = changed ?? loaded.value.collective
  // Without the artists, the collective is still shown, but its genres are unknown, and its artists can't be picked.
  const known = artists.kind === 'loaded' ? artists.value.artists : null
  const artistsFailure = artists.kind === 'error' && <ArtistsFailure message={artists.message} />

  if (editing) {
    return (
      <>
        <BackToArtists />
        <h1>{collective.name}</h1>
        {artistsFailure}
        <CollectiveForm
          collective={collective}
          artists={known}
          submitLabel="enregistrer"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const result = await api.PUT('/api/admin/collectives/{id}', { params: { path: { id } }, body, bodySerializer: formData })
            if (!result.ok) return `Le collectif n'a pas pu être enregistré : ${result.error}`
            setChanged(result.collective)
            setEditing(false)
            if (body.collective.members.some((member) => !('id' in member))) setArtistsVersion((version) => version + 1)
            return null
          }}
        />
      </>
    )
  }

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement ${collective.name}${collective.hasPhoto ? ' et sa photo' : ''} ? Ses artistes restent.`)) return
    setBusy(true)
    setError(null)
    const result = await api.DELETE('/api/admin/collectives/{id}', { params: { path: { id } } })
    if (result.ok) {
      navigate('/admin/artistes')
    } else {
      setBusy(false)
      setError(`Le collectif n'a pas pu être supprimé : ${result.error}`)
    }
  }

  return (
    <>
      <BackToArtists />
      <h1>{collective.name}</h1>
      <p className="admin-meta">{addedBy('collectif', collective)}</p>
      {collective.updatedBy && <p className="admin-meta">{byWhom('Modifié', collective.updatedBy, collective.updatedAt)}</p>}
      {artistsFailure}

      <div className="admin-toolbar">
        <button type="button" onClick={() => setEditing(true)}>
          modifier
        </button>
      </div>
      <CollectiveDetails collective={collective} artists={known} />

      <h2>Supprimer</h2>
      <p>
        {collective.hasPhoto ? 'Le collectif et sa photo seront supprimés' : 'Le collectif sera supprimé'} pour de bon. Ses artistes
        restent.
      </p>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={remove} disabled={busy}>
        supprimer le collectif
      </button>
    </>
  )
}

function ArtistsFailure({ message }: { message: string }) {
  return (
    <p className="admin-error" role="alert">
      Les artistes n'ont pas pu être chargés&nbsp;: {message}
    </p>
  )
}

// Everything about a collective: its photo, or that it has none, then its profile, with its artists, linking to them, and
// their genres, unless the `artists` couldn't be loaded, which leaves them blank.
function CollectiveDetails({ collective, artists }: { collective: Collective; artists: Artist[] | null }) {
  return (
    <div className="admin-record">
      <PhotoOrNone url={collective.hasPhoto ? photoUrl('collectives', collective) : null} name={collective.name} />
      <dl>
        <dt>Artistes du collectif</dt>
        <dd>
          {collective.members.length > 0 ? (
            <ol>
              {collective.members.map((member) => (
                <li key={member.id}>
                  <Link to={entryPath('artist', member.id)}>{member.name}</Link>
                </li>
              ))}
            </ol>
          ) : (
            'Aucun artiste.'
          )}
        </dd>
        <dt>Ville</dt>
        <dd>{place(collective)}</dd>
        <dt>Genres de ses artistes</dt>
        <dd>{artists && genreNames(membersGenres(collective.members, new Map(artists.map((artist) => [artist.id, artist]))))}</dd>
        <dt>Liens</dt>
        <dd>
          <LinksList links={collective.links} />
        </dd>
        <dt>Adresse e-mail du contact</dt>
        <dd>
          <a href={`mailto:${collective.email}`}>{collective.email}</a>
        </dd>
        <dt>Téléphone du contact</dt>
        <dd>{collective.phone ? <a href={`tel:${collective.phone}`}>{collective.phone}</a> : MISSING}</dd>
        <dt>Description</dt>
        <dd className="admin-text">{collective.description || MISSING}</dd>
      </dl>
    </div>
  )
}

export function NewCollectivePage() {
  const artists = useApi('/api/admin/artists')
  const navigate = useNavigate()
  return (
    <>
      <BackToArtists />
      <h1>Nouveau collectif</h1>
      {artists.kind === 'error' && <ArtistsFailure message={artists.message} />}
      {artists.kind !== 'loading' && (
        <CollectiveForm
          artists={artists.kind === 'loaded' ? artists.value.artists : null}
          submitLabel="ajouter le collectif"
          onSubmit={async (body) => {
            const result = await api.POST('/api/admin/collectives', { body, bodySerializer: formData })
            if (!result.ok) return `Le collectif n'a pas pu être ajouté : ${result.error}`
            navigate(entryPath('collective', result.collective.id))
            return null
          }}
        />
      )}
    </>
  )
}
