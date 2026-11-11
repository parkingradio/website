import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, formData } from '../../api/client'
import type { Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import { checkSession, sessionFormValues } from '../../session-fields'
import type { Session } from '../../session-fields'
import { raEventId, raEventUrl } from '../../session-links'
import { MISSING, sessionWhen } from './describe'
import { FormActions, Labeled } from './fields'
import { failure } from './session-errors'

// Creating a session's event on Resident Advisor by hand, from its page: the content of the event, as the server gives
// it, with a button to copy each of its texts, and the field its link is pasted in (see "A session's page" in
// docs/design/client/admin/sessions.md).

const RA_CREATE_EVENT = 'https://ra.co/pro/event/create'

type RaEventContent = Schema<'RaEventContent'>

// Copies `text`, and says so for a moment.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => {
    if (copied === null) return
    const timeout = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(timeout)
  }, [copied])
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setCopied('copied'),
      () => setCopied('failed'),
    )
  return (
    <button type="button" className="admin-copy" aria-label={`copier ${label}`} onClick={copy}>
      {copied === 'copied' ? 'copié' : copied === 'failed' ? 'échec de la copie' : 'copier'}
    </button>
  )
}

// A text of the event, with its button, or "-" without one when it's empty.
function Copyable({ text, label, multiline = false }: { text: string; label: string; multiline?: boolean }) {
  if (!text) return <dd>{MISSING}</dd>
  return (
    <dd className="admin-copyable">
      <span className={multiline ? 'admin-text' : undefined}>{text}</span>
      <CopyButton text={text} label={label} />
    </dd>
  )
}

function RaLink({ path }: { path: string }) {
  const url = `https://ra.co/${path}`
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {url}
    </a>
  )
}

// The content of the event, field by field.
function RaEventRecord({ session, event }: { session: Session; event: RaEventContent }) {
  return (
    <dl className="admin-record" aria-label="Contenu de l'événement RA">
      <dt>Titre</dt>
      <Copyable text={event.title} label="le titre" />
      <dt>Quand</dt>
      {/* The session's times, which RA takes without their offset. */}
      <dd>{sessionWhen(session)}</dd>
      <dt>Line-up</dt>
      <Copyable text={event.lineup} label="le line-up" multiline />
      <dt>Salle</dt>
      <dd>
        <RaLink path={`clubs/${event.venueId}`} />
      </dd>
      <dt>Promoteur</dt>
      <dd>
        {event.promoterIds.map((id) => (
          <RaLink key={id} path={`promoters/${id}`} />
        ))}
      </dd>
      <dt>Description</dt>
      <Copyable text={event.content} label="la description" multiline />
    </dl>
  )
}

// The panel that opens under the session's "Événement RA" while it has none: the content of its event, as the server
// gives it, to create it on RA by hand, and the field its link is pasted in, which saves it as the session's event.
export function RaEventPanel({ session, onSaved, onCancel }: { session: Session; onSaved: (session: Session) => void; onCancel: () => void }) {
  // Again whenever the session changes, its sets included, since the event's content follows them.
  const loaded = useApi('/api/admin/sessions/{id}/ra-event', { params: { path: { id: session.id } }, version: session })
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [error, setError] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)

  // Saves the event as the session's, with the rest of the session as it was loaded, since the API replaces it whole.
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const typed = link.trim()
    // Its number, or a link to it, with or without its https://.
    const id = raEventId(typed) ?? raEventId(`https://${typed}`)
    if (!id) return setLinkError(typed ? "Ce n'est pas le lien d'un événement RA, p. ex. https://ra.co/events/6683745." : "Collez le lien de l'événement RA.")
    setLinkError(null)
    const { fields } = checkSession({ ...sessionFormValues(session), raEvent: { id, url: raEventUrl(id) } })
    // The session's own fields, as the server gave them, always pass.
    if (!fields) return setError("L'événement RA n'a pas pu être enregistré.")
    setBusy(true)
    setError(null)
    const result = await api.PUT('/api/admin/sessions/{id}', { params: { path: { id: session.id } }, body: { session: fields }, bodySerializer: formData })
    setBusy(false)
    if (!result.ok) return setError(failure("L'événement RA n'a pas pu être enregistré", result, session.id))
    onSaved(result.session)
  }

  return (
    <div className="admin-ra-panel">
      <p>
        Créez l'événement{' '}
        <a href={RA_CREATE_EVENT} target="_blank" rel="noreferrer">
          sur RA
        </a>{' '}
        avec ces champs, puis collez son lien ci-dessous.
      </p>
      {loaded.kind === 'error' && (
        <p className="admin-error" role="alert">
          Le contenu de l'événement RA n'a pas pu être chargé&nbsp;: {loaded.message}
        </p>
      )}
      {loaded.kind === 'loaded' && <RaEventRecord session={session} event={loaded.value.event} />}
      <form className="admin-form" onSubmit={save} noValidate>
        <Labeled label="Lien de l'événement RA" error={linkError}>
          <input type="url" value={link} placeholder="https://ra.co/events/…" onChange={(change) => setLink(change.target.value)} />
        </Labeled>
        <FormActions error={error} busy={busy} submitLabel="enregistrer" onCancel={onCancel} />
      </form>
    </div>
  )
}
