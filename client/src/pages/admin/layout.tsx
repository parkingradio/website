import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { api } from '../../api/client'
import { ConflictCountReporter, useConflictCount } from './conflict-count'
import { conflictCount } from './describe'
import { RequireSession } from './session'

// Every admin page goes through here: it requires a session (see RequireSession), and shows the menu next to the page.
export function AdminLayout() {
  return <RequireSession>{(email, loggedOut) => <AdminMenu email={email} loggedOut={loggedOut} />}</RequireSession>
}

function AdminMenu({ email, loggedOut }: { email: string; loggedOut: () => void }) {
  const [logoutError, setLogoutError] = useState<string>()
  const [conflicts, reportConflicts] = useConflictCount(useLocation().pathname)

  // Still logged in if the server couldn't be asked to clear the session's cookie. Once it was, logged out without saying
  // that the session ended, even if a request failed with 401 in the meantime, e.g. one that a section sent.
  const logout = async () => {
    setLogoutError(undefined)
    const result = await api.POST('/api/auth/logout')
    if (result.ok) loggedOut()
    else setLogoutError(result.error)
  }

  return (
    <div className="admin-inner">
      <nav className="admin-nav" aria-label="admin">
        <div className="admin-links">
          {/* While there are conflicts, it opens on them. */}
          <NavLink
            to={conflicts ? '/admin/calendrier?issues=open' : '/admin/calendrier'}
            aria-label={conflicts ? `calendrier, ${conflictCount(conflicts)}` : undefined}
          >
            calendrier
            {conflicts ? <span className="admin-badge">{conflicts}</span> : null}
          </NavLink>
          <NavLink to="/admin/candidatures">candidatures</NavLink>
          <NavLink to="/admin/sessions">sessions</NavLink>
          <NavLink to="/admin/artistes">artistes</NavLink>
          <NavLink to="/admin/rotation">rotation radio</NavLink>
          <NavLink to="/admin/integrations">intégrations</NavLink>
          <NavLink to="/admin/admins">admins</NavLink>
          <NavLink to="/admin/configuration">configuration</NavLink>
        </div>
        <div className="admin-session">
          <span>{email}</span>
          <button type="button" onClick={logout}>
            se déconnecter
          </button>
          {logoutError !== undefined && (
            <p className="admin-error" role="alert">
              La déconnexion a échoué&nbsp;: {logoutError}
            </p>
          )}
        </div>
      </nav>
      {/* The section is a fragment of headings and content: this keeps it in the grid's second column. */}
      <div>
        <ConflictCountReporter value={reportConflicts}>
          <Outlet />
        </ConflictCountReporter>
      </div>
    </div>
  )
}
