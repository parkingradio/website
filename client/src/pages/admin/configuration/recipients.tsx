import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../../api/client'
import type { Schema } from '../../../api/client'
import { useApi } from '../../../api/use-api'
import { EMAIL_MAX_LENGTH, isEmailAddress } from '../../../artist-profile'
import { byWhom } from '../describe'
import { FieldError } from '../fields'

// Who the applications artists send are emailed to, in the configuration section.

// The most the server takes (see server/src/applications/routes.ts), which must be changed together with it.
const MAX_RECIPIENTS = 10

export function Recipients() {
  const loaded = useApi('/api/admin/applications/recipients')

  if (loaded.kind === 'loading') return null
  if (loaded.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les destinataires n'ont pas pu être chargés&nbsp;: {loaded.message}
      </p>
    )
  }
  return <RecipientsForm loaded={loaded.value} />
}

// The recipients, as they're saved: each address is typed, then added with + (or Enter), or removed with its ×, which
// saves the recipients right away.
function RecipientsForm({ loaded }: { loaded: Schema<'ApplicationRecipients'> }) {
  const [saved, setSaved] = useState(loaded)
  // The address being typed, and what's wrong with it.
  const [entry, setEntry] = useState('')
  const [entryError, setEntryError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Why the recipients couldn't be saved, if they couldn't.
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const full = saved.recipients.length >= MAX_RECIPIENTS

  // Returns whether the recipients were saved.
  const save = async (recipients: string[]) => {
    setBusy(true)
    const result = await api.PUT('/api/admin/applications/recipients', { body: { recipients } })
    setBusy(false)
    setError(result.ok ? null : result.error)
    if (result.ok) setSaved(result)
    // The button that was used is disabled while saving, or gone with its address, so the focus would be lost.
    input.current?.focus()
    return result.ok
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    const address = entry.trim()
    if (!address) return
    if (!isEmailAddress(address)) {
      setEntryError('Adresse e-mail invalide.')
      return
    }
    if (saved.recipients.some((other) => other.toLowerCase() === address.toLowerCase())) {
      setEntry('')
      setError(null)
      return
    }
    // The address stays typed if it couldn't be saved, so that it can be added again. Whatever was typed while it was
    // being saved stays too.
    if (await save([...saved.recipients, address])) setEntry((current) => (current === entry ? '' : current))
  }

  return (
    <>
      <p>
        Les candidatures que les artistes envoient sont transmises par e-mail à ces adresses, avec l'artiste en reply-to.
        L'artiste reçoit aussi une confirmation avec ces adresses en reply-to.
      </p>
      {saved.recipients.length === 0 && (
        <p className="admin-placeholder">Aucun destinataire&nbsp;: les candidatures ne sont envoyées à personne, mais restent listées dans la section candidatures.</p>
      )}
      {saved.updatedBy && <p className="admin-meta">{byWhom('Changé', saved.updatedBy, saved.updatedAt)}</p>}
      <form className="admin-form" onSubmit={add} noValidate>
        <fieldset>
          <legend>Destinataires</legend>
          {saved.recipients.length > 0 && (
            <ul className="admin-chosen">
              {saved.recipients.map((recipient) => (
                <li key={recipient}>
                  {recipient}
                  <button
                    type="button"
                    aria-label={`retirer ${recipient}`}
                    disabled={busy}
                    onClick={() => save(saved.recipients.filter((other) => other !== recipient))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="admin-row">
            <input
              type="email"
              ref={input}
              aria-label="Adresse e-mail d'un destinataire"
              aria-invalid={entryError ? true : undefined}
              value={entry}
              maxLength={EMAIL_MAX_LENGTH}
              onChange={(event) => {
                setEntry(event.target.value)
                setEntryError(null)
              }}
            />
            <button type="submit" aria-label="ajouter ce destinataire" disabled={busy || full}>
              +
            </button>
          </div>
          <FieldError message={entryError} />
          <p className="admin-hint">Jusqu'à {MAX_RECIPIENTS} adresses.</p>
        </fieldset>
      </form>
      {error && (
        <p className="admin-error" role="alert">
          Les destinataires n'ont pas pu être enregistrés&nbsp;: {error}
        </p>
      )}
    </>
  )
}
