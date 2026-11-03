import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, onSessionEnded } from '../../api/client'
import { Login } from './login'

type Session =
  | { status: 'checking' }
  // `ended` when the session ended while the pages were open, rather than when logging out.
  | { status: 'logged-out'; ended?: boolean }
  | { status: 'logged-in'; email: string }
  // When it can't be known whether there's a session.
  | { status: 'error'; message: string }

// What requires a session goes through here, e.g. every admin page: logged out, it shows the login form in its place, so
// that logging in leads straight to what was asked for. That's also the case when the session ends while it's open: it
// goes away, and logging in shows it again, loaded anew. `children` gets the logged-in admin's email, and what to call once
// they logged out, which shows the login form without saying that the session ended. `notice` says why logging in is
// needed, e.g. to allow an app, unless the session ended.
export function RequireSession({ notice, children }: { notice?: string; children: (email: string, loggedOut: () => void) => ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false
    // Both this and the answer of /api/admin/me update the session from what it is by then, with a function, rather than
    // replace it: when /api/admin/me fails with 401, the listener is called before the answer, which then finds that the
    // session is logged out rather than still being checked, and leaves it so.
    const unsubscribe = onSessionEnded(() =>
      setSession((session) => {
        if (session.status === 'logged-in') return { status: 'logged-out', ended: true }
        if (session.status === 'checking') return { status: 'logged-out' }
        return session
      }),
    )
    api.GET('/api/admin/me').then((result) => {
      if (cancelled) return
      setSession((session) => {
        if (session.status !== 'checking') return session
        return result.ok ? { status: 'logged-in', email: result.email } : { status: 'error', message: result.error }
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (session.status === 'checking') return null
  if (session.status === 'error') {
    return (
      <div className="admin-auth">
        <p className="admin-error" role="alert">
          La session n'a pas pu être vérifiée&nbsp;: {session.message.replace(/\.$/, '')}. Rechargez la page pour réessayer.
        </p>
      </div>
    )
  }
  if (session.status === 'logged-out') {
    const why = session.ended ? 'La session a pris fin. Connectez-vous à nouveau pour continuer.' : notice
    return <Login onLogin={(email) => setSession({ status: 'logged-in', email })} notice={why} />
  }
  return children(session.email, () => setSession({ status: 'logged-out' }))
}
