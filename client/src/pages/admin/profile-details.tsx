import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Schema } from '../../api/client'
import { LINK_SITES } from '../../artist-profile'
import type { ArtistLinks } from '../../artist-profile'
import { MISSING, entryPath } from './describe'

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

// That the artists, or the collectives, couldn't be loaded, and why.
export function ArtistsFailure({ message }: { message: string }) {
  return (
    <p className="admin-error" role="alert">
      Les artistes n'ont pas pu être chargés&nbsp;: {message}
    </p>
  )
}

export function CollectivesFailure({ message }: { message: string }) {
  return (
    <p className="admin-error" role="alert">
      Les collectifs n'ont pas pu être chargés&nbsp;: {message}
    </p>
  )
}

export function ApplicationsFailure({ message }: { message: string }) {
  return (
    <p className="admin-error" role="alert">
      Les candidatures n'ont pas pu être chargées&nbsp;: {message}
    </p>
  )
}

// A collective's artists, in order, each linking to their page, or that it has none, which happens once they're deleted.
export function MembersList({ members }: { members: Schema<'Reference'>[] }) {
  if (members.length === 0) return 'Aucun artiste.'
  return (
    <ol>
      {members.map((member) => (
        <li key={member.id}>
          <Link to={entryPath('artist', member.id)}>{member.name}</Link>
        </li>
      ))}
    </ol>
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
