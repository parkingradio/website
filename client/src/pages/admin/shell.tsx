import { Suspense, lazy } from 'react'
import { Outlet } from 'react-router'
import './shell.css'

// Around the admin pages, the page to accept an invite that leads to them, and the page where admins allow apps
// (/autoriser). It's loaded with the public pages, and shows nothing while the others load (see AdminPage), under the
// navigation bar and above the player, which keeps playing.
export function AdminShell() {
  return (
    <div className="admin">
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </div>
  )
}

// The pages behind AdminShell, loaded on demand, all at once, so that the public pages don't load them (see
// docs/design/client/admin/layout.md). It's one component for every page, rather than one each, since React waits for a
// component that's loaded on demand the first time it's shown, even once its module is there, which would hide the
// admin menu for a moment at each new page. The error is logged, since it can come from their own code, not only the
// network.
export const AdminPage = lazy(() =>
  import('./admin-pages').catch((error: unknown) => {
    console.error(error)
    return { default: AdminLoadFailure }
  }),
)

// In place of every page behind AdminShell, when they couldn't be loaded, e.g. because the network is down.
function AdminLoadFailure() {
  return (
    <div className="admin-auth">
      <p className="admin-error" role="alert">
        La page n'a pas pu être chargée. Rechargez la page pour réessayer.
      </p>
    </div>
  )
}
