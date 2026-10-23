import type { CSSProperties } from 'react'
import { usePlayer } from './player-context'
import { isSilent } from './volume'

const WAVE = { stroke: 'currentColor', strokeWidth: 1.6, fill: 'none' }

/**
 * The volume, at the far right of a player: a speaker button that mutes or unmutes the sound, and a slider. The icon
 * shows the level (one or two waves) or that the sound is muted. Phones hide it (see player.css).
 */
export function VolumeControl() {
  const { volume, setLevel, toggleMute } = usePlayer()
  const silent = isSilent(volume)
  const shown = silent ? 0 : volume.level

  return (
    <div className="volume">
      <button
        type="button"
        className="volume-button"
        aria-label={silent ? 'remettre le son' : 'couper le son'}
        onClick={toggleMute}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor" />
          {silent ? (
            <path d="M16 9l5 6M21 9l-5 6" {...WAVE} />
          ) : (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" {...WAVE} />
              {volume.level >= 0.5 && <path d="M18 6a8.5 8.5 0 0 1 0 12" {...WAVE} />}
            </>
          )}
        </svg>
      </button>
      <input
        type="range"
        className="volume-slider"
        aria-label="volume"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        // The part of the track left of the thumb is drawn in full, the rest dimmed.
        style={{ '--level': `${shown * 100}%` } as CSSProperties}
        onChange={(event) => setLevel(Number(event.target.value))}
      />
    </div>
  )
}
