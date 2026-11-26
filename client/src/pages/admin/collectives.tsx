import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, formData } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Collective } from '../../collective-profile'
import { OwnApplications } from './applications'
import { Button } from './button'
import { CollectiveForm } from './collective-form'
import { failure, newSessionPath } from './session-errors'
import { OwnSessions } from './sessions'
import { useAnnouncing } from './use-announcing'
import type { CollectiveFormProps } from './collective-form'
import { ArtistsFailure, BackToArtists, CollectiveDetails, LoadFailure } from './profile-details'
import { addedBy, byWhom, deletedWith, entryPath } from './describe'

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
  // Every artist, to pick its artists in its form, loaded again when the form stays open once the collective is saved,
  // which can have created some, so that the form tells their names apart from new ones.
  const [artistsVersion, setArtistsVersion] = useState(0)
  const members = useApi('/api/admin/artists', { params: { query: { collective: id } }, version: membersVersion })
  const applications = useApi('/api/admin/applications', { params: { query: { collective: id } } })
  const sessions = useApi('/api/admin/sessions', { params: { query: { takeover: id } } })
  // Its sessions as announcing them, or un-announcing them, left them, kept while its form is open.
  const announcing = useAnnouncing()
  // The collective as the last change left it, which replaces the one loaded.
  const [changed, setChanged] = useState<Collective | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReactNode>(null)
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
          artistsVersion={artistsVersion}
          collective={collective}
          submitLabel="enregistrer"
          onCancel={() => setEditing(false)}
          onSubmit={async (body, photo) => {
            const params = { path: { id } }
            // The profile first, so that a photo is only saved with a profile that's accepted.
            const result = await api.PATCH('/api/admin/collectives/{id}', { params, body })
            if (!result.ok) return `Le collectif n'a pas pu être enregistré : ${result.error}`
            setChanged(result.collective)
            setMembersVersion((version) => version + 1)
            if (photo) {
              const saved =
                photo === 'remove'
                  ? await api.DELETE('/api/admin/collectives/{id}/photo', { params })
                  : await api.PUT('/api/admin/collectives/{id}/photo', { params, body: { photo }, bodySerializer: formData })
              // The form stays open, with the artists it added by name by their id (see CollectiveForm), and sending it
              // again sends both again.
              if (!saved.ok) {
                setArtistsVersion((version) => version + 1)
                return `Le profil a été enregistré, mais pas la photo : ${saved.error}`
              }
              setChanged(saved.collective)
            }
            setEditing(false)
            return null
          }}
        />
      </>
    )
  }

  const count = applications.kind === 'loaded' ? applications.value.applications.length : null
  // A collective that has takeovers can't be deleted, which the server checks too, e.g. when they couldn't be loaded.
  const hasTakeovers = sessions.kind === 'loaded' && sessions.value.sessions.length > 0
  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement ${deletedWith(collective.name, collective.hasPhoto, count)} ? Ses artistes restent.`)) return
    setBusy(true)
    setError(null)
    const result = await api.DELETE('/api/admin/collectives/{id}', { params: { path: { id } } })
    if (result.ok) {
      navigate('/admin/artistes')
    } else {
      setBusy(false)
      // Naming the takeover in the way, if that's why.
      setError(failure("Le collectif n'a pas pu être supprimé", result))
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

      <OwnSessions sessions={sessions} announcing={announcing} newPath={newSessionPath({ takeover: collective.id })} />

      <h2>Supprimer</h2>
      <p>
        Le collectif{collective.hasPhoto && ', sa photo'} et ses candidatures seront supprimés pour de bon. Ses artistes restent, avec
        leurs propres candidatures.
      </p>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <Button unavailable={hasTakeovers ? 'Un collectif avec des takeovers ne peut pas être supprimé.' : null} onClick={remove} disabled={busy}>
        supprimer le collectif
      </Button>
    </>
  )
}

// The collective form, to change a collective or add one, with every artist to pick its artists from, loaded each time
// it opens, so that they're current, and nothing until then, and again whenever `artistsVersion` changes. When they
// can't be loaded, it says so, and the form only adds new artists.
function CollectiveFormWithArtists({ artistsVersion, ...props }: Omit<CollectiveFormProps, 'artists'> & { artistsVersion?: number }) {
  const artists = useApi('/api/admin/artists', { version: artistsVersion })
  if (artists.kind === 'loading') return null
  return (
    <>
      {artists.kind === 'error' && <ArtistsFailure message={artists.message} />}
      <CollectiveForm {...props} artists={artists.kind === 'loaded' ? artists.value.artists : null} />
    </>
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
        onSubmit={async (collective, photo) => {
          const body = { collective, photo: photo instanceof File ? photo : undefined }
          const result = await api.POST('/api/admin/collectives', { body, bodySerializer: formData })
          if (!result.ok) return `Le collectif n'a pas pu être ajouté : ${result.error}`
          navigate(entryPath('collective', result.collective.id))
          return null
        }}
      />
    </>
  )
}
