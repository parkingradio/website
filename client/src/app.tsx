import { Navigate, Route, Routes } from 'react-router'
import { ConfigProvider } from './config'
import { Layout } from './layout'
import { Home } from './pages/home'
import { Archive } from './pages/archive'
import { Programmation } from './pages/programmation'
import { SynthMeetups } from './pages/synth-meetups'
import { Appliquer } from './pages/appliquer'
import { Contribuer } from './pages/contribuer'
import { NotFound } from './pages/not-found'
import { AdminShell } from './pages/admin/shell'
import { AcceptInvite } from './pages/admin/accept-invite'
import { AdminLayout } from './pages/admin/layout'
import { Admins } from './pages/admin/admins'
import { Calendrier } from './pages/admin/calendrier'
import { Rotation } from './pages/admin/rotation'
import { Candidatures } from './pages/admin/candidatures'

function App() {
  return (
    <ConfigProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="archives" element={<Archive />} />
          <Route path="programmation" element={<Programmation />} />
          <Route path="synth-meetups" element={<SynthMeetups />} />
          <Route path="appliquer" element={<Appliquer />} />
          <Route path="contribuer" element={<Contribuer />} />
          {/* Logging in happens on the admin pages themselves. This keeps older links working. */}
          <Route path="login" element={<Navigate to="/admin" replace />} />
          <Route element={<AdminShell />}>
            <Route path="accept-invite" element={<AcceptInvite />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/admins" replace />} />
              <Route path="admins" element={<Admins />} />
              <Route path="calendrier" element={<Calendrier />} />
              <Route path="rotation" element={<Rotation />} />
              <Route path="candidatures" element={<Candidatures />} />
            </Route>
          </Route>
          {/* Also catches unknown paths under /admin, which are shown like any other unknown URL. */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ConfigProvider>
  )
}

export default App
