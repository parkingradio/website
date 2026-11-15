import { Fragment } from 'react'
import { Link } from 'react-router'
import type { SetValues, StudioSet } from '../../session-fields'
import { applicationPath, entryPath, receivedOn } from './describe'

// What the rows of sets show, on a session's page and in a new session's form.

// Performers, each linking to their page, separated by commas.
export function Performers({ performers }: { performers: StudioSet['performers'] }) {
  return performers.map((performer, i) => (
    <Fragment key={performer.id}>
      {i > 0 && ', '}
      <Link to={entryPath('artist', performer.id)}>{performer.name}</Link>
    </Fragment>
  ))
}

// A set's links, by the names of their sites, each leading to it, then the application it comes from, if any, leading
// to its page, and named by when it was received for screen readers.
export function SetLinks({ set }: { set: Pick<SetValues, 'application' | 'soundcloudTrack' | 'youtubeVideo'> }) {
  const links = [
    { name: 'SoundCloud', link: set.soundcloudTrack },
    { name: 'YouTube', link: set.youtubeVideo },
  ]
    .filter((link) => link.link)
    .map(({ name, link }) => (
      <a key={name} href={link!.url} target="_blank" rel="noreferrer">
        {name}
      </a>
    ))
  if (set.application) {
    const label = `Candidature ${receivedOn(set.application)}`
    links.push(
      <Link key="application" to={applicationPath(set.application)} aria-label={label}>
        Candidature
      </Link>,
    )
  }
  return links.map((link, i) => (
    <Fragment key={link.key}>
      {i > 0 && ' · '}
      {link}
    </Fragment>
  ))
}
