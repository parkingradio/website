import { useState } from 'react'
import { api } from '../../api/client'
import type { Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import { dateTimeFormat } from './describe'

// The Admins page's sections about apps: connecting Claude to the admin pages, and the apps the admin connected (see
// docs/design/client/admin/admins.md).

export function ConnectClaude() {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  // The MCP server's, which admins give Claude.
  const address = `${window.location.origin}/mcp`

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <>
      <h2>Connecter Claude</h2>
      <p>
        Claude peut faire pour vous presque tout ce que vous faites dans ces pages, par exemple ajouter un artiste, planifier
        une session ou trier les candidatures. Il agit en votre nom.
      </p>
      <p>
        Adresse du connecteur&nbsp;: <code>{address}</code>{' '}
        <button type="button" onClick={copyAddress}>
          copier
        </button>
      </p>
      {copy === 'copied' && (
        <p className="admin-notice" role="status">
          Adresse copiée.
        </p>
      )}
      {copy === 'failed' && (
        <p className="admin-error" role="alert">
          L'adresse n'a pas pu être copiée&nbsp;: sélectionnez-la pour la copier vous-même.
        </p>
      )}
      <ol>
        <li>Dans Claude, sur claude.ai ou dans l'application, ouvrez les paramètres, puis les connecteurs.</li>
        <li>Ajoutez un connecteur personnalisé, avec cette adresse.</li>
        <li>Ne remplissez pas les paramètres avancés (identifiant et secret OAuth).</li>
        <li>Lancez la connexion&nbsp;: Claude ouvre une page de ce site, où vous l'autorisez.</li>
      </ol>
      <p>Selon votre abonnement Claude, il se peut que seul le propriétaire de votre organisation puisse ajouter un connecteur.</p>
      <p>
        Avec Claude Code&nbsp;: <code>claude mcp add --transport http parking-radio {address}</code>
      </p>
    </>
  )
}

// One of the admin's connections. `onChange` reloads the list once it's ended, or failed to.
function ConnectionRow({ connection, onChange }: { connection: Schema<'Connection'>; onChange: () => void }) {
  const [status, setStatus] = useState<{ kind: 'idle' | 'sending' } | { kind: 'error'; message: string }>({ kind: 'idle' })

  const disconnect = async () => {
    setStatus({ kind: 'sending' })
    const result = await api.DELETE('/api/admin/connections/{id}', { params: { path: { id: connection.id } } })
    setStatus(result.ok ? { kind: 'idle' } : { kind: 'error', message: result.error })
    onChange()
  }

  return (
    <tr>
      <td>{connection.client}</td>
      <td>{dateTimeFormat.format(new Date(connection.createdAt))}</td>
      <td>{dateTimeFormat.format(new Date(connection.lastUsedAt))}</td>
      <td>
        <button type="button" disabled={status.kind === 'sending'} onClick={disconnect}>
          déconnecter
        </button>
        {status.kind === 'error' && (
          <p className="admin-error" role="alert">
            L'application n'a pas pu être déconnectée&nbsp;: {status.message}
          </p>
        )}
      </td>
    </tr>
  )
}

export function ConnectedApps() {
  // Changed to reload the list, e.g. once an app is disconnected.
  const [version, setVersion] = useState(0)
  const connections = useApi('/api/admin/connections', { version })

  let list
  if (connections.kind === 'loading') list = null
  else if (connections.kind === 'error') {
    list = (
      <p className="admin-error" role="alert">
        Les applications connectées n'ont pas pu être chargées&nbsp;: {connections.message}
      </p>
    )
  } else if (connections.value.connections.length === 0) {
    list = <p className="admin-placeholder">Aucune application connectée.</p>
  } else {
    list = (
      <table className="admin-table">
        <thead>
          <tr>
            <th>Application</th>
            <th>Connectée le</th>
            <th>Dernière utilisation</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {connections.value.connections.map((connection) => (
            <ConnectionRow key={connection.id} connection={connection} onChange={() => setVersion((version) => version + 1)} />
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <>
      <h2>Vos applications connectées</h2>
      {list}
    </>
  )
}
