import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { PlayerContext } from './player-context'
import type { Player } from './player-context'
import { RadioPlayer } from './radio-player'

/**
 * The audio player shared by every page: it's mounted once, above the pages, so that it keeps playing from one page to
 * the next. Nothing happens until it's `enabled`, i.e. until the `nouveau-lecteur` feature flag is on.
 */
export function PlayerProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [player] = useState(() => new RadioPlayer())
  const state = useSyncExternalStore(player.subscribe, player.getState)

  useEffect(() => (enabled ? player.connect() : undefined), [enabled, player])

  const value = useMemo<Player>(
    () => ({
      ...state,
      current: state.playing ?? (state.radio.kind === 'on-air' ? state.radio.onAir : null),
      toggleRadio: player.toggleRadio,
      setLevel: player.setLevel,
      toggleMute: player.toggleMute,
    }),
    [state, player],
  )

  return <PlayerContext value={value}>{children}</PlayerContext>
}
