import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { TEST_COLOUR, UNREADABLE_JPEG, colourTestImages, expectColour, testImage } from '../artists/test-photos.js'
import { RA_FLYER_MAX_BYTES, raFlyer } from './flyer.js'

// The flyer as RA takes it, made from real images (see "The flyer" in docs/design/server/ra-publication.md).

describe('raFlyer', () => {
  it('makes a JPEG of at most 2000 × 2000 pixels, keeping its proportions, but never larger than the flyer', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      expect(await sharp(await raFlyer(await testImage(format, 3000, 1500))).metadata(), format).toMatchObject({ format: 'jpeg', width: 2000, height: 1000 })
    }
    expect(await sharp(await raFlyer(await testImage('png', 800, 600))).metadata()).toMatchObject({ width: 800, height: 600 })
  })

  it('turns the flyer upright, as its EXIF orientation says, and keeps none of its metadata', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const flyer = await testImage(format, 3000, 1500, { rotated: true })
      for (const planted of ['PLANTED-MAKE', 'PLANTED-GPS']) expect(flyer.includes(planted), format).toBe(true)
      const sent = await raFlyer(flyer)
      for (const planted of ['PLANTED-MAKE', 'PLANTED-GPS']) expect(sent.includes(planted), format).toBe(false)
      const metadata = await sharp(sent).metadata()
      expect(metadata, format).toMatchObject({ width: 1000, height: 2000, space: 'srgb' })
      expect(metadata.orientation, format).toBeUndefined()
      expect(metadata.exif, format).toBeUndefined()
      expect(metadata.icc, format).toBeUndefined()
      expect(metadata.xmp, format).toBeUndefined()
    }
  })

  it('is in sRGB, converted from the profile of the flyer, 16-bit ones included', async () => {
    for (const [name, flyer] of Object.entries(await colourTestImages())) {
      expect((await sharp(flyer).metadata()).icc === undefined, name).toBe(name.endsWith('without a profile'))
      await expectColour(await raFlyer(flyer), TEST_COLOUR, 3, name)
    }
  })

  it('puts the transparent parts of the flyer on white', async () => {
    // Half transparent: halfway between its colour and white.
    await expectColour(await raFlyer(await testImage('png', 64, 64, { alpha: true })), TEST_COLOUR.map((value) => (value + 255) / 2), 4)
  })

  it('reads grayscale flyers, and 16-bit ones', async () => {
    const grey = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#808080' } })
    for (const flyer of [await grey().toColourspace('b-w').jpeg().toBuffer(), await grey().toColourspace('rgb16').png().toBuffer()]) {
      const sent = await raFlyer(flyer)
      expect(await sharp(sent).metadata()).toMatchObject({ format: 'jpeg', width: 64, height: 48 })
      await expectColour(sent, [128, 128, 128], 2)
    }
  })

  it('lowers its quality until it is at most 3,000,000 bytes', async () => {
    // Noise, which is over the limit at the best quality, so that lower ones are tried. Not compressed, which would only
    // take time.
    const noise = await sharp(randomBytes(2000 * 2000 * 3), { raw: { width: 2000, height: 2000, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
    expect((await sharp(noise).jpeg({ quality: 90 }).toBuffer()).length).toBeGreaterThan(RA_FLYER_MAX_BYTES)
    const sent = await raFlyer(noise)
    expect(sent.length).toBeLessThanOrEqual(RA_FLYER_MAX_BYTES)
    expect(await sharp(sent).metadata()).toMatchObject({ format: 'jpeg', width: 2000, height: 2000 })
  }, 20_000)

  it("fails for what can't be read in full", async () => {
    await expect(raFlyer(UNREADABLE_JPEG)).rejects.toThrow()
  })
})
