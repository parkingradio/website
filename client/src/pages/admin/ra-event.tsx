import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { useEnvironmentStamp } from '../../config-context'
import type { Session } from '../../session-fields'
import { raEventId, raEventUrl } from '../../session-links'
import { Button } from './button'
import { FormActions, Labeled } from './fields'
import { failure } from './session-errors'

// Creating a session's event on Resident Advisor from its page: publishing it with the bookmarklet (see
// docs/design/client/admin/publier-sur-ra.md), or by hand, then the field its link is pasted in (see "Creating its event
// on RA" in docs/design/client/admin/sessions.md).

const RA_CREATE_EVENT = 'https://ra.co/pro/event/create'

// Why the session's event can't be published on RA, if it can't. The panel only opens while it has none.
function whyNotPublished(session: Session): string | null {
  if (session.start === null) return "La session n'a pas de date."
  if (session.status === 'cancelled') return 'La session est annulée.'
  return null
}

// The panel that opens under the session's "Événement RA" while it has none: « Publier sur RA », and the field the
// event's link is pasted in, which saves it as the session's event. `created` is the event the bookmarklet just created,
// which fills the field in.
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
  // Outside production, the event is created on RA all the same.
  const stamp = useEnvironmentStamp()
  const [link, setLink] = useState(created ? raEventUrl(created) : '')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [error, setError] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<ReactNode>(null)

  // Opens RA's form to create an event, in a new tab, with a token for the session in its fragment, which never reaches
  // RA's server, for the bookmarklet. Browsers only let a page open a tab right when it's clicked, so the tab is opened
  // first, then sent to RA's form once the server gave the token.
  const publish = async () => {
    setPublishError(null)
    const tab = window.open('', '_blank')
    if (!tab) return setPublishError("RA n'a pas pu s'ouvrir dans un nouvel onglet.")
    // RA's page mustn't reach this one.
    tab.opener = null
    setPublishing(true)
    const result = await api.POST('/api/admin/sessions/{id}/ra-publication', { params: { path: { id: session.id } } })
    setPublishing(false)
    // The admin closed it in the meantime.
    if (tab.closed) return
    if (!result.ok) {
      tab.close()
      return setPublishError(failure("La publication sur RA n'a pas pu être préparée", result, session.id))
    }
    tab.location.replace(`${RA_CREATE_EVENT}#parking-radio=${result.token}`)
  }

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
        <Button unavailable={whyNotPublished(session)} disabled={publishing} onClick={publish}>
          Publier sur RA
        </Button>
      </div>
      {publishError && (
        <p className="admin-error" role="alert">
          {publishError}
        </p>
      )}
      {stamp && (
        <p className="admin-error">
          Attention&nbsp;: l'événement sera vraiment créé sur RA, à partir d'une session de {stamp}.
        </p>
      )}
      <p>
        «&nbsp;Publier sur RA&nbsp;» ouvre RA, où le favori «&nbsp;Parking Radio → RA&nbsp;» (voir{' '}
        <Link to="/admin/integrations">Intégrations</Link>) crée l'événement. S'il ne fonctionne pas, créez-le{' '}
        <a href={RA_CREATE_EVENT} target="_blank" rel="noreferrer">
          sur RA
        </a>{' '}
        à la main d'après la page de la session, puis collez son lien ci-dessous.
      </p>
      <form className="admin-form" onSubmit={save} noValidate>
        <Labeled label="Lien de l'événement RA" error={linkError}>
          <input type="url" value={link} placeholder="https://ra.co/events/…" onChange={(change) => setLink(change.target.value)} />
        </Labeled>
        <FormActions error={error} busy={busy} submitLabel="enregistrer" onCancel={onCancel} />
      </form>
    </div>
  )
}
