import { describe, expect, it } from 'vitest'
import { lineup } from './lineup.js'

// A session's lineup (see `lineup` in docs/design/server/events.md).

const ana = { id: 'artist-1', name: 'Ana' }
const brume = { id: 'artist-2', name: 'Brume' }
const cyan = { id: 'artist-3', name: 'Cyan' }

describe('lineup', () => {
  it("has the performers of the sets that aren't cancelled, in the sets' order then their performers', each once", () => {
    const sets = [
      { status: 'done' as const, performers: [brume, ana] },
      { status: 'cancelled' as const, performers: [cyan] },
      { status: 'planned' as const, performers: [ana, cyan] },
    ]
    expect(lineup(sets)).toEqual([brume, ana, cyan])
  })

  it('tells artists apart by id, not by name', () => {
    const otherAna = { id: 'artist-4', name: 'Ana' }
    expect(lineup([{ status: 'planned', performers: [ana, otherAna, ana] }])).toEqual([ana, otherAna])
  })

  it('is empty without sets, or when they are all cancelled', () => {
    expect(lineup([])).toEqual([])
    expect(lineup([{ status: 'cancelled', performers: [ana] }])).toEqual([])
  })
})
