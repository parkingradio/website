import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Application } from '../../application-fields'
import { Combobox } from '../../combobox'
import type { ComboboxFilter, ComboboxOption } from '../../combobox'
import { quebecDayAndTime } from '../../quebec-time'
import type { Session, StudioSet } from '../../session-fields'
import { Button } from './button'
import { SESSION_STATUS_LABELS, compareStarts, sessionHours, sessionName, sessionSearchFields, setInSentence, setName } from './describe'
import { search } from './list'
import { SessionsFailure } from './profile-details'
import { failure, newSessionPath, sessionPath } from './session-errors'

// Picking a session: on an artist's application's page, "créer un set", the session to add a set to, picked among the
// planned ones, or a new one, which then opens with a new set's form filled in from the application (see "From an
// application" in docs/design/client/admin/sessions.md), and on a session's page, the session to move one of its sets to
// (see "Moving a set to another session" there).

// A session, as the fields offer it: by its title and its day, with its times in short.
function sessionOption(session: Session): ComboboxOption {
  return { key: session.id, label: sessionName(session), detail: sessionHours(session) }
}

// The planned sessions, in the order of the default view of the list of sessions.
function plannedSessions(sessions: Session[]): Session[] {
  return sessions.filter((session) => session.status === 'planned').toSorted(compareStarts)
}

// Searches the options as the list of sessions is searched, and those that aren't a session of `sessions`, e.g. "nouvelle
// session", by what they show.
function sessionFilter(sessions: Session[]): ComboboxFilter {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  return (options, query) =>
    search(options, query, (option) => {
      const session = byId.get(option.key)
      return session ? sessionSearchFields(session) : [option.label]
    })
}

const NEW_SESSION: ComboboxOption = { key: '', label: 'nouvelle session' }

// What the fields offer while the sessions aren't loaded, the same list each time, so that what's worked out from it is
// kept from one render to the next (see `useMemo` below).
const NO_SESSIONS: Session[] = []

// The address that adds a set to `session`, or to a new one when it's null, from `application`.
function fromApplicationPath(session: Session | null, application: Pick<Application, 'id'>): string {
  return session ? `${sessionPath(session)}?${new URLSearchParams({ application: application.id })}` : newSessionPath({ application: application.id })
}

// "nouvelle session", then the planned sessions, those on one of the days the artist would like to play first, by date,
// marked as such, then the others, in the order of the default view of the list of sessions.
function sessionOptions(sessions: Session[], dates: string[]): ComboboxOption[] {
  const wished: ComboboxOption[] = []
  const others: ComboboxOption[] = []
  for (const session of plannedSessions(sessions)) {
    const option = sessionOption(session)
    if (session.start !== null && dates.includes(quebecDayAndTime(new Date(session.start)).day)) wished.push({ ...option, detail: `${option.detail} · date souhaitée` })
    else others.push(option)
  }
  return [NEW_SESSION, ...wished, ...others]
}

// Why a rejected application can't lead to a set or a session, which would be planned (see "Applications" in
// docs/design/server/sessions.md).
export const REJECTED_CANT_BOOK = 'Une candidature refusée ne peut pas avoir de set ou de session planifié.'

export function CreateSet({ application }: { application: Pick<Application, 'id' | 'dates' | 'decision'> }) {
  const [picking, setPicking] = useState(false)
  // Whether the field was closed, which then gives the focus back to the button that opens it.
  const closed = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!picking && closed.current) button.current?.focus()
    closed.current = false
  }, [picking])
  // Closed once the application is rejected, which can't lead to a set.
  if (picking && application.decision !== 'rejected') {
    return (
      <SessionPicker
        application={application}
        onClose={() => {
          closed.current = true
          setPicking(false)
        }}
      />
    )
  }
  return (
    <div className="admin-toolbar">
      {application.decision === 'rejected' ? (
        <Button unavailable={REJECTED_CANT_BOOK}>créer un set</Button>
      ) : (
        <button ref={button} type="button" onClick={() => setPicking(true)}>
          créer un set
        </button>
      )}
    </div>
  )
}

// The field that picks the session, loaded each time it opens, and what leads to it once it's picked.
function SessionPicker({ application, onClose }: { application: Pick<Application, 'id' | 'dates'>; onClose: () => void }) {
  const id = useId()
  const navigate = useNavigate()
  const loaded = useApi('/api/admin/sessions')
  const [picked, setPicked] = useState<string | null>(null)
  // The field gets the focus as it opens.
  useEffect(() => document.getElementById(id)?.focus(), [id])

  const sessions = loaded.kind === 'loaded' ? loaded.value.sessions : NO_SESSIONS
  // Kept from one render to the next, so that the field doesn't search them again on every render (see combobox.tsx).
  const options = useMemo(() => sessionOptions(sessions, application.dates), [sessions, application.dates])
  const filter = useMemo(() => sessionFilter(sessions), [sessions])

  return (
    <>
      <div className="admin-field">
        <label htmlFor={id}>Session</label>
        <Combobox
          id={id}
          options={options}
          selected={picked}
          onSelect={setPicked}
          filter={filter}
          placeholder={loaded.kind === 'loading' ? 'chargement des sessions…' : 'choisir une session…'}
        />
      </div>
      {loaded.kind === 'error' && <SessionsFailure message={loaded.message} />}
      <div className="admin-toolbar">
        <Button
          unavailable={picked === null ? "Choisissez d'abord une session." : null}
          onClick={() => navigate(fromApplicationPath(sessions.find((session) => session.id === picked) ?? null, application))}
        >
          créer le set
        </Button>
        <button type="button" onClick={onClose}>
          annuler
        </button>
      </div>
    </>
  )
}

// The other sessions a set of `session` can be moved to: first the planned ones, in the order of the default view of the
// list of sessions, then the others, in the order of its "toutes" view, the latest first, each with its status unless
// it's planned.
function moveOptions(sessions: Session[], session: Session): ComboboxOption[] {
  const others = sessions.filter((other) => other.id !== session.id)
  const unplanned = others.filter((other) => other.status !== 'planned').toSorted((a, b) => compareStarts(b, a))
  return [
    ...plannedSessions(others).map(sessionOption),
    ...unplanned.map((other) => {
      const option = sessionOption(other)
      return { ...option, detail: `${option.detail} · ${SESSION_STATUS_LABELS[other.status]}` }
    }),
  ]
}

export type MovedSet = { session: Session; previousSession: Session }

// The panel that moves `set`, of `session`, to another session, picked among every other one, loaded each time it opens,
// whose field gets the focus as it opens. What the server answers once it's moved goes to `onMoved`. When it can't be
// moved, the panel says why.
export function MoveSet({
  set,
  session,
  onCancel,
  onMoved,
}: {
  set: StudioSet
  session: Session
  onCancel: () => void
  onMoved: (moved: MovedSet) => void
}) {
  const id = useId()
  const headingId = useId()
  const loaded = useApi('/api/admin/sessions')
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReactNode>(null)
  useEffect(() => document.getElementById(id)?.focus(), [id])

  const sessions = loaded.kind === 'loaded' ? loaded.value.sessions : NO_SESSIONS
  // Kept from one render to the next, so that the field doesn't search them again on every render (see combobox.tsx).
  const options = useMemo(() => moveOptions(sessions, session), [sessions, session])
  const filter = useMemo(() => sessionFilter(sessions), [sessions])
  const target = sessions.find((other) => other.id === picked) ?? null
  let unavailable: string | null = null
  if (!target) unavailable = "Choisissez d'abord une session."
  else if (target.status === 'cancelled' && set.status !== 'cancelled') unavailable = 'La session est annulée\u00a0: on ne peut pas y déplacer le set.'

  const move = async () => {
    setBusy(true)
    setError(null)
    const result = await api.PUT('/api/admin/sets/{id}/session', { params: { path: { id: set.id } }, body: { session: target!.id } })
    setBusy(false)
    if (!result.ok) return setError(failure(`Le set «\u00a0${setName(set)}\u00a0» n'a pas pu être déplacé dans une autre session`, result, session.id))
    onMoved(result)
  }

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Déplacer {setInSentence(set)}</h3>
      <div className="admin-field">
        <label htmlFor={id}>Session</label>
        <Combobox
          id={id}
          options={options}
          selected={picked}
          onSelect={setPicked}
          filter={filter}
          placeholder={loaded.kind === 'loading' ? 'chargement des sessions…' : 'choisir une session…'}
        />
      </div>
      {loaded.kind === 'error' && <SessionsFailure message={loaded.message} />}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-toolbar">
        <Button unavailable={unavailable} disabled={busy} onClick={move}>
          déplacer
        </Button>
        <button type="button" onClick={onCancel}>
          annuler
        </button>
      </div>
    </section>
  )
}

