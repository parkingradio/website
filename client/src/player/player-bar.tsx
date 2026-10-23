import { usePlayer } from './player-context'
import { rediffusion } from './radio'
import { VolumeControl } from './volume-control'
import { Waveform } from './waveform'
import './player.css'

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4v16l13-8z" fill="currentColor" />
  </svg>
)
const PAUSE_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />
  </svg>
)

/**
 * The player's black bar, at the bottom of every page: a single row with the play/pause button, "● en ondes", the artist,
 * the event of a takeover, a waveform, "rediffusion · " and the date, and the volume. It doesn't show while the radio is
 * off air, unless something is still playing.
 */
export function PlayerBar() {
  const { playing, loading, current, toggleRadio } = usePlayer()
  if (!current) return null
  const { track } = current

  return (
    <section className={loading && playing ? 'player loading' : 'player'} aria-label="lecteur">
      <button
        type="button"
        className="player-play"
        aria-label={playing ? 'pause' : 'écouter la radio en ondes'}
        onClick={toggleRadio}
      >
        {playing ? PAUSE_ICON : PLAY_ICON}
      </button>
      <div className="player-now">
        <div className="player-info">
          <span className="player-label">
            <span className="on-air-dot" aria-hidden="true" />
            en ondes
          </span>
          <p className="player-artist">{track.artist}</p>
          {track.event && <span className="player-event">{track.event}</span>}
        </div>
        <Waveform trackId={track.id} moving={playing !== null && !loading} />
        <span className="player-meta">{rediffusion(track)}</span>
      </div>
      <VolumeControl />
    </section>
  )
}
