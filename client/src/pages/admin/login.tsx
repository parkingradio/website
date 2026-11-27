import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'react-router'
import { api } from '../../api/client'
import { TURNSTILE_PENDING, useTurnstile } from '../../use-turnstile'

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
  const turnstile = useTurnstile()

  const login = async (event: FormEvent) => {
    event.preventDefault()
    if (!turnstile.configured) {
      setStatus({ kind: 'error', message: "La connexion n'est pas possible pour le moment. Rechargez la page." })
      return
    }
    const turnstileToken = turnstile.token
    if (!turnstileToken) {
      setStatus({ kind: 'error', message: TURNSTILE_PENDING })
      return
    }
    setStatus({ kind: 'sending' })
    const result = await api.POST('/api/auth/login', { body: { email, password, turnstileToken } })
    if (result.ok) {
      onLogin(result.email)
      return
    }
    // The server may have checked the token.
    turnstile.renew()
    setStatus({ kind: 'error', message: result.error })
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
        <div className="admin-login-send">
          {turnstile.widget}
          <button type="submit" disabled={status.kind === 'sending'}>
            se connecter
          </button>
        </div>
      </form>
      {status.kind === 'error' && (
        <p className="admin-error" role="alert">
          {status.message}
        </p>
      )}
    </div>
  )
}
