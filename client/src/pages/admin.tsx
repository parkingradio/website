import { useState } from 'react'
import type { FormEvent } from 'react'

type Status = 'idle' | 'sending' | 'success' | 'error'

export function Admin() {
  const [recipient, setRecipient] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [detail, setDetail] = useState<string | null>(null)

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

  return (
    <div>
      <h1>Admin</h1>
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
