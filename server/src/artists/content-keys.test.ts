import { describe, expect, it } from 'vitest'
import { isContentKey } from './content-keys.js'

// Telling the keys made from photos' content from those they were stored under before (see artists/content-keys.ts).

describe('isContentKey', () => {
  it('tells the keys made from photos from the others', () => {
    const hash = 'a'.repeat(64)
    expect(isContentKey(`sessions/${hash}.jpg`)).toBe(true)
    expect(isContentKey(`collectives/${hash}.webp`)).toBe(true)
    expect(isContentKey('artists/2f1a1a9e-6f0b-4b8f-9d0a-1b2c3d4e5f60.png')).toBe(false)
    expect(isContentKey(`${hash}.jpg`)).toBe(false)
    expect(isContentKey(`artists/${hash.slice(1)}.jpg`)).toBe(false)
    expect(isContentKey(`artists/${hash.toUpperCase()}.jpg`)).toBe(false)
  })
})
