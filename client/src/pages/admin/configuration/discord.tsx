import { api } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { byWhom } from '../describe'
import { CredentialsForm } from './credentials-form'

// The Discord bot the server reaches the chat through, and the channel it reaches, in the configuration section.
export function DiscordCredentials() {
  const loaded = useApi('/api/admin/chat/discord')

  if (loaded.kind === 'loading') return null
  if (loaded.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les identifiants Discord n'ont pas pu être chargés&nbsp;: {loaded.message}
      </p>
    )
  }
  return (
    <CredentialsForm
      saved={loaded.value.credentials}
      savedId={loaded.value.credentials?.channelId ?? ''}
      labels={{ id: 'ID du salon Discord', secret: 'Token du bot Discord' }}
      service="Discord"
      check={({ id, secret }) => api.POST('/api/admin/chat/discord/check', { body: { botToken: secret, channelId: id } })}
      save={({ id, secret }) => api.PUT('/api/admin/chat/discord', { body: { botToken: secret, channelId: id } })}
      status={(saved) =>
        saved ? (
          <p className="admin-meta">
            Bot «&nbsp;{saved.botName}&nbsp;» → #{saved.channelName}. {byWhom('Changés', saved.updatedBy, saved.updatedAt)}
          </p>
        ) : (
          <p className="admin-placeholder">Aucun identifiant pour le moment.</p>
        )
      }
    >
      <p>
        Le site joint le salon #chat du serveur Discord de Parking Radio avec un bot à lui. Pour le moment, ses identifiants
        sont seulement vérifiés et gardés&nbsp;: la page d'accueil montre toujours le chat par WidgetBot. Le token du bot se
        trouve dans la page «&nbsp;Bot&nbsp;» de son application, sur le{' '}
        <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
          portail des développeurs
        </a>{' '}
        de Discord, et l'ID du salon est le second nombre de l'adresse du salon, quand Discord est ouvert dans un
        navigateur&nbsp;: discord.com/channels/&lt;ID du serveur&gt;/&lt;ID du salon&gt;.
      </p>
    </CredentialsForm>
  )
}
