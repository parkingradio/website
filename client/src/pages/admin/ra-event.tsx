import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import { useEnvironment, useEnvironmentStamp } from '../../config-context'
import type { Session } from '../../session-fields'
import { raEventId, raEventUrl } from '../../session-links'
import { Button } from './button'
import { MISSING, sessionWhen } from './describe'
import { FormActions, Labeled } from './fields'
import { failure } from './session-errors'

// Creating a session's event on Resident Advisor from its page: publishing it with the bookmarklet (see
// docs/design/client/admin/publier-sur-ra.md), or by hand, from the content of the event, as the server gives it, with a
// button to copy each of its texts, then the field its link is pasted in (see "Creating its event on RA" in
// docs/design/client/admin/sessions.md).

const RA_CREATE_EVENT = 'https://ra.co/pro/event/create'

type RaEventContent = Schema<'RaEventContent'>

// RA's form to create an event, with the event in its fragment, which never reaches RA's server, for the bookmarklet to
// read, along with the site, its environment and the session it comes from, so that it can warn outside production and
// lead back to the session.
function publishUrl(session: Session, event: RaEventContent, environment: string): string {
  const sent = { site: window.location.origin, environment, session: session.id, event }
  return `${RA_CREATE_EVENT}#parking-radio=${encodeURIComponent(JSON.stringify(sent))}`
}

// Why the session's event can't be published on RA, if it can't. The panel only opens while it has none.
function whyNotPublished(session: Session): string | null {
  if (session.start === null) return "La session n'a pas de date."
  if (session.status === 'cancelled') return 'La session est annulée.'
  return null
}

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

// The panel that opens under the session's "Événement RA" while it has none: « Publier sur RA », the content of its
// event, as the server gives it, to create it on RA by hand, and the field its link is pasted in, which saves it as the
// session's event. `created` is the event the bookmarklet just created, which fills the field in.
export function RaEventPanel({
  session,
  created,
  onSaved,
  onCancel,
}: {
  session: Session
  created: string | null
  onSaved: (session: Session) => void
  onCancel: () => void
}) {
  // Again whenever the session changes, its sets included, since the event's content follows them.
  const loaded = useApi('/api/admin/sessions/{id}/ra-event', { params: { path: { id: session.id } }, version: session })
  const environment = useEnvironment()
  // Outside production, the event is created on RA all the same.
  const stamp = useEnvironmentStamp()
  const [link, setLink] = useState(created ? raEventUrl(created) : '')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [error, setError] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)

  // Saves the event as the session's, and only it: the session's other fields stay as they are, even if they changed since
  // the page loaded it.
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const typed = link.trim()
    // Its number, or a link to it, with or without its https://.
    const id = raEventId(typed) ?? raEventId(`https://${typed}`)
    if (!id) return setLinkError(typed ? "Ce n'est pas le lien d'un événement RA, p. ex. https://ra.co/events/6683745." : "Collez le lien de l'événement RA.")
    setLinkError(null)
    setBusy(true)
    setError(null)
    const result = await api.PATCH('/api/admin/sessions/{id}', { params: { path: { id: session.id } }, body: { raEvent: id } })
    setBusy(false)
    if (!result.ok) return setError(failure("L'événement RA n'a pas pu être enregistré", result, session.id))
    onSaved(result.session)
  }

  return (
    <div className="admin-ra-panel">
      {created && (
        <p className="admin-notice" role="status">
          L'événement RA n°&nbsp;{created} vient d'être créé sur RA&nbsp;: enregistrez-le dans la session.
        </p>
      )}
      <div className="admin-toolbar">
        <Button
          unavailable={whyNotPublished(session)}
          disabled={loaded.kind !== 'loaded' || environment === undefined}
          onClick={() => loaded.kind === 'loaded' && environment && window.open(publishUrl(session, loaded.value.event, environment), '_blank', 'noopener')}
        >
          Publier sur RA
        </Button>
      </div>
      {stamp && (
        <p className="admin-error">
          Attention&nbsp;: l'événement sera vraiment créé sur RA, à partir d'une session de {stamp}.
        </p>
      )}
      <p>
        «&nbsp;Publier sur RA&nbsp;» ouvre RA, où le favori «&nbsp;Parking Radio → RA&nbsp;» (voir{' '}
        <Link to="/admin/configuration">Configuration</Link>) crée l'événement. Ou créez-le{' '}
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
