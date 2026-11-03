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
import { Autoriser } from './pages/admin/autoriser'
import { AdminLayout } from './pages/admin/layout'
import { Admins } from './pages/admin/admins'
import { Calendrier } from './pages/admin/calendrier'
import { Rotation } from './pages/admin/rotation'
import { ApplicationPage, ApplicationsPage, NewApplicationPage } from './pages/admin/applications'
import { ArtistPage, ArtistsPage, NewArtistPage } from './pages/admin/artists'
import { CollectivePage, NewCollectivePage } from './pages/admin/collectives'
import { NewSessionPage, SessionPage, SessionsPage } from './pages/admin/sessions'
import { Configuration } from './pages/admin/configuration'

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
            {/* Where apps, e.g. Claude, send admins to allow them. */}
            <Route path="autoriser" element={<Autoriser />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/calendrier" replace />} />
              <Route path="admins" element={<Admins />} />
              <Route path="calendrier" element={<Calendrier />} />
              <Route path="rotation" element={<Rotation />} />
              <Route path="candidatures" element={<ApplicationsPage />} />
              <Route path="candidatures/nouvelle" element={<NewApplicationPage />} />
              <Route path="candidatures/:id" element={<ApplicationPage />} />
              <Route path="sessions" element={<SessionsPage />} />
              <Route path="sessions/nouvelle" element={<NewSessionPage />} />
              <Route path="sessions/:id" element={<SessionPage />} />
              <Route path="artistes" element={<ArtistsPage />} />
              <Route path="artistes/nouveau" element={<NewArtistPage />} />
              <Route path="artistes/:id" element={<ArtistPage />} />
              {/* Collectives are listed with the artists. This keeps the address of their pages from being an artist's. */}
              <Route path="artistes/collectifs" element={<Navigate to="/admin/artistes" replace />} />
              <Route path="artistes/collectifs/nouveau" element={<NewCollectivePage />} />
              <Route path="artistes/collectifs/:id" element={<CollectivePage />} />
              <Route path="configuration" element={<Configuration />} />
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
