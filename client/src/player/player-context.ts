import { createContext, use } from 'react'
import type { OnAir } from './radio'
import type { PlayerState, RadioPlayer } from './radio-player'

// The audio player shared by every page (see PlayerProvider in player.tsx). This lives in its own file because a module
// exporting both a component and a hook breaks Fast Refresh.
export type Player = PlayerState &
  Pick<RadioPlayer, 'toggleRadio' | 'setLevel' | 'toggleMute'> & {
    // What the player shows: what's playing, or else what's on air. Null while the radio is off air and nothing plays.
    current: OnAir | null
  }

export const PlayerContext = createContext<Player | null>(null)

export function usePlayer(): Player {
  const player = use(PlayerContext)
  if (!player) throw new Error('usePlayer must be used inside a PlayerProvider')
  return player
}
