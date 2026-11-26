import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { PHOTO_WIDTHS, UnreadablePhoto, makeSizes, resize, sizeKey, sizeName, widthNamed } from './sizes.js'
import { colourTestImages, expectColour, testImage, wideGamutTestImages } from './test-photos.js'

// What photos and flyers are served as, made from real images (see "Photos" in docs/design/server/artists.md).

// For the tests that go through the largest images: in CI, alongside the other test files, they can take about as long
// as vitest's default timeout of 5 s.
const LARGE_IMAGES_TIMEOUT_MS = 20_000

// The colour profile that sharp embeds for Display P3, which is its own, as `testImage` has it.
const P3_PROFILE = (await sharp(await testImage('png', 1, 1)).metadata()).icc

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
      expect(size.xmp, format).toBeUndefined()
    }
  })

  it('keeps its colours: in Display P3, with a profile of its own, when the photo has a profile, and as they are otherwise', async () => {
    for (const [name, { image: photo, colour }] of Object.entries(await colourTestImages())) {
      const size = await resize(photo, 320)
      await expectColour(size, colour, 4, name)
      // Never the photo's, e.g. sRGB's.
      const profiled = (await sharp(photo).metadata()).icc !== undefined
      expect((await sharp(size).metadata()).icc, name).toEqual(profiled ? P3_PROFILE : undefined)
    }
  })

  it('keeps the colours of a photo in Display P3 that are outside sRGB, 8-bit ones included', async () => {
    for (const [name, photo] of Object.entries(await wideGamutTestImages())) {
      await expectColour(photo, [0, 255, 0], 0, `${name}, sent`, { stored: true })
      await expectColour(await resize(photo, 320), [0, 255, 0], 4, name, { stored: true })
    }
  })

  it('keeps its transparency', async () => {
    const size = await sharp(await resize(await testImage('png', 640, 640, { alpha: true }), 320)).metadata()
    expect(size.hasAlpha).toBe(true)
  })

  it("is never taller than WebP allows, even for a very tall photo, which is then narrower", async () => {
    const size = await sharp(await resize(await testImage('png', 1000, 60000), 1280)).metadata()
    expect(size).toMatchObject({ height: 16383, width: 273 })
  }, LARGE_IMAGES_TIMEOUT_MS)

  it("fails for what can't be read in full, even though it starts like an image, or has too many pixels", async () => {
    // Cut short anywhere: sharp would otherwise read what's there, and fill in the rest, unless told to fail on a
    // truncated image, as it is.
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const photo = await testImage(format, 2000, 1000)
      for (const kept of [0.05, 0.6, 0.95]) {
        await expect(resize(photo.subarray(0, Math.floor(photo.length * kept)), 320), `${format} cut at ${kept}`).rejects.toThrow()
      }
    }
    await expect(resize(await testImage('png', 12000, 12000), 320)).rejects.toThrow(/pixel limit/)
  }, LARGE_IMAGES_TIMEOUT_MS)

  it('reads a JPEG with bytes after its end, which browsers show', async () => {
    const photo = Buffer.concat([await testImage('jpeg', 640, 480), Buffer.alloc(1000, 7)])
    expect(await sharp(await resize(photo, 320)).metadata()).toMatchObject({ width: 320 })
  })

  it('reads images with flaws that their decoders only warn about, which browsers show', async () => {
    // A JPEG whose scan says it ends at the 62nd coefficient rather than the 63rd: "Invalid SOS parameters for
    // sequential JPEG".
    const jpeg = Buffer.from(await testImage('jpeg', 640, 480))
    const scan = jpeg.indexOf(Buffer.from([0xff, 0xda]))
    jpeg[scan + 5 + 2 * jpeg[scan + 4] + 1] = 62
    // A PNG whose header has the wrong checksum.
    const png = Buffer.from(await testImage('png', 640, 480))
    png[29] ^= 0xff
    for (const photo of [jpeg, png]) expect(await sharp(await resize(photo, 320)).metadata()).toMatchObject({ width: 320 })
  })
})

describe('makeSizes', () => {
  it('makes every size, or those it is asked for', async () => {
    const photo = await testImage('jpeg', 2000, 1000)
    const sizes = await makeSizes(photo)
    expect([...sizes.keys()]).toEqual([320, 1280])
    expect(await sharp(sizes.get(1280)!).metadata()).toMatchObject({ format: 'webp', width: 1280 })
    expect([...(await makeSizes(photo, [1280])).keys()]).toEqual([1280])
  })

  it("throws an UnreadablePhoto when the photo can't be read", async () => {
    const photo = await testImage('png', 640, 480)
    await expect(makeSizes(photo.subarray(0, photo.length / 2))).rejects.toBeInstanceOf(UnreadablePhoto)
  })
})

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
