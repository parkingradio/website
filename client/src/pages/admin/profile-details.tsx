import { useState } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Schema } from '../../api/client'
import { LINK_SITES } from '../../artist-profile'
import type { Artist, ArtistLinks } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { KIND_LABELS, MISSING, collectiveGenreNames, entryPath, genreNames, photoUrl, place } from './describe'

// What the pages of artists and collectives share, and what applications' pages show of them.

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
function MembersList({ members }: { members: Schema<'Reference'>[] }) {
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
function PhotoOrNone({ url, name }: { url: string | null; name: string }) {
  return url ? <img src={url} alt={`Photo de ${name}`} /> : <div className="admin-no-photo">Pas de photo</div>
}

// An artist's or a collective's links, rebuilt from their profile names, in the order of LINK_SITES.
function LinksList({ links }: { links: ArtistLinks }) {
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

// Everything about an artist: their photo, or that they have none, then their profile, first naming them, linking to their
// page, when they're `named`, e.g. on their applications' pages.
export function ArtistDetails({ artist, named = false }: { artist: Artist; named?: boolean }) {
  return (
    <div className="admin-record">
      <PhotoOrNone url={artist.hasPhoto ? photoUrl('artists', artist) : null} name={artist.name} />
      <dl>
        {named && (
          <>
            <dt>Nom</dt>
            <dd>
              <Link to={entryPath('artist', artist.id)}>{artist.name}</Link> ({KIND_LABELS.artist})
            </dd>
          </>
        )}
        {artist.collectives.length > 0 && (
          <>
            <dt>Collectifs</dt>
            <dd>
              <ul>
                {artist.collectives.map((collective) => (
                  <li key={collective.id}>
                    <Link to={entryPath('collective', collective.id)}>{collective.name}</Link>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>Ville</dt>
        <dd>{place(artist)}</dd>
        <dt>Genres</dt>
        <dd>{genreNames(artist.genres)}</dd>
        <dt>Liens</dt>
        <dd>
          <LinksList links={artist.links} />
        </dd>
        <dt>Adresse e-mail</dt>
        <dd>{artist.email ? <a href={`mailto:${artist.email}`}>{artist.email}</a> : MISSING}</dd>
        <dt>Téléphone</dt>
        <dd>{artist.phone ? <a href={`tel:${artist.phone}`}>{artist.phone}</a> : MISSING}</dd>
        <dt>Bio</dt>
        <dd className="admin-text">
          <LongText text={artist.bio} />
        </dd>
      </dl>
    </div>
  )
}

// Everything about a collective: its photo, or that it has none, then its profile, first naming it, linking to its page,
// when it's `named`, with its artists, linking to them, and their genres, from its `members`, unless they couldn't be
// loaded, which leaves them blank.
export function CollectiveDetails({ collective, members, named = false }: { collective: Collective; members: Artist[] | null; named?: boolean }) {
  return (
    <div className="admin-record">
      <PhotoOrNone url={collective.hasPhoto ? photoUrl('collectives', collective) : null} name={collective.name} />
      <dl>
        {named && (
          <>
            <dt>Nom</dt>
            <dd>
              <Link to={entryPath('collective', collective.id)}>{collective.name}</Link> ({KIND_LABELS.collective})
            </dd>
          </>
        )}
        <dt>Artistes du collectif</dt>
        <dd>
          <MembersList members={collective.members} />
        </dd>
        <dt>Ville</dt>
        <dd>{place(collective)}</dd>
        <dt>Genres de ses artistes</dt>
        <dd>{collectiveGenreNames(collective, members)}</dd>
        <dt>Liens</dt>
        <dd>
          <LinksList links={collective.links} />
        </dd>
        <dt>Adresse e-mail du contact</dt>
        <dd>{collective.email ? <a href={`mailto:${collective.email}`}>{collective.email}</a> : MISSING}</dd>
        <dt>Téléphone du contact</dt>
        <dd>{collective.phone ? <a href={`tel:${collective.phone}`}>{collective.phone}</a> : MISSING}</dd>
        <dt>Description</dt>
        <dd className="admin-text">
          <LongText text={collective.description} />
        </dd>
      </dl>
    </div>
  )
}

// How long a bio or a description can be, in characters, before it's cut (see `LongText`).
const LONG_TEXT_LENGTH = 750

// A bio or a description, or "-" when it's left out. When it's longer than LONG_TEXT_LENGTH, it's cut, with a button
// that shows it whole, then cuts it again (see artistes.md).
function LongText({ text }: { text: string }) {
  const [whole, setWhole] = useState(false)
  if (!text) return MISSING
  if (text.length <= LONG_TEXT_LENGTH) return text
  return (
    <>
      {whole ? text : `${cut(text)}…`}{' '}
      <button
        type="button"
        className="admin-more"
        onClick={(event) => {
          const button = event.currentTarget
          flushSync(() => setWhole(!whole))
          // Once cut again, the text no longer reaches where its end was, e.g. at the bottom of the screen: the button,
          // which keeps the focus, is brought back into view.
          if (whole) button.scrollIntoView?.({ block: 'nearest' })
        }}
      >
        {whole ? 'réduire' : 'lire la suite'}
      </button>
    </>
  )
}

// `text` up to the end of the last word that fits in its first LONG_TEXT_LENGTH characters, or those characters when no
// word ends in them, without splitting an emoji, which takes two (UTF-16 code units, which the server counts too). Words
// are separated by whitespace, but not by no-break spaces, e.g. inside « », which would strand the « or the ».
function cut(text: string): string {
  // With a character more, to tell whether the last word ends in them, taking away the last word and the whitespace
  // before it leaves the words that do, or nothing when none does.
  const words = text.slice(0, LONG_TEXT_LENGTH + 1).replace(/[^\S\u00A0\u202F]*[\S\u00A0\u202F]*$/, '')
  if (words) return words
  const end = /[\uD800-\uDBFF]/.test(text[LONG_TEXT_LENGTH - 1]) ? LONG_TEXT_LENGTH - 1 : LONG_TEXT_LENGTH
  return text.slice(0, end)
}
