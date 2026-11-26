import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../api/client'
import type { Session } from '../../session-fields'
import { RA_EVENT_KEPT, sessionName } from './describe'
import type { Announced } from './describe'
import { failure } from './session-errors'

// Whether to go ahead with making `session` `announced` or not: only un-announcing an announced session with an event on
// RA asks first, since the event stays as it is.
export const confirmAnnouncing = (session: Session, announced: Announced) =>
  announced === 'true' || !session.announced || !session.raEvent || window.confirm(`${RA_EVENT_KEPT}\nRetirer l'annonce de la session ?`)

// Announcing sessions of a list, or un-announcing them, from their rows: `current` gives the sessions loaded as the
// changes left them, `announce` changes one, and `error` says why the last change couldn't be made, if it couldn't.
export function useAnnouncing() {
  const [changed, setChanged] = useState<Record<string, Session>>({})
  const [error, setError] = useState<ReactNode>(null)
  return {
    current: (sessions: Session[]) => sessions.map((session) => changed[session.id] ?? session),
    error,
    async announce(session: Session, announced: Announced) {
      if (!confirmAnnouncing(session, announced)) return
      setError(null)
      const result = await api.PUT('/api/admin/sessions/{id}/announced', { params: { path: { id: session.id } }, body: { announced: announced === 'true' } })
      if (result.ok) setChanged((changed) => ({ ...changed, [session.id]: result.session }))
      else setError(failure(`L'annonce de «\u00a0${sessionName(session)}\u00a0» n'a pas pu être changée`, result, session.id))
    },
  }
}

export type Announcing = ReturnType<typeof useAnnouncing>
