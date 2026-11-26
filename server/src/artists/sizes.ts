import sharp from 'sharp'
import type { Sharp } from 'sharp'
import { PHOTO_MAX_PIXELS } from './profile.js'

// The sizes of photos and flyers that the server makes and serves (see "Photos" in docs/design/server/artists.md).

// The widths they're served at, in pixels: thumbnails, and pages where the image is the content.
export const PHOTO_WIDTHS = [320, 1280] as const
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number]

// Each photo is resized once per width, then kept, so libvips' cache of recent operations would only take memory, which
// the server has little of.
sharp.cache(false)

// The largest width or height a WebP image can have.
const WEBP_MAX_DIMENSION = 16383

// The type of every size.
export const SIZE_TYPE = 'image/webp'

// The name of the size at `width`, which ends both the key it's kept under (see `sizeKey`) and its public URL (see
// `publicSizes` in photo-form.ts). It names how the size is made, and has to change when that does: sizes are only made
// when they're missing, so the server would otherwise keep serving those already made, and their public URLs, which
// browsers and Cloudflare keep for good, have to change with what they serve. The server then makes every size again,
// under the new name, when it starts (see artists/backfill.ts), and the sizes under the old name, which it never serves
// again, are left behind in the bucket: they have to be deleted by hand, by the end of their keys, once it has made the
// new ones, so the new name mustn't end like the old one. Until then, deleting a photo leaves them behind.
export function sizeName(width: PhotoWidth): string {
  return `w${width}.v2.webp`
}

// The width of the size named `name`, or undefined when no size has that name.
export function widthNamed(name: string): PhotoWidth | undefined {
  return PHOTO_WIDTHS.find((width) => sizeName(width) === name)
}

// Where the size of a photo is kept: next to it, under its key followed by the size's name.
export function sizeKey(key: string, width: PhotoWidth): string {
  return `${key}.${sizeName(width)}`
}

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
export async function readPhoto(photo: Buffer, profile: 'p3' | 'srgb'): Promise<Sharp> {
  const options = { limitInputPixels: PHOTO_MAX_PIXELS, failOn: 'truncated' } as const
  const { icc, space } = await sharp(photo, options).metadata()
  const image = sharp(photo, { ...options, ignoreIcc: icc !== undefined && space === 'srgb' }).autoOrient()
  return icc ? image.withIccProfile(profile) : image
}

// The photo at `width`, or narrower when it is, as WebP, in Display P3 when it has a colour profile (see `readPhoto`).
export async function resize(photo: Buffer, width: PhotoWidth): Promise<Buffer> {
  return (await readPhoto(photo, 'p3'))
    .resize({ width, height: WEBP_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
}

// The sizes of the photo at `widths`, all of them unless it says, made one after another, so that only one is in memory
// as it's made. Throws an UnreadablePhoto when the photo can't be read.
export async function makeSizes(photo: Buffer, widths: readonly PhotoWidth[] = PHOTO_WIDTHS): Promise<Map<PhotoWidth, Buffer>> {
  const sizes = new Map<PhotoWidth, Buffer>()
  for (const width of widths) {
    try {
      sizes.set(width, await resize(photo, width))
    } catch (error) {
      throw new UnreadablePhoto(error)
    }
  }
  return sizes
}
