import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'

type Status = 'idle' | 'sending' | 'success' | 'error'
type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated'

export function Admin() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [email, setEmail] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState<Status>('idle')
  const [inviteError, setInviteError] = useState<string | null>(null)

  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/admin/me')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body) => {
        setEmail(body.email)
        setAuthStatus('authenticated')
      })
      .catch(() => setAuthStatus('unauthenticated'))
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    navigate('/login')
  }

  const inviteAdmin = async (event: FormEvent) => {
    event.preventDefault()
    setInviteStatus('sending')
    setInviteError(null)
    try {
      const response = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Unknown error')
      setInviteStatus('success')
      setInviteEmail('')
    } catch (error) {
      setInviteStatus('error')
      setInviteError(error instanceof Error ? error.message : String(error))
    }
  }

  if (authStatus === 'checking') return null
  if (authStatus === 'unauthenticated') return <Navigate to="/login" replace />

  return (
    <div>
      <h1>Admin</h1>
      <p>
        Logged in as {email}. <button onClick={logout}>Log out</button>
      </p>

      <h2>Invite a new admin</h2>
      <form onSubmit={inviteAdmin}>
        <label>
          Email
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={inviteStatus === 'sending'}>
          Send invite
        </button>
      </form>
      {inviteStatus === 'success' && <p>Invite sent.</p>}
      {inviteStatus === 'error' && <p>Failed to send invite: {inviteError}</p>}
    </div>
  )
}
