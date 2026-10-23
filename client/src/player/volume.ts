// The player's volume: a level from 0 to 1, and whether the sound is muted. The browser remembers it for the next visit.
export type Volume = { level: number; muted: boolean }

const STORAGE_KEY = 'parking-volume'
const FULL: Volume = { level: 1, muted: false }

/** The volume the browser remembered, or full volume. Storage can be unavailable, e.g. in a private window. */
export function loadVolume(): Volume {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (saved && typeof saved === 'object') {
      const { level, muted } = saved as Partial<Volume>
      if (typeof level === 'number' && level >= 0 && level <= 1 && typeof muted === 'boolean') return { level, muted }
    }
  } catch {
    // Falls back to full volume.
  }
  return FULL
}

export function saveVolume(volume: Volume) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(volume))
  } catch {
    // It's only forgotten.
  }
}

/** Whether no sound comes out, which is also the case with the level at zero. */
export function isSilent({ level, muted }: Volume): boolean {
  return muted || level === 0
}

/** What the mute button does: mutes, or unmutes, at half volume if the level had been slid down to zero. */
export function toggledMute(volume: Volume): Volume {
  if (!isSilent(volume)) return { ...volume, muted: true }
  return { level: volume.level === 0 ? 0.5 : volume.level, muted: false }
}
