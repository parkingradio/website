import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'

type Status = 'idle' | 'sending' | 'error'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setStatus('sending')
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Unknown error')
      navigate('/admin')
    } catch (error) {
      setStatus('error')
      setError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div>
      <h1>Log in</h1>
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
