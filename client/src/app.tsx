import { Route, Routes } from 'react-router'
import { ConfigProvider } from './config'
import { Layout } from './layout'
import { Home } from './pages/home'
import { Archive } from './pages/archive'
import { Programmation } from './pages/programmation'
import { SynthMeetups } from './pages/synth-meetups'
import { Appliquer } from './pages/appliquer'
import { Contribuer } from './pages/contribuer'
import { Login } from './pages/login'
import { AcceptInvite } from './pages/accept-invite'
import { Admin } from './pages/admin'

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
          <Route path="login" element={<Login />} />
          <Route path="accept-invite" element={<AcceptInvite />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
    </ConfigProvider>
  )
}

export default App
