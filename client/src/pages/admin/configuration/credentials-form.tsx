import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

// A form that replaces the credentials the server reads a service with, e.g. the SoundCloud app's, in the configuration
// section: one that's shown, e.g. a client ID, filled in with the one that's saved, and a secret, which is never sent back,
// so it has to be typed to replace them. They're verified with the service first, and can only be saved once they've
// been (see docs/design/client/admin/configuration.md).

// How long each credential can be. The server's schema says so too (see `Credential` in server/src/api/schemas.ts), and
// decides.
const CREDENTIAL_MAX_LENGTH = 200

// What the secret field shows once a secret is saved, since the secret itself is never sent back.
const SAVED_SECRET = '•'.repeat(32)

// The credentials as typed: the one that's shown, and the secret.
export type TypedCredentials = { id: string; secret: string }

type Outcome<Value> = ({ ok: true } & Value) | { ok: false; error: string }

type Props<Saved> = {
  // The credentials that are saved, as the server describes them, or null until they're entered.
  saved: Saved | null
  // The one that's shown, of those that are saved, which the form starts with.
  savedId: string
  // The fields' labels, e.g. "Client ID" and "Client secret".
  labels: { id: string; secret: string }
  // The service, e.g. "SoundCloud", which the check mark of verified credentials names.
  service: string
  // Asks the server whether the service accepts the credentials, without saving them.
  check: (typed: TypedCredentials) => Promise<Outcome<unknown>>
  // Saves them, giving what's saved.
  save: (typed: TypedCredentials) => Promise<Outcome<{ credentials: Saved | null }>>
  // What's said of the credentials that are saved, e.g. who changed them, or of there being none.
  status: (saved: Saved | null) => ReactNode
  // What the credentials are and where they're found.
  children: ReactNode
}

export function CredentialsForm<Saved>({ saved: loaded, savedId, labels, service, check, save, status, children }: Props<Saved>) {
  const [saved, setSaved] = useState(loaded)
  const [id, setId] = useState(savedId)
  const [secret, setSecret] = useState('')
  // The credentials the service accepted the last time they were verified.
  const [verified, setVerified] = useState<TypedCredentials | null>(null)
  const [busy, setBusy] = useState(false)
  // Whether the credentials were just saved, or why they couldn't be verified or saved, until they're changed again.
  const [outcome, setOutcome] = useState<Outcome<object> | null>(null)

  const typed = { id, secret }
  const isVerified = verified?.id === id && verified.secret === secret
  const complete = id.trim() !== '' && secret.trim() !== ''

  const change = (update: () => void) => {
    update()
    setOutcome(null)
  }

  const verify = async () => {
    setBusy(true)
    const result = await check(typed)
    setBusy(false)
    if (result.ok) setVerified(typed)
    else setOutcome({ ok: false, error: `Les identifiants n'ont pas pu être vérifiés : ${result.error}` })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!isVerified) return
    setBusy(true)
    const result = await save(typed)
    setBusy(false)
    if (result.ok) {
      setSaved(result.credentials)
      setSecret('')
      setOutcome({ ok: true })
    } else {
      setOutcome({ ok: false, error: `Les identifiants n'ont pas pu être enregistrés : ${result.error}` })
    }
  }

  return (
    <>
      {children}
      {status(saved)}
      <form className="admin-form" onSubmit={submit}>
        <label>
          {labels.id}
          <input
            value={id}
            maxLength={CREDENTIAL_MAX_LENGTH}
            autoComplete="off"
            onChange={(event) => change(() => setId(event.target.value))}
            required
          />
        </label>
        <label>
          {labels.secret}
          <input
            type="password"
            className="admin-secret"
            value={secret}
            placeholder={saved ? SAVED_SECRET : undefined}
            maxLength={CREDENTIAL_MAX_LENGTH}
            autoComplete="off"
            onChange={(event) => change(() => setSecret(event.target.value))}
            required
          />
        </label>
        <div className="admin-row">
          <button type="button" onClick={verify} disabled={busy || !complete || isVerified}>
            vérifier
          </button>
          {isVerified && (
            <span className="admin-saved" role="status" aria-label={`Identifiants acceptés par ${service}`}>
              ✓
            </span>
          )}
          <button type="submit" disabled={busy || !isVerified}>
            enregistrer
          </button>
          {outcome?.ok === true && (
            <span className="admin-saved" role="status" aria-label="Identifiants enregistrés">
              ✓
            </span>
          )}
        </div>
      </form>
      {outcome?.ok === false && (
        <p className="admin-error" role="alert">
          {outcome.error}
        </p>
      )}
    </>
  )
}
