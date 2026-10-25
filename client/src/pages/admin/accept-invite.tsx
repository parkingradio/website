import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../../api/client'

type Status = { kind: 'idle' | 'sending' } | { kind: 'error'; message: string }

const MIN_PASSWORD_LENGTH = 8

export function AcceptInvite() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const navigate = useNavigate()

  const acceptInvite = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus({ kind: 'error', message: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` })
      return
    }
    if (password !== confirmPassword) {
      setStatus({ kind: 'error', message: 'Les mots de passe ne correspondent pas' })
      return
    }

    setStatus({ kind: 'sending' })
    const result = await api.POST('/api/auth/accept-invite', { body: { token, password } })
    if (result.ok) {
      navigate('/admin', { state: { message: 'Mot de passe enregistré, vous pouvez maintenant vous connecter.' } })
    } else {
      setStatus({ kind: 'error', message: result.error })
    }
  }

  return (
    <div className="admin-auth">
      <h1>Choisir un mot de passe</h1>
      <form className="admin-form" onSubmit={acceptInvite}>
        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <p className="admin-hint">Au moins {MIN_PASSWORD_LENGTH} caractères.</p>
        <label>
          Confirmer le mot de passe
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <button type="submit" disabled={status.kind === 'sending'}>
          enregistrer le mot de passe
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
