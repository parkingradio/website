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
import { AutoriserTermine } from './pages/autoriser-termine'
import { AdminPage, AdminShell } from './pages/admin/shell'

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
          {/* Where apps send admins once they're done connecting. It loads with the public pages, needing nothing of the admin ones. */}
          <Route path="autoriser/termine" element={<AutoriserTermine />} />
          <Route element={<AdminShell />}>
            <Route path="accept-invite" element={<AdminPage page="AcceptInvite" />} />
            {/* Where apps, e.g. Claude, send admins to allow them. */}
            <Route path="autoriser" element={<AdminPage page="Autoriser" />} />
            <Route path="admin" element={<AdminPage page="AdminLayout" />}>
              <Route index element={<Navigate to="/admin/calendrier" replace />} />
              <Route path="admins" element={<AdminPage page="Admins" />} />
              <Route path="calendrier" element={<AdminPage page="Calendrier" />} />
              <Route path="rotation" element={<AdminPage page="Rotation" />} />
              <Route path="rotation-legacy" element={<AdminPage page="RotationLegacy" />} />
              <Route path="candidatures" element={<AdminPage page="ApplicationsPage" />} />
              <Route path="candidatures/nouvelle" element={<AdminPage page="NewApplicationPage" />} />
              <Route path="candidatures/:id" element={<AdminPage page="ApplicationPage" />} />
              <Route path="sessions" element={<AdminPage page="SessionsPage" />} />
              <Route path="sessions/nouvelle" element={<AdminPage page="NewSessionPage" />} />
              <Route path="sessions/:id" element={<AdminPage page="SessionPage" />} />
              <Route path="artistes" element={<AdminPage page="ArtistsPage" />} />
              <Route path="artistes/nouveau" element={<AdminPage page="NewArtistPage" />} />
              <Route path="artistes/:id" element={<AdminPage page="ArtistPage" />} />
              {/* Collectives are listed with the artists. This keeps the address of their pages from being an artist's. */}
              <Route path="artistes/collectifs" element={<Navigate to="/admin/artistes" replace />} />
              <Route path="artistes/collectifs/nouveau" element={<AdminPage page="NewCollectivePage" />} />
              <Route path="artistes/collectifs/:id" element={<AdminPage page="CollectivePage" />} />
              <Route path="integrations" element={<AdminPage page="Integrations" />} />
              <Route path="configuration" element={<AdminPage page="Configuration" />} />
              {/* The feature flags moved to the configuration section. This keeps older links working. */}
              <Route path="features" element={<Navigate to="/admin/configuration" replace />} />
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
