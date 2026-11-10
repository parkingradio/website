import { useEffect, useState } from 'react'
import type { Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Session } from '../../session-fields'
import { MISSING, sessionWhen } from './describe'

// The section of a session's page that shows the content of its event on Resident Advisor, as the server gives it, with
// a button to copy each of its texts, to create the event by hand on RA (see "Événement sur RA" in
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

export function RaEventSection({ session }: { session: Session }) {
  // Again whenever the session changes, its sets included, since the event's content follows them.
  const loaded = useApi('/api/admin/sessions/{id}/ra-event', { params: { path: { id: session.id } }, version: session })

  return (
    <>
      <h2>Événement sur RA</h2>
      <p>
        Pour créer l'événement de la session à la main,{' '}
        <a href={RA_CREATE_EVENT} target="_blank" rel="noreferrer">
          créez un événement sur RA
        </a>{' '}
        avec ces champs, puis ajoutez son lien à la session dans «&nbsp;Événement RA&nbsp;», avec «&nbsp;modifier&nbsp;».
      </p>
      {loaded.kind === 'error' && (
        <p className="admin-error" role="alert">
          Le contenu de l'événement RA n'a pas pu être chargé&nbsp;: {loaded.message}
        </p>
      )}
      {loaded.kind === 'loaded' && <RaEventRecord session={session} event={loaded.value.event} />}
    </>
  )
}
