import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { api, onSessionEnded } from '../../api/client'
import { Login } from './login'

type Session =
  | { status: 'checking' }
  // `ended` when the session ended while the pages were open, rather than when logging out.
  | { status: 'logged-out'; ended?: boolean }
  | { status: 'logged-in'; email: string; logoutError?: string }
  // When it can't be known whether there's a session.
  | { status: 'error'; message: string }

// Every admin page goes through here: logged out, it shows the login form in place of the page, so
// that logging in leads straight to the page that was asked for. That's also the case when the session
// ends while a page is open: the page goes away, and logging in shows it again, loaded anew.
export function AdminLayout() {
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

  // Still logged in if the server couldn't be asked to clear the session's cookie. Once it was, logged out without saying
  // that the session ended, even if a request failed with 401 in the meantime, e.g. one that a section sent.
  const logout = async (email: string) => {
    setSession({ status: 'logged-in', email })
    const result = await api.POST('/api/auth/logout')
    if (result.ok) setSession({ status: 'logged-out' })
    else setSession((session) => (session.status === 'logged-in' ? { ...session, logoutError: result.error } : session))
  }

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
    const notice = session.ended ? 'La session a pris fin. Connectez-vous à nouveau pour continuer.' : undefined
    return <Login onLogin={(email) => setSession({ status: 'logged-in', email })} notice={notice} />
  }

  return (
    <div className="admin-inner">
      <nav className="admin-nav" aria-label="admin">
        <div className="admin-links">
          <NavLink to="/admin/calendrier">calendrier</NavLink>
          <NavLink to="/admin/rotation">rotation radio</NavLink>
          <NavLink to="/admin/candidatures">candidatures</NavLink>
          <NavLink to="/admin/sessions">sessions</NavLink>
          <NavLink to="/admin/artistes">artistes</NavLink>
          <NavLink to="/admin/admins">admins</NavLink>
          <NavLink to="/admin/configuration">configuration</NavLink>
        </div>
        <div className="admin-session">
          <span>{session.email}</span>
          <button type="button" onClick={() => logout(session.email)}>
            se déconnecter
          </button>
          {session.logoutError !== undefined && (
            <p className="admin-error" role="alert">
              La déconnexion a échoué&nbsp;: {session.logoutError}
            </p>
          )}
        </div>
      </nav>
      {/* The section is a fragment of headings and content: this keeps it in the grid's second column. */}
      <div>
        <Outlet />
      </div>
    </div>
  )
}
