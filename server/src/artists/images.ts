import sharp from 'sharp'
import type { Sharp } from 'sharp'
import { PHOTO_MAX_PIXELS } from './profile.js'
import { PHOTO_WIDTHS } from './sizes.js'
import type { PhotoWidth } from './sizes.js'

// What the server makes from photos and flyers: their sizes (see "Photos" in docs/design/server/artists.md), and a
// session's flyer as RA takes them (see "The flyer" in docs/design/server/ra-publication.md). Nothing else reads images.
//
// They're read one at a time, process-wide, whoever asks: reading one decodes it whole, which can take hundreds of MB
// for a large photo within the limits, e.g. a progressive JPEG, and the server has little memory, which two at once
// could take all of. sharp already works off the main thread, so only their memory is limited: whoever asks waits for
// their turn, in the order they asked, and is never refused. Only the exported functions take a turn, and they never
// call each other, which would wait for good for a turn behind their own: the functions they use run within their turn.

// Each photo is resized once per width, then kept, so libvips' cache of recent operations would only take memory, which
// the server has little of.
sharp.cache(false)

// Settles once the last image asked for is read, without its result, which it would otherwise keep.
let queue: Promise<void> = Promise.resolve()

// Runs `work` once everything asked before it is done, whether that succeeded or failed.
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const turn = queue.then(work)
  queue = turn.then(() => {}, () => {})
  return turn
}

// The largest width or height a WebP image can have.
const WEBP_MAX_DIMENSION = 16383

// Thrown when a photo can't be read in full, e.g. when it's damaged or cut short, even though its type was checked, or
// has more than PHOTO_MAX_PIXELS.
export class UnreadablePhoto extends Error {
  constructor(cause: unknown) {
    super("The photo can't be read", { cause })
  }
}

// The photo, read to be made into another image, upright as its EXIF orientation says, and without any of its
// metadata, which sharp drops unless told to keep it. What's made from it throws when the photo can't be read in full:
// `failOn: 'truncated'` refuses one whose data ends early, which sharp would otherwise read, filling in what's missing,
// or that the decoder can't get through, e.g. garbage after a JPEG's header, or a PNG's corrupt compressed data. It reads
// those that decode in full with warnings, which browsers show too, e.g. JPEGs with corrupt scan data or quirks of their
// format, as some phones make, or PNGs with a bad checksum, which sharp's default, 'warning', refuses.
//
// A photo with an ICC profile is converted to `profile`, sharp's own, never the photo's, which is embedded in what's
// made from it, unless that's raw pixels. sharp converts a photo from its profile as it reads it, to sRGB, or to
// Display P3 for 16-bit RGB, before converting it to `profile`: 8-bit RGB, e.g. a phone's photo in Display P3, would
// lose its colours outside sRGB, so its profile is ignored as it's read, and it's converted straight from it to
// `profile` instead. Not greyscale or CMYK, whose profile sharp then wouldn't use at all. A photo without a profile is
// left as it is: sharp would take it to be in sRGB, or Display P3 when it's 16-bit, and convert or tag it.
async function openPhoto(photo: Buffer, profile: 'p3' | 'srgb'): Promise<Sharp> {
  const options = { limitInputPixels: PHOTO_MAX_PIXELS, failOn: 'truncated' } as const
  const { icc, space } = await sharp(photo, options).metadata()
  const image = sharp(photo, { ...options, ignoreIcc: icc !== undefined && space === 'srgb' }).autoOrient()
  return icc ? image.withIccProfile(profile) : image
}

// The photo at `width`, or narrower when it is, as WebP, in Display P3 when it has a colour profile (see `openPhoto`).
async function resize(photo: Buffer, width: PhotoWidth): Promise<Buffer> {
  return (await openPhoto(photo, 'p3'))
    .resize({ width, height: WEBP_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
}

// The sizes of the photo at `widths`, all of them unless it says, made one after another, so that only one is in memory
// as it's made. Throws an UnreadablePhoto when the photo can't be read.
export function makeSizes(photo: Buffer, widths: readonly PhotoWidth[] = PHOTO_WIDTHS): Promise<Map<PhotoWidth, Buffer>> {
  return inTurn(async () => {
    const sizes = new Map<PhotoWidth, Buffer>()
    for (const width of widths) {
      try {
        sizes.set(width, await resize(photo, width))
      } catch (error) {
        throw new UnreadablePhoto(error)
      }
    }
    return sizes
  })
}

// RA's limits on flyers: their widest and tallest, and their heaviest, in bytes, which is under 3 MB whether RA counts
// them in 1000s or 1024s.
export const RA_FLYER_MAX_DIMENSION = 2000
export const RA_FLYER_MAX_BYTES = 3_000_000

// The JPEG qualities tried, best first, until one is light enough: most flyers fit at the first.
const QUALITIES = [90, 80, 70, 60, 50, 40, 30, 20, 10]

// The flyer as a JPEG within RA's limits, which the bookmarklet uploads to RA: upright and without any of its metadata,
// as photos' sizes are (see `openPhoto`), in sRGB without a colour profile, converted from its own when it has one, its
// transparent parts on white, lowering its quality only as far as it needs to fit. It's read and resized once, as 8-bit
// RGB pixels, whatever it was, e.g. grayscale or 16-bit, then encoded until a quality fits.
export function raFlyer(flyer: Buffer): Promise<Buffer> {
  return inTurn(async () => {
    const { data, info } = await (await openPhoto(flyer, 'srgb'))
      .resize({ width: RA_FLYER_MAX_DIMENSION, height: RA_FLYER_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })
    const raw = { width: info.width, height: info.height, channels: info.channels }
    for (const quality of QUALITIES) {
      const jpeg = await sharp(data, { raw }).jpeg({ quality }).toBuffer()
      if (jpeg.length <= RA_FLYER_MAX_BYTES) return jpeg
    }
    throw new Error(`The flyer is larger than ${RA_FLYER_MAX_BYTES} bytes as a JPEG, even at quality ${QUALITIES.at(-1)}`)
  })
}
