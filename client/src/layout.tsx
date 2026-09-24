import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useAssetUrl } from './config-context'
import './layout.css'

const MERCH_URL = 'https://parkingdotradio.bigcartel.com'

export function Layout() {
  const assetUrl = useAssetUrl()
  const location = useLocation()
  const menuButton = useRef<HTMLButtonElement>(null)

  // On narrow screens the links collapse into a menu. Remembering which location the menu was opened
  // at (rather than a plain boolean) closes it on any navigation, including the browser's back button.
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null)
  const menuOpen = menuOpenedAt === location.key
  const closeMenu = () => setMenuOpenedAt(null)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && menuOpen) {
      closeMenu()
      menuButton.current?.focus()
    }
  }

  return (
    <div className="layout">
      <nav className={menuOpen ? 'navbar menu-open' : 'navbar'} onKeyDown={onKeyDown}>
        <button
          ref={menuButton}
          type="button"
          className="menu-button"
          aria-label="menu"
          aria-expanded={menuOpen}
          aria-controls="nav-links"
          onClick={() => setMenuOpenedAt(menuOpen ? null : location.key)}
        >
          <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true">
            <path
              d={menuOpen ? 'M5 5l14 14M19 5L5 19' : 'M3 6h18M3 12h18M3 18h18'}
              stroke="currentColor"
              strokeWidth={2}
            />
          </svg>
        </button>
        <NavLink to="/" end className="logo">
          <img src={assetUrl('p_3d_spin.gif')} alt="parking.radio" width={36} height={36} />
        </NavLink>
        <div id="nav-links" className="nav-links">
          <NavLink to="/" end>
            parking.radio
          </NavLink>
          <NavLink to="/archives">archives</NavLink>
          <NavLink to="/programmation">programmation</NavLink>
          <NavLink to="/synth-meetups">synth meetups</NavLink>
          <NavLink to="/appliquer">appliquer</NavLink>
          <NavLink to="/contribuer">contribuer</NavLink>
          {/* Opens in a new tab without navigating, so it has to close the menu itself. */}
          <a href={MERCH_URL} target="_blank" rel="noreferrer" onClick={closeMenu}>
            merch
          </a>
        </div>
        {/* Dims the page while the menu is open, so tapping anywhere outside the menu closes it
            (including over iframes, which would swallow a document-level click listener's events). */}
        <div className="menu-backdrop" aria-hidden="true" onClick={closeMenu} />
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </div>
  )
}
