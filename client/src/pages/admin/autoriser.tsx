import { Fragment, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { api } from '../../api/client'
import type { Schema } from '../../api/client'
import { browser } from '../../browser'
import { SCOPE_DESCRIPTIONS } from './describe'
import { RequireSession } from './session'

// The page where an admin allows an app, e.g. Claude, to act as them (see docs/design/client/admin/autoriser.md). Apps send
// the admin's browser here with their request in the address, and the page sends it back to them with the answer.

// The request's parameters, as they're in the page's address, with those that are there more than once as lists, which the
// server refuses.
function authorizationParams(search: string): Record<string, string | string[]> {
  const query = new URLSearchParams(search)
  return Object.fromEntries(
    [...new Set(query.keys())].map((name) => {
      const values = query.getAll(name)
      return [name, values.length === 1 ? values[0] : values]
    }),
  )
}

type AskedFor = { client: string; redirectHost: string; local: boolean; scopes: string[] }

type Step =
  | { kind: 'checking' }
  | { kind: 'asking'; asked: AskedFor; sending: boolean; error?: string }
  // When the browser can't be sent back to the app, e.g. for an app the site doesn't know, or the request couldn't be
  // checked, e.g. because the server can't be reached.
  | { kind: 'failed'; message: string }
  | { kind: 'leaving' }

// The server's error, with where to send the browser to tell the app, when it can be told.
type AuthorizationError = Partial<Schema<'AuthorizationError'>>

export function Autoriser() {
  return (
    <RequireSession notice="Connectez-vous pour autoriser l'application.">{(email) => <Consent email={email} />}</RequireSession>
  )
}

function Consent({ email }: { email: string }) {
  const { search } = useLocation()
  const [step, setStep] = useState<Step>({ kind: 'checking' })

  useEffect(() => {
    let cancelled = false
    // The client encodes the query's values, but not their names, which could otherwise make the server check other
    // parameters than those the page then sends, e.g. with a "#" in a name.
    const params = Object.entries(authorizationParams(search)).map(([name, value]) => [encodeURIComponent(name), value])
    api.GET('/api/admin/oauth/authorization', { params: { query: Object.fromEntries(params) } }).then((result) => {
      if (cancelled) return
      if (result.ok) return setStep({ kind: 'asking', asked: result, sending: false })
      const { redirect, unknownClient }: AuthorizationError = result
      if (redirect) {
        setStep({ kind: 'leaving' })
        return browser.go(redirect)
      }
      let message = `Ce lien n'est pas valide (${result.error}). Recommencez la connexion depuis l'application.`
      if (unknownClient) message = 'Seuls Claude et Claude Code peuvent se connecter à Parking Radio.'
      if (result.fromServer === false) {
        message = `La demande n'a pas pu être vérifiée\u00a0: ${result.error.replace(/\.$/, '')}. Rechargez la page pour réessayer.`
      }
      setStep({ kind: 'failed', message })
    })
    return () => {
      cancelled = true
    }
  }, [search])

  const answer = async (asked: AskedFor, allow: boolean) => {
    setStep({ kind: 'asking', asked, sending: true })
    const result = await api.POST('/api/admin/oauth/authorization', { body: { ...authorizationParams(search), allow } })
    // Where to send the browser, with the code or the refusal, or to tell the app what's wrong.
    const redirect = 'redirect' in result ? result.redirect : undefined
    if (redirect) {
      setStep({ kind: 'leaving' })
      return browser.go(redirect)
    }
    setStep({ kind: 'asking', asked, sending: false, error: result.ok ? undefined : result.error })
  }

  if (step.kind === 'checking') return null
  if (step.kind === 'leaving') {
    return (
      <div className="admin-auth">
        <p className="admin-notice" role="status">
          Retour vers l'application…
        </p>
      </div>
    )
  }
  if (step.kind === 'failed') {
    return (
      <div className="admin-auth">
        <h1>Autoriser une application</h1>
        <p className="admin-error" role="alert">
          {step.message}
        </p>
      </div>
    )
  }

  const { asked, sending, error } = step
  return (
    <div className="admin-auth">
      <h1>Autoriser {asked.client}</h1>
      <p>
        <strong>{asked.client}</strong> demande à agir en votre nom ({email}) sur Parking Radio.
      </p>
      {asked.scopes.map((scope) => {
        const description = SCOPE_DESCRIPTIONS[scope]
        if (!description) return <p key={scope}>{scope}</p>
        return (
          <Fragment key={scope}>
            <p>{description.text}</p>
            {description.except.length > 0 && (
              <ul>
                {description.except.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </Fragment>
        )
      })}
      <p>
        N'autorisez {asked.client} que si vous venez vous-même de lancer sa connexion. Si quelqu'un vous a envoyé ce lien,
        refusez.
      </p>
      <p>
        Ensuite, votre navigateur retournera vers{' '}
        {asked.local ? `votre ordinateur (${asked.redirectHost})` : asked.redirectHost}.
      </p>
      <div className="admin-actions">
        <button type="button" className="admin-primary" disabled={sending} onClick={() => answer(asked, true)}>
          autoriser
        </button>
        <button type="button" disabled={sending} onClick={() => answer(asked, false)}>
          refuser
        </button>
      </div>
      {error !== undefined && (
        <p className="admin-error" role="alert">
          La réponse n'a pas pu être envoyée&nbsp;: {error}
        </p>
      )}
    </div>
  )
}
