import { Outlet } from 'react-router'
import './admin.css'

// Around the admin pages, the page to accept an invite that leads to them, and the page where admins allow apps
// (/autoriser).
export function AdminShell() {
  return (
    <div className="admin">
      <Outlet />
    </div>
  )
}
