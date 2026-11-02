import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigationType } from 'react-router'
import { useAssetUrl } from './config-context'
import { LivePill } from './player/live-pill'
import { PlayerProvider } from './player/player'
import { PlayerBar } from './player/player-bar'
import './layout.css'

const MERCH_URL = 'https://parkingdotradio.bigcartel.com'

export function Layout() {
  const assetUrl = useAssetUrl()
  const location = useLocation()
  const navigationType = useNavigationType()
  const menuButton = useRef<HTMLButtonElement>(null)

  // Another page opens at its top. Not when going back or forward, where the browser puts the page back where it was, nor
  // when only the query changes, like the admin lists' search.
  const shownPath = useRef(location.pathname)
  useLayoutEffect(() => {
    if (location.pathname === shownPath.current) return
    shownPath.current = location.pathname
    if (navigationType !== 'POP') window.scrollTo(0, 0)
  }, [location.pathname, navigationType])

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
    // The player sits above the pages, so that it keeps playing from one page to the next.
    <PlayerProvider>
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
          <LivePill />
          {/* Dims the page while the menu is open, so tapping anywhere outside the menu closes it
              (including over iframes, which would swallow a document-level click listener's events). */}
          <div className="menu-backdrop" aria-hidden="true" onClick={closeMenu} />
        </nav>
        <main className="page">
          <Outlet />
        </main>
        <PlayerBar />
      </div>
    </PlayerProvider>
  )
}
