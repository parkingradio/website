import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useApi } from '../../api/use-api'
import type { Application } from '../../application-fields'
import { Combobox } from '../../combobox'
import type { ComboboxFilter, ComboboxOption } from '../../combobox'
import { quebecDayAndTime } from '../../quebec-time'
import type { Session } from '../../session-fields'
import { Button } from './button'
import { compareStarts, sessionHours, sessionName, sessionSearchFields } from './describe'
import { search } from './list'
import { SessionsFailure } from './profile-details'
import { newSessionPath, sessionPath } from './session-errors'

// "créer un set", on an artist's application's page: the session to add a set to, picked among the planned ones, or a
// new one, which then opens with a new set's form filled in from the application (see "From an application" in
// docs/design/client/admin/sessions.md).

const NEW_SESSION: ComboboxOption = { key: '', label: 'nouvelle session' }

// The address that adds a set to `session`, or to a new one when it's null, from `application`.
function fromApplicationPath(session: Session | null, application: Pick<Application, 'id'>): string {
  return session ? `${sessionPath(session)}?application=${application.id}` : newSessionPath({ application: application.id })
}

// "nouvelle session", then the planned sessions, those on one of the days the artist would like to play first, by date,
// marked as such, then the others, in the order of the default view of the list of sessions.
function sessionOptions(sessions: Session[], dates: string[]): ComboboxOption[] {
  const wished: ComboboxOption[] = []
  const others: ComboboxOption[] = []
  for (const session of sessions.filter((session) => session.status === 'planned').toSorted(compareStarts)) {
    const option = { key: session.id, label: sessionName(session), detail: sessionHours(session) }
    if (session.start !== null && dates.includes(quebecDayAndTime(new Date(session.start)).day)) wished.push({ ...option, detail: `${option.detail} · date souhaitée` })
    else others.push(option)
  }
  return [NEW_SESSION, ...wished, ...others]
}

export function CreateSet({ application }: { application: Pick<Application, 'id' | 'dates'> }) {
  const [picking, setPicking] = useState(false)
  // Whether the field was closed, which then gives the focus back to the button that opens it.
  const closed = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!picking && closed.current) button.current?.focus()
    closed.current = false
  }, [picking])
  if (picking) {
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
      <button ref={button} type="button" onClick={() => setPicking(true)}>
        créer un set
      </button>
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

  const sessions = loaded.kind === 'loaded' ? loaded.value.sessions : []
  const options = sessionOptions(sessions, application.dates)
  const byId = new Map(sessions.map((session) => [session.id, session]))
  // As the list of sessions is searched, and "nouvelle session" by what it shows.
  const filter: ComboboxFilter = (options, query) =>
    search(options, query, (option) => {
      const session = byId.get(option.key)
      return session ? sessionSearchFields(session) : [option.label]
    })

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
          onClick={() => navigate(fromApplicationPath(byId.get(picked!) ?? null, application))}
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
