import { NavLink, Outlet } from 'react-router'
import { useAssetUrl } from './config-context'
import './layout.css'

const MERCH_URL = 'https://parkingdotradio.bigcartel.com'

export function Layout() {
  const assetUrl = useAssetUrl()

  return (
    <div className="layout">
      <nav className="navbar">
        <NavLink to="/" end className="logo">
          <img src={assetUrl('p_3d_spin.gif')} alt="parking.radio" width={28} height={28} />
        </NavLink>
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
