import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'

type Status = 'idle' | 'sending' | 'success' | 'error'
type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated'

export function Admin() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [email, setEmail] = useState<string | null>(null)

  const [recipient, setRecipient] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [detail, setDetail] = useState<string | null>(null)

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

  const sendTestEmail = async (event: FormEvent) => {
    event.preventDefault()
    setStatus('sending')
    setDetail(null)
    try {
      const response = await fetch('/api/admin/send-test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Unknown error')
      setStatus('success')
      setDetail(body.messageId)
    } catch (error) {
      setStatus('error')
      setDetail(error instanceof Error ? error.message : String(error))
    }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    navigate('/login')
  }

  if (authStatus === 'checking') return null
  if (authStatus === 'unauthenticated') return <Navigate to="/login" replace />

  return (
    <div>
      <h1>Admin</h1>
      <p>
        Logged in as {email}. <button onClick={logout}>Log out</button>
      </p>

      <form onSubmit={sendTestEmail}>
        <label>
          Recipient email
          <input
            type="email"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={status === 'sending'}>
          Send test email
        </button>
      </form>
      {status === 'success' && <p>Email sent (id: {detail}).</p>}
      {status === 'error' && <p>Failed to send email: {detail}</p>}
    </div>
  )
}
