import { Fragment } from 'react'
import { Link } from 'react-router'
import { setsMinutes } from '../../session-fields'
import type { SetValues, StudioSet } from '../../session-fields'
import { applicationPath, entryPath, formatDuration, receivedOn } from './describe'

// What the lists of sets show, their rows and what they say of the sets together, on a session's page and in a new
// session's form.

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

// What the sets of a session that lasts `durationMinutes` say when they add up to more than it, e.g. « Les sets durent
// 4 h 58, plus que la session (1 h). », or nothing, which is also the case while the session's duration isn't known.
export function SetsTooLong({ sets, durationMinutes }: { sets: Pick<StudioSet, 'durationMinutes'>[]; durationMinutes: number | null }) {
  const minutes = setsMinutes(sets)
  if (durationMinutes === null || minutes <= durationMinutes) return null
  return (
    <p className="admin-notice">
      Les sets durent {formatDuration(minutes)}, plus que la session ({formatDuration(durationMinutes)}).
    </p>
  )
}

// "↑" and "↓", which move a set one place up or down among its session's sets, like a set's artists (see
// ordered-list.tsx), named after the set, `name`. The first one's "↑" and the last one's "↓" can't be used. Each says what
// it does in `data-action`, along with `data`, e.g. the set it's about, so that the focus can follow the set once it's
// moved.
export function MoveButtons({
  name,
  first,
  last,
  disabled,
  data,
  onMove,
}: {
  name: string
  first: boolean
  last: boolean
  disabled: boolean
  data: Record<`data-${string}`, string | number>
  onMove: (by: -1 | 1) => void
}) {
  return (
    <>
      <button type="button" {...data} data-action="up" aria-label={`monter : ${name}`} disabled={disabled || first} onClick={() => onMove(-1)}>
        ↑
      </button>{' '}
      <button type="button" {...data} data-action="down" aria-label={`descendre : ${name}`} disabled={disabled || last} onClick={() => onMove(1)}>
        ↓
      </button>
    </>
  )
}
