import { Route, Routes } from 'react-router'
import { Layout } from './layout'
import { Home } from './pages/home'
import { Archive } from './pages/archive'
import { Programmation } from './pages/programmation'
import { SynthMeetups } from './pages/synth-meetups'
import { Appliquer } from './pages/appliquer'
import { Contribuer } from './pages/contribuer'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="archives" element={<Archive />} />
        <Route path="programmation" element={<Programmation />} />
        <Route path="synth-meetups" element={<SynthMeetups />} />
        <Route path="appliquer" element={<Appliquer />} />
        <Route path="contribuer" element={<Contribuer />} />
      </Route>
    </Routes>
  )
}

export default App
