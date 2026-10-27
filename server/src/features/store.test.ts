import { describe, expect, it } from 'vitest'
import { currentFeatures } from './store.js'
import type { FeatureId } from './store.js'

// These tests use flags of their own, so that they don't depend on which flags there are.
const IDS = ['new-thing', 'other-thing'] as unknown as FeatureId[]

describe('currentFeatures', () => {
  const at = new Date('2026-10-09T16:30:00Z')

  it('lists every flag, in order, off until it has been turned on', () => {
    expect(currentFeatures(IDS, [{ id: 'other-thing', enabled: true, updatedBy: 'admin@example.com', updatedAt: at }])).toEqual([
      { id: 'new-thing', enabled: false, updatedBy: null, updatedAt: null },
      { id: 'other-thing', enabled: true, updatedBy: 'admin@example.com', updatedAt: at },
    ])
  })

  it('leaves out the flags that were retired', () => {
    const rows = [{ id: 'retired-thing', enabled: true, updatedBy: 'admin@example.com', updatedAt: at }]
    expect(currentFeatures(IDS, rows).map(({ id }) => id)).toEqual(['new-thing', 'other-thing'])
  })
})
