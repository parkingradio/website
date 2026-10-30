import { Fragment, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { Data, Schema } from '../../api/client'
import { useApi } from '../../api/use-api'
import type { Loaded } from '../../api/use-api'

type RadioPlaylist = Schema<'RadioPlaylist'>
type RadioPlaylistTrack = Schema<'RadioPlaylistTrack'>

const chosenAtFormat = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short' })
const timeFormat = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })

// Why a track is left out of the rotation, as SoundCloud says.
const LEFT_OUT_REASONS: Record<Schema<'LeftOutTrack'>['reason'] | 'unexpected', string> = {
  preview: 'Track marquée comme preview sur SoundCloud',
  blocked: 'SoundCloud ne permet pas aux applications de la jouer',
  'not-streamable': 'SoundCloud ne permet pas de la diffuser',
  unexpected: 'Erreur lors de la lecture de la description',
}

// How many tracks are listed at first, and how many more each time more are asked for.
const FIRST_TRACKS = 10
const MORE_TRACKS = 25

function describeTrack({ artist, event, date }: Schema<'RadioTrack'>): string {
  return [artist, event, date].filter(Boolean).join(' · ')
}

export function Rotation() {
  // Changed to load everything again, once another playlist is chosen.
  const [version, setVersion] = useState(0)
  const settings = useApi('/api/admin/radio', { version })
  const radio = useApi('/api/radio', { params: { query: { upcoming: '0' } }, version })

  return (
    <>
      <h1>Rotation radio</h1>
      {settings.kind === 'loaded' && !settings.value.credentialsEntered && (
        <p className="admin-error" role="alert">
          La radio ne peut lire aucune playlist sur SoundCloud tant que les identifiants de son application n'ont pas été
          entrés dans la <Link to="/admin/configuration">configuration</Link>.
        </p>
      )}

      <h2>À l'antenne</h2>
      <OnAir settings={settings} radio={radio} />

      <h2>Changer de playlist</h2>
      <ChangePlaylist onChosen={() => setVersion((version) => version + 1)} />
    </>
  )
}

// The playlist the rotation is read from, and its tracks from the one on air.
function OnAir({ settings, radio }: { settings: Loaded<Data<'get', '/api/admin/radio'>>; radio: Loaded<Schema<'Radio'>> }) {
  if (settings.kind === 'loading') return null
  if (settings.kind === 'error') {
    return (
      <p className="admin-error" role="alert">
        La playlist de la radio n'a pas pu être chargée&nbsp;: {settings.message}
      </p>
    )
  }
  const { current } = settings.value
  if (!current) {
    return <p className="admin-placeholder">Aucune playlist n'a encore été choisie&nbsp;: la radio est hors ondes.</p>
  }

  const { url, title, chosenBy, chosenAt, playlist, error } = current
  return (
    <>
      <PlaylistHeader url={url} title={title} playlist={playlist} />
      <p className="admin-meta">
        Choisie par {chosenBy} le {chosenAtFormat.format(new Date(chosenAt))}.
      </p>
      {error && (
        <p className="admin-error" role="alert">
          La playlist n'a pas pu être lue sur SoundCloud&nbsp;: {error}
          {playlist && '. La radio continue avec ce qui en avait été lu avant.'}
        </p>
      )}
      {radio.kind === 'error' && <p className="admin-placeholder">Hors ondes&nbsp;: {radio.message}</p>}
      {playlist && <PlaylistTracks key={playlist.url} playlist={playlist} onAir={radio.kind === 'loaded' ? radio.value.current : null} />}
    </>
  )
}

// The playlist's title, linking to it, and the account it belongs to when it could be read.
function PlaylistHeader({ url, title, playlist }: { url: string; title: string; playlist: RadioPlaylist | null }) {
  return (
    <div className="radio-playlist">
      <p className="radio-playlist-title">
        <a href={url} target="_blank" rel="noreferrer">
          {title}
        </a>
      </p>
      {playlist && (
        <p>
          Playlist {playlist.private ? 'privée' : 'publique'} de{' '}
          <a href={playlist.account.url} target="_blank" rel="noreferrer">
            {playlist.account.name}
          </a>
        </p>
      )}
    </div>
  )
}

// The tracks of a playlist in the order they come on air: from the one on air, if it's given, around the
// playlist and back.
function PlaylistTracks({ playlist, onAir }: { playlist: RadioPlaylist; onAir: Schema<'Radio'>['current'] | null }) {
  const [visible, setVisible] = useState(FIRST_TRACKS)
  const { tracks } = playlist

  const onAirIndex = onAir ? tracks.findIndex((track) => track.kind === 'rotation' && track.track.id === onAir.track.id) : -1
  // When each track that's on the radio begins, if what's on air is known. A track that begins on another day
  // than the one before it is introduced by that day.
  let begins = onAir && onAirIndex !== -1 ? Date.parse(onAir.startedAt) : null
  let day = begins === null ? null : dayFormat.format(begins)
  const rows: { index: number; track: RadioPlaylistTrack; begins: number | null; day: string | null }[] = []
  for (let i = 0; i < tracks.length; i++) {
    const index = (Math.max(onAirIndex, 0) + i) % tracks.length
    const track = tracks[index]
    const row = { index, track, begins: null as number | null, day: null as string | null }
    if (track.kind === 'rotation' && begins !== null) {
      row.begins = begins
      const beginsDay = dayFormat.format(begins)
      if (beginsDay !== day) row.day = day = beginsDay
      begins += track.track.durationMs
    }
    rows.push(row)
  }

  return (
    <>
      <ol className="radio-tracks">
        {rows.slice(0, visible).map(({ index, track, begins, day }) => (
          <Fragment key={index}>
            {day && <li className="radio-tracks-day">{day}</li>}
            <TrackRow track={track} begins={begins} current={index === onAirIndex} />
          </Fragment>
        ))}
      </ol>
      {visible < rows.length && (
        <button type="button" className="radio-tracks-more" onClick={() => setVisible((visible) => visible + MORE_TRACKS)}>
          afficher plus
        </button>
      )}
    </>
  )
}

// A track of a playlist, with when it begins if it's on the radio and that's known. A track that's left out
// says why when it's hovered or clicked.
function TrackRow({ track, begins, current }: { track: RadioPlaylistTrack; begins: number | null; current: boolean }) {
  const [reasonShown, setReasonShown] = useState(false)
  const label = track.kind === 'unexpected' ? track.title : describeTrack(track.track)
  const reason = track.kind === 'rotation' ? null : LEFT_OUT_REASONS[track.kind === 'left-out' ? track.reason : 'unexpected']
  return (
    <li className={reason ? 'radio-track-left-out' : current ? 'radio-track-current' : undefined}>
      <span className="radio-track-time">{begins === null ? '' : timeFormat.format(begins)}</span>
      <span>
        {reason ? (
          <button type="button" title={reason} aria-expanded={reasonShown} onClick={() => setReasonShown(!reasonShown)}>
            {label}
          </button>
        ) : (
          label
        )}
        {current && <span className="radio-track-tag">en cours</span>}
        {reasonShown && <span className="radio-track-reason">{reason}</span>}
      </span>
    </li>
  )
}

type Step =
  | { kind: 'idle' | 'previewing' }
  | { kind: 'preview' | 'choosing'; link: string; playlist: RadioPlaylist }
  | { kind: 'chosen'; title: string }
  | { kind: 'error'; message: string }

// Previews the playlist at a link, then chooses it.
function ChangePlaylist({ onChosen }: { onChosen: () => void }) {
  const [link, setLink] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'idle' })

  const preview = async (event: FormEvent) => {
    event.preventDefault()
    if (playlistLink(link) === null) {
      setStep({ kind: 'error', message: "Ce n'est pas un lien vers une playlist SoundCloud." })
      return
    }
    setStep({ kind: 'previewing' })
    const result = await api.POST('/api/admin/radio/preview', { body: { link } })
    if (result.ok) setStep({ kind: 'preview', link, playlist: result.playlist })
    else setStep({ kind: 'error', message: `La playlist n'a pas pu être lue : ${result.error}` })
  }

  const choose = async () => {
    if (step.kind !== 'preview') return
    setStep({ ...step, kind: 'choosing' })
    const result = await api.POST('/api/admin/radio/playlist', { body: { link: step.link } })
    if (result.ok) {
      setLink('')
      setStep({ kind: 'chosen', title: step.playlist.title })
      onChosen()
    } else {
      setStep({ kind: 'error', message: `La playlist n'a pas pu être choisie : ${result.error}` })
    }
  }

  return (
    <>
      <form className="admin-form" onSubmit={preview}>
        <label>
          Lien de la playlist
          <input
            type="url"
            value={link}
            placeholder="https://soundcloud.com/…/sets/…"
            onChange={(event) => {
              setLink(event.target.value)
              // What's previewed is what gets chosen, so a preview doesn't outlive its link.
              if (step.kind === 'preview') setStep({ kind: 'idle' })
            }}
            required
          />
        </label>
        <p className="admin-hint">Pour une playlist privée, utilisez son lien privé, qui se termine par /s-…</p>
        <button type="submit" disabled={step.kind === 'previewing' || step.kind === 'choosing'}>
          prévisualiser
        </button>
      </form>
      {step.kind === 'error' && (
        <p className="admin-error" role="alert">
          {step.message}
        </p>
      )}
      {step.kind === 'chosen' && <p className="admin-notice">La radio joue maintenant «&nbsp;{step.title}&nbsp;».</p>}
      {(step.kind === 'preview' || step.kind === 'choosing') && (
        <div className="radio-preview">
          <PlaylistHeader url={step.playlist.url} title={step.playlist.title} playlist={step.playlist} />
          <PlaylistTracks playlist={step.playlist} onAir={null} />
          {step.playlist.tracks.some((track) => track.kind === 'rotation') ? (
            <>
              <p>La radio passera tout de suite au début de cette playlist (sans couper les auditeurs en cours).</p>
              <button type="button" className="radio-choose" onClick={choose} disabled={step.kind === 'choosing'}>
                jouer cette playlist
              </button>
            </>
          ) : (
            <p className="admin-error">Aucune piste de cette playlist ne peut être jouée en entier&nbsp;: elle ne peut pas être choisie.</p>
          )}
        </div>
      )}
    </>
  )
}

// Links to SoundCloud playlists, e.g. "https://soundcloud.com/parkingdotradio/sets/rotation". A private playlist can only
// be read through its private link, which ends with its secret, e.g.
// "https://soundcloud.com/parkingdotradio/sets/rotation/s-AbC123". Parameters, e.g. "?si=...", are allowed.
//
// This is a copy of the server's `playlistLink` (server/src/radio/routes.ts), which decides: it lets the page say that
// a link isn't to a playlist without asking for a preview.
const PLAYLIST_LINK = /^\s*https?:\/\/(?:www\.)?soundcloud\.com(\/[^/?#\s]+\/sets\/[^/?#\s]+(?:\/s-[^/?#\s]+)?)\/?(?:[?#]\S*)?\s*$/

// The playlist `link` leads to, as a link without anything that doesn't identify the playlist, or null if it isn't a link
// to a playlist.
function playlistLink(link: string): string | null {
  const path = PLAYLIST_LINK.exec(link)?.[1]
  return path ? `https://soundcloud.com${path}` : null
}
