import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'react-router'
import { api } from '../../api/client'

type Status = { kind: 'idle' | 'sending' } | { kind: 'error'; message: string }

// Shown by the admin pages in their place while logged out. `onLogin` gets the logged-in admin's email. `notice` explains
// why the form is shown, e.g. that the session ended, and replaces the message the page was opened with, e.g. from
// accepting an invite.
export function Login({ onLogin, notice }: { onLogin: (email: string) => void; notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const location = useLocation()
  const message = notice ?? (location.state as { message?: string } | null)?.message

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setStatus({ kind: 'sending' })
    const result = await api.POST('/api/auth/login', { body: { email, password } })
    if (result.ok) onLogin(result.email)
    else setStatus({ kind: 'error', message: result.error })
  }

  return (
    <div className="admin-auth">
      <h1>Connexion</h1>
      {message && (
        <p className="admin-notice" role="status">
          {message}
        </p>
      )}
      <form className="admin-form" onSubmit={login}>
        <label>
          Courriel
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={status.kind === 'sending'}>
          se connecter
        </button>
      </form>
      {status.kind === 'error' && (
        <p className="admin-error" role="alert">
          {status.message}
        </p>
      )}
    </div>
  )
}
