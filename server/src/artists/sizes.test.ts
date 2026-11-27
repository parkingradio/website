import { describe, expect, it } from 'vitest'
import { PHOTO_WIDTHS, sizeKey, sizeName, widthNamed } from './sizes.js'

// The names and keys of the sizes of photos and flyers (see "Photos" in docs/design/server/artists.md).

describe('sizeName', () => {
  it('names each width, as widthNamed reads it, but never as the sizes made before were', () => {
    for (const width of PHOTO_WIDTHS) {
      expect(widthNamed(sizeName(width))).toBe(width)
      // Those are no longer served, and are deleted by hand, by the end of their keys (see `sizeName`).
      expect(widthNamed(`w${width}.webp`)).toBeUndefined()
      expect(sizeKey('artists/a.jpg', width)).not.toMatch(/\.w\d+\.webp$/)
    }
  })
})

describe('sizeKey', () => {
  it('is next to the photo, and different for each width', () => {
    expect(sizeKey('artists/a.jpg', 320)).toMatch(/^artists\/a\.jpg.+\.webp$/)
    expect(sizeKey('artists/a.jpg', 320)).not.toBe(sizeKey('artists/a.jpg', 1280))
  })
})
