import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, formData } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { OwnApplications } from './applications'
import { CollectiveForm } from './collective-form'
import { OwnSessions } from './sessions'
import type { CollectiveFormProps } from './collective-form'
import { ArtistsFailure, BackToArtists, LinksList, LoadFailure, MembersList, PhotoOrNone } from './profile-details'
import { MISSING, addedBy, byWhom, collectiveGenreNames, deletedWith, entryPath, photoUrl, place } from './describe'

// The pages of the artists section about collectives: a collective's page, where it's changed or deleted, and adding one
// by hand. They're listed with the artists (see artists.tsx).

// A collective's page. It starts afresh for each collective, rather than showing the last one while the next one loads.
export function CollectivePage() {
  const { id } = useParams() as { id: string }
  return <CollectiveById key={id} id={id} />
}

function CollectiveById({ id }: { id: string }) {
  const loaded = useApi('/api/admin/collectives/{id}', { params: { path: { id } } })
  // Its artists, for its genres, loaded again whenever the collective is saved, which can change them.
  const [membersVersion, setMembersVersion] = useState(0)
  const members = useApi('/api/admin/artists', { params: { query: { collective: id } }, version: membersVersion })
  const applications = useApi('/api/admin/applications', { params: { query: { collective: id } } })
  const sessions = useApi('/api/admin/sessions', { params: { query: { takeover: id } } })
  // The collective as the last change left it, which replaces the one loaded.
  const [changed, setChanged] = useState<Collective | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  if (loaded.kind === 'error') return <LoadFailure>Le collectif n'a pas pu être chargé&nbsp;: {loaded.message}</LoadFailure>
  if (loaded.kind === 'loading' || members.kind === 'loading') return <BackToArtists />
  const collective = changed ?? loaded.value.collective

  if (editing) {
    return (
      <>
        <BackToArtists />
        <h1>{collective.name}</h1>
        <CollectiveFormWithArtists
          collective={collective}
          submitLabel="enregistrer"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const result = await api.PUT('/api/admin/collectives/{id}', { params: { path: { id } }, body, bodySerializer: formData })
            if (!result.ok) return `Le collectif n'a pas pu être enregistré : ${result.error}`
            setChanged(result.collective)
            setEditing(false)
            setMembersVersion((version) => version + 1)
            return null
          }}
        />
      </>
    )
  }

  const count = applications.kind === 'loaded' ? applications.value.applications.length : null
  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement ${deletedWith(collective.name, collective.hasPhoto, count)} ? Ses artistes restent.`)) return
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
      {members.kind === 'error' && <ArtistsFailure message={members.message} />}

      <div className="admin-toolbar">
        <button type="button" onClick={() => setEditing(true)}>
          modifier
        </button>
      </div>
      <CollectiveDetails collective={collective} members={members.kind === 'loaded' ? members.value.artists : null} />

      <OwnApplications applications={applications} newPath={`/admin/candidatures/nouvelle?collective=${collective.id}`} />

      <OwnSessions sessions={sessions} newPath={`/admin/sessions/nouvelle?takeover=${collective.id}`} />

      <h2>Supprimer</h2>
      <p>
        Le collectif{collective.hasPhoto && ', sa photo'} et ses candidatures seront supprimés pour de bon. Ses artistes restent, avec
        leurs propres candidatures.
        {sessions.kind === 'loaded' && sessions.value.sessions.length > 0 && ' Les sessions de ses takeovers restent, sans takeover.'}
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

// The collective form, to change a collective or add one, with every artist to pick its artists from, loaded each time
// it opens, so that they're current, and nothing until then. When they can't be loaded, it says so, and the form only
// adds new artists.
function CollectiveFormWithArtists(props: Omit<CollectiveFormProps, 'artists'>) {
  const artists = useApi('/api/admin/artists')
  if (artists.kind === 'loading') return null
  return (
    <>
      {artists.kind === 'error' && <ArtistsFailure message={artists.message} />}
      <CollectiveForm {...props} artists={artists.kind === 'loaded' ? artists.value.artists : null} />
    </>
  )
}

// Everything about a collective: its photo, or that it has none, then its profile, with its artists, linking to them, and
// their genres, from its `members`, unless they couldn't be loaded, which leaves them blank.
function CollectiveDetails({ collective, members }: { collective: Collective; members: Artist[] | null }) {
  return (
    <div className="admin-record">
      <PhotoOrNone url={collective.hasPhoto ? photoUrl('collectives', collective) : null} name={collective.name} />
      <dl>
        <dt>Artistes du collectif</dt>
        <dd>
          <MembersList members={collective.members} />
        </dd>
        <dt>Ville</dt>
        <dd>{place(collective)}</dd>
        <dt>Genres de ses artistes</dt>
        <dd>{collectiveGenreNames(collective, members)}</dd>
        <dt>Liens</dt>
        <dd>
          <LinksList links={collective.links} />
        </dd>
        <dt>Adresse e-mail du contact</dt>
        <dd>{collective.email ? <a href={`mailto:${collective.email}`}>{collective.email}</a> : MISSING}</dd>
        <dt>Téléphone du contact</dt>
        <dd>{collective.phone ? <a href={`tel:${collective.phone}`}>{collective.phone}</a> : MISSING}</dd>
        <dt>Description</dt>
        <dd className="admin-text">{collective.description || MISSING}</dd>
      </dl>
    </div>
  )
}

export function NewCollectivePage() {
  const navigate = useNavigate()
  return (
    <>
      <BackToArtists />
      <h1>Nouveau collectif</h1>
      <CollectiveFormWithArtists
        submitLabel="ajouter le collectif"
        onSubmit={async (body) => {
          const result = await api.POST('/api/admin/collectives', { body, bodySerializer: formData })
          if (!result.ok) return `Le collectif n'a pas pu être ajouté : ${result.error}`
          navigate(entryPath('collective', result.collective.id))
          return null
        }}
      />
    </>
  )
}
