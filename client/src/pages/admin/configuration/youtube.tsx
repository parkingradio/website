import { api } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { byWhom } from '../describe'
import { CredentialsForm } from './credentials-form'

// The YouTube channel the server reads the site's video from, and the API key it reads it with, in the configuration
// section.
export function YouTubeCredentials() {
  const loaded = useApi('/api/admin/video/credentials')

  if (loaded.kind === 'loading') return null
  if (loaded.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les identifiants YouTube n'ont pas pu être chargés&nbsp;: {loaded.message}
      </p>
    )
  }
  return (
    <CredentialsForm
      saved={loaded.value.credentials}
      savedId={loaded.value.credentials?.channelId ?? ''}
      labels={{ id: 'ID de la chaîne', secret: "Clé d'API" }}
      service="YouTube"
      check={({ id, secret }) => api.POST('/api/admin/video/credentials/check', { body: { channelId: id, apiKey: secret } })}
      save={({ id, secret }) => api.PUT('/api/admin/video/credentials', { body: { channelId: id, apiKey: secret } })}
      status={(saved) =>
        saved ? (
          <>
            <p className="admin-meta">{byWhom('Changés', saved.updatedBy, saved.updatedAt)}</p>
            {saved.error && <p className="admin-error">La dernière lecture de YouTube a échoué&nbsp;: {saved.error}</p>}
          </>
        ) : (
          <p className="admin-placeholder">Aucun identifiant&nbsp;: le site n'a aucune vidéo à montrer.</p>
        )
      }
    >
      <p>
        Le site lit la chaîne YouTube de Parking Radio avec une clé de l'API YouTube Data v3, pour choisir la vidéo qu'il montre.
        L'ID de la chaîne se trouve dans les{' '}
        <a href="https://www.youtube.com/account_advanced" target="_blank" rel="noreferrer">
          paramètres avancés
        </a>{' '}
        du compte YouTube, et la clé dans les{' '}
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
          identifiants
        </a>{' '}
        d'un projet Google Cloud, restreinte à l'API YouTube Data v3.
      </p>
    </CredentialsForm>
  )
}
