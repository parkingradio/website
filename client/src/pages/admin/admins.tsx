import { useState } from 'react'
import type { FormEvent } from 'react'
import type { InviteRequest, InviteResponse } from 'shared/admin'
import { postJson } from '../../api'
import { NotImplemented } from './not-implemented'

type Status = { kind: 'idle' | 'sending' | 'success' } | { kind: 'error'; message: string }

export function Admins() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    setStatus({ kind: 'sending' })
    const result = await postJson<InviteRequest, InviteResponse>('/api/admin/invite', { email })
    if (result.ok) {
      setStatus({ kind: 'success' })
      setEmail('')
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
      <NotImplemented />
    </>
  )
}
