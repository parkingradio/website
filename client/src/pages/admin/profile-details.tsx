import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { LINK_SITES } from '../../artist-profile'
import type { ArtistLinks } from '../../artist-profile'
import { MISSING } from './describe'

// What the pages of artists and collectives share.

export function BackToArtists() {
  return (
    <Link to="/admin/artistes" className="admin-back">
      ← tous les artistes
    </Link>
  )
}

// A page whose artist or collective couldn't be loaded, saying why.
export function LoadFailure({ children }: { children: ReactNode }) {
  return (
    <>
      <BackToArtists />
      <p className="admin-error" role="alert">
        {children}
      </p>
    </>
  )
}

// An artist's or a collective's photo, or that they have none, so that the team notices.
export function PhotoOrNone({ url, name }: { url: string | null; name: string }) {
  return url ? <img src={url} alt={`Photo de ${name}`} /> : <div className="admin-no-photo">Pas de photo</div>
}

// An artist's or a collective's links, rebuilt from their profile names, in the order of LINK_SITES.
export function LinksList({ links }: { links: ArtistLinks }) {
  const sites = LINK_SITES.filter((site) => links[site.id])
  if (sites.length === 0) return MISSING
  return (
    <ul>
      {sites.map((site) => (
        <li key={site.id}>
          {site.name}&nbsp;:{' '}
          <a href={site.url(links[site.id]!)} target="_blank" rel="noreferrer">
            {links[site.id]}
          </a>
        </li>
      ))}
    </ul>
  )
}
