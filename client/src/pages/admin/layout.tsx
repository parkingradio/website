import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import type { MeResponse } from 'shared/auth'
import { Login } from './login'

type Session = { status: 'checking' } | { status: 'logged-out' } | { status: 'logged-in'; email: string }

// Every admin page goes through here: logged out, it shows the login form in place of the page, so
// that logging in leads straight to the page that was asked for.
export function AdminLayout() {
  const [session, setSession] = useState<Session>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/me')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: MeResponse) => {
        if (!cancelled) setSession({ status: 'logged-in', email: body.email })
      })
      .catch(() => {
        if (!cancelled) setSession({ status: 'logged-out' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSession({ status: 'logged-out' })
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
