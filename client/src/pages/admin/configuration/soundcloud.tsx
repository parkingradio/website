import { useState } from 'react'
import type { FormEvent } from 'react'
import { SOUNDCLOUD_CREDENTIAL_MAX_LENGTH } from 'shared/radio'
import type { RadioCredentialsCheckResponse, RadioCredentialsRequest, RadioCredentialsResponse } from 'shared/radio'
import { postJson, putJson } from '../../../api'
import { byWhom } from '../describe'
import { useApi } from '../../../use-api'

// The credentials of the SoundCloud app the radio reads playlists through, in the configuration section.

const CREDENTIALS_URL = '/api/admin/radio/credentials'

// What the secret field shows once a secret is saved, since the secret itself is never sent back.
const SAVED_SECRET = '•'.repeat(32)

export function SoundCloudCredentials() {
  const loaded = useApi<RadioCredentialsResponse>(CREDENTIALS_URL)

  if (loaded.kind === 'loading') return null
  if (loaded.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        Les identifiants SoundCloud n'ont pas pu être chargés&nbsp;: {loaded.message}
      </p>
    )
  }
  return <CredentialsForm loaded={loaded.value} />
}

// Who last changed the credentials, and a form that replaces them, filled in with the client ID that's saved. Since the
// secret is never shown again, it has to be typed to replace them. They're verified with SoundCloud first, and can only
// be saved once they've been.
function CredentialsForm({ loaded }: { loaded: RadioCredentialsResponse }) {
  const [saved, setSaved] = useState(loaded.credentials)
  const [clientId, setClientId] = useState(loaded.credentials?.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  // The credentials SoundCloud accepted the last time they were verified.
  const [verified, setVerified] = useState<RadioCredentialsRequest | null>(null)
  const [busy, setBusy] = useState(false)
  // Whether the credentials were just saved, or why they couldn't be verified or saved, until they're changed again.
  const [outcome, setOutcome] = useState<{ ok: true } | { ok: false; error: string } | null>(null)

  const typed = { clientId, clientSecret }
  const isVerified = verified?.clientId === clientId && verified.clientSecret === clientSecret
  const complete = clientId.trim() !== '' && clientSecret.trim() !== ''

  const change = (update: () => void) => {
    update()
    setOutcome(null)
  }

  const verify = async () => {
    setBusy(true)
    const result = await postJson<RadioCredentialsRequest, RadioCredentialsCheckResponse>(`${CREDENTIALS_URL}/check`, typed)
    setBusy(false)
    if (result.ok) setVerified(typed)
    else setOutcome({ ok: false, error: `Les identifiants n'ont pas pu être vérifiés : ${result.error}` })
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!isVerified) return
    setBusy(true)
    const result = await putJson<RadioCredentialsRequest, RadioCredentialsResponse>(CREDENTIALS_URL, typed)
    setBusy(false)
    if (result.ok) {
      setSaved(result.credentials)
      setClientSecret('')
      setOutcome({ ok: true })
    } else {
      setOutcome({ ok: false, error: `Les identifiants n'ont pas pu être enregistrés : ${result.error}` })
    }
  }

  return (
    <>
      <p>
        La radio lit sa playlist sur SoundCloud à travers une application SoundCloud, avec ses identifiants. Ils se trouvent
        dans les{' '}
        <a href="https://soundcloud.com/you/apps" target="_blank" rel="noreferrer">
          applications
        </a>{' '}
        du compte SoundCloud qui la possède.
      </p>
      {saved ? (
        <p className="admin-meta">{byWhom('Changés', saved.updatedBy, saved.updatedAt)}</p>
      ) : (
        <p className="admin-placeholder">Aucun identifiant&nbsp;: la radio ne peut lire aucune playlist, elle est hors ondes.</p>
      )}
      <form className="admin-form" onSubmit={save}>
        <label>
          Client ID
          <input
            value={clientId}
            maxLength={SOUNDCLOUD_CREDENTIAL_MAX_LENGTH}
            autoComplete="off"
            onChange={(event) => change(() => setClientId(event.target.value))}
            required
          />
        </label>
        <label>
          Client secret
          <input
            type="password"
            className="admin-secret"
            value={clientSecret}
            placeholder={saved ? SAVED_SECRET : undefined}
            maxLength={SOUNDCLOUD_CREDENTIAL_MAX_LENGTH}
            autoComplete="off"
            onChange={(event) => change(() => setClientSecret(event.target.value))}
            required
          />
        </label>
        <div className="admin-row">
          <button type="button" onClick={verify} disabled={busy || !complete || isVerified}>
            vérifier
          </button>
          {isVerified && (
            <span className="admin-saved" role="status" aria-label="Identifiants acceptés par SoundCloud">
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
