import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'react-router'
import type { LoginRequest, LoginResponse } from 'shared/auth'
import { postJson } from '../../api'

type Status = { kind: 'idle' | 'sending' } | { kind: 'error'; message: string }

// Shown by the admin pages in their place while logged out. `onLogin` gets the logged-in admin's email.
export function Login({ onLogin }: { onLogin: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const location = useLocation()
  const message = (location.state as { message?: string } | null)?.message

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setStatus({ kind: 'sending' })
    const result = await postJson<LoginRequest, LoginResponse>('/api/auth/login', { email, password })
    if (result.ok) onLogin(result.email)
    else setStatus({ kind: 'error', message: result.error })
  }

  return (
    <div className="admin-auth">
      <h1>Connexion</h1>
      {message && <p className="admin-notice">{message}</p>}
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
