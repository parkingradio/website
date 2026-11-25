import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../../api/client'

// Replacing the links to the admin's calendars, which Calendrier's legend has, in the integrations section (see
// docs/design/client/admin/integrations.md).
export function CalendarLinks() {
  const [status, setStatus] = useState<{ kind: 'idle' | 'sending' | 'done' } | { kind: 'error'; message: string }>({ kind: 'idle' })

  const regenerate = async () => {
    if (!window.confirm('Régénérer vos liens ? Les calendriers abonnés avec les liens actuels ne seront plus mis à jour.')) return
    setStatus({ kind: 'sending' })
    const result = await api.POST('/api/admin/ics-subscription-token')
    setStatus(result.ok ? { kind: 'done' } : { kind: 'error', message: result.error })
  }

  // Greyed out while the links are replaced, keeping the focus (see "Controls that can't be used" in
  // docs/design/client/admin/layout.md).
  const sending = status.kind === 'sending'
  return (
    <>
      <p>
        Les liens d'abonnement de la légende du <Link to="/admin/calendrier">Calendrier</Link> sont personnels&nbsp;: quiconque
        les a voit ces calendriers. Les régénérer arrête la mise à jour des calendriers abonnés avec les liens actuels.
      </p>
      <p>
        <button type="button" aria-disabled={sending || undefined} onClick={sending ? undefined : regenerate}>
          régénérer les liens
        </button>
      </p>
      {status.kind === 'done' && (
        <p className="admin-notice" role="status">
          Liens régénérés&nbsp;: abonnez-vous à nouveau depuis la légende du Calendrier, puis retirez les anciens calendriers de
          votre application.
        </p>
      )}
      {status.kind === 'error' && (
        <p className="admin-error" role="alert">
          Les liens n'ont pas pu être régénérés&nbsp;: {status.message}
        </p>
      )}
    </>
  )
}
