import { Fragment } from 'react'
import { Link } from 'react-router'
import type { SetValues, StudioSet } from '../../session-fields'
import { applicationPath, entryPath, receivedOn } from './describe'

// What the rows of sets show, on a session's page and in a new session's form.

// What a link opens, with `newTab`: the page it links to, in a new tab, e.g. so that a form that isn't saved isn't left.
const inNewTab = (newTab: boolean) => (newTab ? { target: '_blank', rel: 'noreferrer' } : {})

// Performers, each linking to their page, separated by commas.
export function Performers({ performers, newTab = false }: { performers: StudioSet['performers']; newTab?: boolean }) {
  return performers.map((performer, i) => (
    <Fragment key={performer.id}>
      {i > 0 && ', '}
      <Link to={entryPath('artist', performer.id)} {...inNewTab(newTab)}>
        {performer.name}
      </Link>
    </Fragment>
  ))
}

// A set's links, by the names of their sites, each leading to it, then the application it comes from, if any, leading
// to its page, and named by when it was received for screen readers.
export function SetLinks({ set, newTab = false }: { set: Pick<SetValues, 'application' | 'soundcloudTrack' | 'youtubeVideo'>; newTab?: boolean }) {
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
      <Link key="application" to={applicationPath(set.application)} aria-label={label} {...inNewTab(newTab)}>
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
