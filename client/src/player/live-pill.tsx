import { usePlayer } from './player-context'
import './player.css'

/**
 * The navigation bar's "● en ondes · artiste" button, which plays or pauses the radio from any page. It reads
 * "hors ondes", and can't be clicked, while the radio is off air. Where the navigation bar is short of room, it's only
 * the red dot, or "● en ondes" on phones (see player.css). Until what's on air is known, it takes its room without
 * showing, so that the links don't move when it shows.
 */
export function LivePill() {
  const { radio, playing, current, toggleRadio } = usePlayer()
  const known = radio.kind !== 'loading'
  const artist = current?.track.artist.toLowerCase()

  return (
    <button
      type="button"
      className={known ? 'live-pill' : 'live-pill unknown'}
      aria-hidden={!known || undefined}
      // Its text can be only the red dot (see player.css), so it's named in full.
      aria-label={current ? `en ondes · ${artist}` : 'hors ondes'}
      aria-pressed={playing !== null}
      disabled={!current}
      onClick={toggleRadio}
    >
      <span className="on-air-dot" aria-hidden="true" />
      <span className="live-pill-text">
        {current ? 'en ondes' : 'hors ondes'}
        {current && <span className="live-pill-artist"> · {artist}</span>}
      </span>
    </button>
  )
}
