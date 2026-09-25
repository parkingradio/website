import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { AcceptInviteRequest, AcceptInviteResponse } from 'shared/auth'
import type { ApiError } from 'shared/error'

type Status = 'idle' | 'sending' | 'error'

const MIN_PASSWORD_LENGTH = 8

export function AcceptInvite() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const acceptInvite = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus('error')
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (password !== confirmPassword) {
      setStatus('error')
      setError('Passwords do not match')
      return
    }

    setStatus('sending')
    setError(null)
    try {
      const response = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password } satisfies AcceptInviteRequest),
      })
      const body: AcceptInviteResponse | ApiError = await response.json()
      if (!body.ok) throw new Error(body.error ?? 'Unknown error')
      navigate('/login', { state: { message: 'Password set, please log in.' } })
    } catch (error) {
      setStatus('error')
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div>
      <h1>Set your password</h1>
      <form onSubmit={acceptInvite}>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <p>Must be at least {MIN_PASSWORD_LENGTH} characters.</p>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <button type="submit" disabled={status === 'sending'}>
          Set password
        </button>
      </form>
      {status === 'error' && <p>{error}</p>}
    </div>
  )
}
