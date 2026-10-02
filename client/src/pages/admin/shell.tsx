import { Outlet } from 'react-router'
import './admin.css'

// Around the admin pages, and the page to accept an invite that leads to them.
export function AdminShell() {
  return (
    <div className="admin">
      <Outlet />
    </div>
  )
}
