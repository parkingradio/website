import { NavLink, Outlet } from 'react-router'
import './layout.css'

const MERCH_URL = 'https://parkingdotradio.bigcartel.com'

export function Layout() {
  return (
    <div className="layout">
      <nav className="navbar">
        <NavLink to="/" end>
          parking.radio
        </NavLink>
        <NavLink to="/archives">archives</NavLink>
        <NavLink to="/programmation">programmation</NavLink>
        <NavLink to="/synth-meetups">synth meetups</NavLink>
        <NavLink to="/appliquer">appliquer</NavLink>
        <NavLink to="/contribuer">contribuer</NavLink>
        <a href={MERCH_URL} target="_blank" rel="noreferrer">
          merch
        </a>
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
