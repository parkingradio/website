import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../api/client'
import type { ApiError, Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import { dateFormat, dateTimeFormat } from './describe'

// The admins section: inviting admins, and the admins there are, who can be invited again until they accept, and revoked.

type Status = { kind: 'idle' | 'sending' | 'success' } | { kind: 'error'; message: string }

function describeStatus(admin: Schema<'Admin'>): string {
  if (admin.status === 'active') return 'actif'
  if (admin.status === 'invited') return `invitation envoyée, expire le ${dateTimeFormat.format(new Date(admin.inviteExpiresAt!))}`
  return 'invitation expirée'
}

// An admin, with what can be done about them. `onChange` reloads the list once they're invited again or revoked.
function AdminRow({ admin, onChange }: { admin: Schema<'Admin'>; onChange: () => void }) {
  // Success is only said of inviting them again, since they're no longer listed once they're revoked.
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const pending = admin.status !== 'active'

  const act = async (send: () => Promise<{ ok: true } | ApiError>, failed: string, succeeded: 'idle' | 'success') => {
    setStatus({ kind: 'sending' })
    const result = await send()
    setStatus(result.ok ? { kind: succeeded } : { kind: 'error', message: `${failed}\u00a0: ${result.error}` })
    // Even after a failure, which can come from the list being out of date, e.g. another admin revoked them already.
    onChange()
  }

  const reinvite = () =>
    act(
      () => api.POST('/api/admin/invite', { body: { email: admin.email } }),
      "L'invitation n'a pas pu être renvoyée",
      'success',
    )

  const revoke = () => {
    const question = pending ? `Révoquer l'invitation de ${admin.email} ?` : `Révoquer l'accès de ${admin.email} ? Ses sessions prendront fin aussitôt.`
    if (!window.confirm(question)) return
    return act(
      () => api.DELETE('/api/admin/admins/{id}', { params: { path: { id: admin.id } } }),
      "L'admin n'a pas pu être révoqué",
      'idle',
    )
  }

  return (
    <tr>
      <td>
        {admin.email}
        {admin.you && ' (vous)'}
      </td>
      <td>{describeStatus(admin)}</td>
      <td>
        {dateFormat.format(new Date(admin.createdAt))}
        {admin.invitedBy && `, par ${admin.invitedBy}`}
      </td>
      <td>
        {pending && (
          <button type="button" disabled={status.kind === 'sending'} onClick={reinvite}>
            renvoyer
          </button>
        )}{' '}
        {!admin.you && (
          <button type="button" disabled={status.kind === 'sending'} onClick={revoke}>
            révoquer
          </button>
        )}
        {status.kind === 'success' && <p className="admin-notice">Invitation renvoyée.</p>}
        {status.kind === 'error' && (
          <p className="admin-error" role="alert">
            {status.message}
          </p>
        )}
      </td>
    </tr>
  )
}

function AdminsList({ version, onChange }: { version: number; onChange: () => void }) {
  const admins = useApi('/api/admin/admins', { version })
  if (admins.kind === 'loading') return null
  if (admins.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les admins n'ont pas pu être chargés&nbsp;: {admins.message}
      </p>
    )
  }
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Courriel</th>
          <th>Statut</th>
          <th>Ajouté</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {admins.value.admins.map((admin) => (
          <AdminRow key={admin.id} admin={admin} onChange={onChange} />
        ))}
      </tbody>
    </table>
  )
}

export function Admins() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // Changed to reload the list, e.g. once someone is invited.
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((version) => version + 1)

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    setStatus({ kind: 'sending' })
    const result = await api.POST('/api/admin/invite', { body: { email } })
    if (result.ok) {
      setStatus({ kind: 'success' })
      setEmail('')
      reload()
    } else {
      setStatus({ kind: 'error', message: result.error })
    }
  }

  return (
    <>
      <h1>Admins</h1>

      <h2>Inviter un admin</h2>
      <form className="admin-form" onSubmit={invite}>
        <label>
          Courriel
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <button type="submit" disabled={status.kind === 'sending'}>
          envoyer l'invitation
        </button>
      </form>
      {status.kind === 'success' && <p className="admin-notice">Invitation envoyée.</p>}
      {status.kind === 'error' && (
        <p className="admin-error" role="alert">
          L'invitation n'a pas pu être envoyée&nbsp;: {status.message}
        </p>
      )}

      <h2>Admins existants</h2>
      <AdminsList version={version} onChange={reload} />
    </>
  )
}
