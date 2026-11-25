import sharp from 'sharp'
import { readPhoto } from '../artists/sizes.js'

// A session's flyer, as RA takes flyers, which the bookmarklet uploads to RA (see "The flyer" in
// docs/design/server/ra-publication.md).

// RA's limits: its widest and tallest, and its heaviest, in bytes, which is under 3 MB whether RA counts them in 1000s
// or 1024s.
export const RA_FLYER_MAX_DIMENSION = 2000
export const RA_FLYER_MAX_BYTES = 3_000_000

// The JPEG qualities tried, best first, until one is light enough: most flyers fit at the first.
const QUALITIES = [90, 80, 70, 60, 50, 40, 30, 20, 10]

// The flyer as a JPEG within RA's limits: upright, without any of its metadata, as photos' sizes are (see `resize` in
// artists/sizes.ts), in sRGB, its transparent parts on white, lowering its quality only as far as it needs to fit. It's
// read and resized once, as 8-bit RGB pixels, whatever it was, e.g. grayscale or 16-bit, then encoded until a quality
// fits.
export async function raFlyer(flyer: Buffer): Promise<Buffer> {
  const image = readPhoto(flyer)
    .resize({ width: RA_FLYER_MAX_DIMENSION, height: RA_FLYER_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
  // sharp converts 16-bit RGB with a profile to Display P3, not sRGB, then only reduces its depth, unless told to convert
  // it to sRGB's profile. Not those without one, which that would break. Raw pixels carry no profile.
  if ((await image.metadata()).icc) image.withIccProfile('srgb')
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  const raw = { width: info.width, height: info.height, channels: info.channels }
  for (const quality of QUALITIES) {
    const jpeg = await sharp(data, { raw }).jpeg({ quality }).toBuffer()
    if (jpeg.length <= RA_FLYER_MAX_BYTES) return jpeg
  }
  throw new Error(`The flyer is larger than ${RA_FLYER_MAX_BYTES} bytes as a JPEG, even at quality ${QUALITIES.at(-1)}`)
}
