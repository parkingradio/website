import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { api } from '../../api/client'
import { Login } from './login'

type Session = { status: 'checking' } | { status: 'logged-out' } | { status: 'logged-in'; email: string }

// Every admin page goes through here: logged out, it shows the login form in place of the page, so
// that logging in leads straight to the page that was asked for.
export function AdminLayout() {
  const [session, setSession] = useState<Session>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false
    api.GET('/api/admin/me').then((result) => {
      if (!cancelled) setSession(result.ok ? { status: 'logged-in', email: result.email } : { status: 'logged-out' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Still logged in if the server couldn't be asked to clear the session's cookie.
  const logout = async () => {
    if ((await api.POST('/api/auth/logout')).ok) setSession({ status: 'logged-out' })
  }

  if (session.status === 'checking') return null
  if (session.status === 'logged-out') return <Login onLogin={(email) => setSession({ status: 'logged-in', email })} />

  return (
    <div className="admin-inner">
      <nav className="admin-nav" aria-label="admin">
        <div className="admin-links">
          <NavLink to="/admin/calendrier">calendrier</NavLink>
          <NavLink to="/admin/rotation">rotation radio</NavLink>
          <NavLink to="/admin/candidatures">candidatures</NavLink>
          <NavLink to="/admin/artistes">artistes</NavLink>
          <NavLink to="/admin/admins">admins</NavLink>
          <NavLink to="/admin/configuration">configuration</NavLink>
        </div>
        <div className="admin-session">
          <span>{session.email}</span>
          <button type="button" onClick={logout}>
            se déconnecter
          </button>
        </div>
      </nav>
      {/* The section is a fragment of headings and content: this keeps it in the grid's second column. */}
      <div>
        <Outlet />
      </div>
    </div>
  )
}
