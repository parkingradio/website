import { api } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { byWhom } from '../describe'
import { CredentialsForm } from './credentials-form'

// The credentials of the SoundCloud app the server reads SoundCloud through, for the radio's playlist and the tracks of
// sets, in the configuration section.
export function SoundCloudCredentials() {
  const loaded = useApi('/api/admin/radio/credentials')

  if (loaded.kind === 'loading') return null
  if (loaded.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les identifiants SoundCloud n'ont pas pu être chargés&nbsp;: {loaded.message}
      </p>
    )
  }
  return (
    <CredentialsForm
      saved={loaded.value.credentials}
      savedId={loaded.value.credentials?.clientId ?? ''}
      labels={{ id: 'Client ID', secret: 'Client secret' }}
      service="SoundCloud"
      check={({ id, secret }) => api.POST('/api/admin/radio/credentials/check', { body: { clientId: id, clientSecret: secret } })}
      save={({ id, secret }) => api.PUT('/api/admin/radio/credentials', { body: { clientId: id, clientSecret: secret } })}
      status={(saved) =>
        saved ? (
          <p className="admin-meta">{byWhom('Changés', saved.updatedBy, saved.updatedAt)}</p>
        ) : (
          <p className="admin-placeholder">
            Aucun identifiant&nbsp;: la radio ne peut lire aucune playlist, elle est hors ondes, et les liens SoundCloud des sets ne peuvent
            pas être vérifiés.
          </p>
        )
      }
    >
      <p>
        Le site lit SoundCloud à travers une application SoundCloud, avec ses identifiants&nbsp;: la playlist de la radio, et les
        pistes des sets. Ils se trouvent dans les{' '}
        <a href="https://soundcloud.com/you/apps" target="_blank" rel="noreferrer">
          applications
        </a>{' '}
        du compte SoundCloud qui la possède.
      </p>
    </CredentialsForm>
  )
}
