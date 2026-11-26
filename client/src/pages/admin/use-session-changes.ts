import { useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../api/client'
import type { Session, SessionStatus } from '../../session-fields'
import { RA_EVENT_KEPT, SET_STATUS_LABELS, raEventKept, sessionName, setTitle } from './describe'
import type { Announced } from './describe'
import { failure } from './session-errors'

// Whether to go ahead with making `session` `announced` or not: only un-announcing an announced session with an event on
// RA asks first, since the event stays as it is.
export const confirmAnnouncing = (session: Session, announced: Announced) =>
  announced === 'true' || !session.announced || !session.raEvent || window.confirm(`${RA_EVENT_KEPT}\nRetirer l'annonce de la session ?`)

// Whether to go ahead with giving `session` `status`, which asks first when that changes its sets, or leaves its event on
// RA as it is.
export function confirmStatus(session: Session, status: SessionStatus): boolean {
  // Cancelling it cancels its sets that aren't cancelled, played ones included, so they're named, saying which were
  // played, and leaves its event on RA as it is. A session that's already cancelled has nothing to say.
  if (status === 'cancelled' && session.status !== 'cancelled') {
    const uncancelled = session.sets.filter((set) => set.status !== 'cancelled')
    const cancelled = uncancelled.length === 1 ? 'Ce set sera aussi annulé' : 'Ces sets seront aussi annulés'
    const names = uncancelled.map((set) => `• ${setTitle(set)}${set.status === 'done' ? ` (${SET_STATUS_LABELS.done})` : ''}`).join('\n')
    const said = (uncancelled.length > 0 ? `${cancelled}\u00a0:\n${names}\n` : '') + raEventKept(session)
    return !said || window.confirm(`${said}Annuler la session ?`)
  }
  // Marking it done marks its planned sets done, which could be a set that didn't happen, so they're named.
  const planned = session.sets.filter((set) => set.status === 'planned')
  if (status === 'done' && planned.length > 0) {
    const marked = planned.length === 1 ? 'Le set planifié sera aussi marqué comme joué' : 'Les sets planifiés seront aussi marqués comme joués'
    const names = planned.map((set) => `• ${setTitle(set)}`).join('\n')
    return window.confirm(`${marked}\u00a0:\n${names}\nMarquer la session comme jouée ?`)
  }
  return true
}

// What a change answers: the session as it then is, or why it couldn't be made.
type Changed = { ok: true; session: Session } | ({ ok: false } & Parameters<typeof failure>[1])

// Changing the status of sessions of a list, or announcing them, or un-announcing them, from their rows, once confirmed:
// `current` gives the sessions loaded as the changes left them, `changeStatus` and `announce` change one, and `error` says
// why the last change couldn't be made, if it couldn't. `statusChanged` is called once a status is saved.
export function useSessionChanges({ statusChanged }: { statusChanged?: () => void } = {}) {
  const [changed, setChanged] = useState<Record<string, Session>>({})
  const [error, setError] = useState<ReactNode>(null)
  // Shows `session` as `request` saved it, or else says why `what` couldn't be done, and resolves to whether it was saved.
  const change = async (session: Session, what: string, request: Promise<Changed>) => {
    setError(null)
    const result = await request
    if (result.ok) setChanged((changed) => ({ ...changed, [session.id]: result.session }))
    else setError(failure(what, result, session.id))
    return result.ok
  }
  return {
    current: (sessions: Session[]) => sessions.map((session) => changed[session.id] ?? session),
    error,
    async changeStatus(session: Session, status: SessionStatus) {
      if (!confirmStatus(session, status)) return
      const what = `Le statut de «\u00a0${sessionName(session)}\u00a0» n'a pas pu être changé`
      if (await change(session, what, api.PUT('/api/admin/sessions/{id}/status', { params: { path: { id: session.id } }, body: { status } }))) statusChanged?.()
    },
    async announce(session: Session, announced: Announced) {
      if (!confirmAnnouncing(session, announced)) return
      const what = `L'annonce de «\u00a0${sessionName(session)}\u00a0» n'a pas pu être changée`
      await change(session, what, api.PUT('/api/admin/sessions/{id}/announced', { params: { path: { id: session.id } }, body: { announced: announced === 'true' } }))
    },
  }
}

export type SessionChanges = ReturnType<typeof useSessionChanges>
