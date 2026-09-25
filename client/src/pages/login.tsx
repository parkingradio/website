import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { LoginRequest, LoginResponse } from 'shared/auth'
import type { ApiError } from 'shared/error'

type Status = 'idle' | 'sending' | 'error'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const message = (location.state as { message?: string } | null)?.message

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setStatus('sending')
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password } satisfies LoginRequest),
      })
      const body: LoginResponse | ApiError = await response.json()
      if (!body.ok) throw new Error(body.error ?? 'Unknown error')
      navigate('/admin')
    } catch (error) {
      setStatus('error')
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div>
      <h1>Log in</h1>
      {message && <p>{message}</p>}
      <form onSubmit={login}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={status === 'sending'}>
          Log in
        </button>
      </form>
      {status === 'error' && <p>{error}</p>}
    </div>
  )
}
