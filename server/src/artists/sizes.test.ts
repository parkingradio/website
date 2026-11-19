import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { resize, sizeKey, takingTurns } from './sizes.js'
import { JPEG, testImage } from './test-photos.js'

// What photos and flyers are served as, made from real images (see "Photos" in docs/design/server/artists.md).

describe('resize', () => {
  it('makes a WebP image of that width, keeping its proportions', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const photo = await testImage(format, 2000, 1000)
      for (const [width, height] of [[320, 160], [1280, 640]] as const) {
        const size = await sharp(await resize(photo, width)).metadata()
        expect(size, format).toMatchObject({ format: 'webp', width, height })
      }
    }
  })

  it("never makes a photo larger than it is: one that's narrower keeps its width", async () => {
    const photo = await testImage('png', 200, 500)
    for (const width of [320, 1280] as const) {
      expect(await sharp(await resize(photo, width)).metadata()).toMatchObject({ width: 200, height: 500 })
    }
  })

  it('turns the photo upright, as its EXIF orientation says, before resizing it', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const photo = await testImage(format, 2000, 1000, { rotated: true })
      const size = await sharp(await resize(photo, 320)).metadata()
      expect(size, format).toMatchObject({ width: 320, height: 640 })
      expect(size.orientation, format).toBeUndefined()
    }
  })

  it('keeps none of its metadata, e.g. where it was taken', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const photo = await testImage(format, 640, 480, { rotated: true })
      for (const planted of ['PLANTED-MAKE', 'PLANTED-GPS']) expect(photo.includes(planted), format).toBe(true)
      const resized = await resize(photo, 320)
      for (const planted of ['PLANTED-MAKE', 'PLANTED-GPS']) expect(resized.includes(planted), format).toBe(false)
      const size = await sharp(resized).metadata()
      expect(size.exif, format).toBeUndefined()
      expect(size.icc, format).toBeUndefined()
      expect(size.xmp, format).toBeUndefined()
    }
  })

  it('keeps its transparency', async () => {
    const size = await sharp(await resize(await testImage('png', 640, 640, { alpha: true }), 320)).metadata()
    expect(size.hasAlpha).toBe(true)
  })

  it("is never taller than WebP allows, even for a very tall photo, which is then narrower", async () => {
    const size = await sharp(await resize(await testImage('png', 1000, 60000), 1280)).metadata()
    expect(size).toMatchObject({ height: 16383, width: 273 })
  })

  it("fails for what can't be decoded, even though it starts like an image, or has too many pixels", async () => {
    await expect(resize(JPEG, 320)).rejects.toThrow()
    const jpeg = await testImage('jpeg', 2000, 1000)
    await expect(resize(jpeg.subarray(0, jpeg.length / 2), 320)).rejects.toThrow()
    await expect(resize(await testImage('png', 12000, 12000), 320)).rejects.toThrow(/pixel limit/)
  })
})

describe('sizeKey', () => {
  it('is next to the photo, and different for each width', () => {
    expect(sizeKey('artists/a.jpg', 320)).toMatch(/^artists\/a\.jpg.+\.webp$/)
    expect(sizeKey('artists/a.jpg', 320)).not.toBe(sizeKey('artists/a.jpg', 1280))
  })
})

describe('takingTurns', () => {
  it('runs the work it is given so many at a time at most, in order, even when some fails', async () => {
    const inTurn = takingTurns(2)
    let running = 0
    let most = 0
    const started: number[] = []
    const work = (i: number) =>
      inTurn(async () => {
        started.push(i)
        most = Math.max(most, ++running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running--
        if (i % 3 === 0) throw new Error(`failed ${i}`)
        return i
      })
    const results = await Promise.allSettled([0, 1, 2, 3, 4, 5, 6].map(work))
    expect(most).toBe(2)
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(results.map((result) => (result.status === 'fulfilled' ? result.value : result.reason.message))).toEqual(['failed 0', 1, 2, 'failed 3', 4, 5, 'failed 6'])
    // And then, with nothing waiting, it runs right away again.
    expect(await inTurn(async () => 'next')).toBe('next')
  })
})
