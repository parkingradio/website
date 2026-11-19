import sharp from 'sharp'
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

// Where the size of a photo is kept: next to it, under its key with a suffix. The suffix names how the size is encoded,
// and has to change when that does, since sizes are only made when they're missing: the server would otherwise keep
// serving those already made. Those would then be left behind, so `delete` (see `privatePhotos` in store.ts) would also
// have to delete the sizes under the old suffix, or they'd outlive their photo.
export function sizeKey(key: string, width: PhotoWidth): string {
  return `${key}.w${width}.webp`
}

// Thrown when a photo can't be read in full, e.g. when it's damaged or cut short, even though its type was checked, or
// has more than PHOTO_MAX_PIXELS.
export class UnreadablePhoto extends Error {
  constructor(cause: unknown) {
    super("The photo can't be read", { cause })
  }
}

// The photo at `width`, or narrower when it is, as WebP, upright as its EXIF orientation says, and without any of its
// metadata, which sharp drops unless told to keep it. Throws when the photo can't be read in full: sharp's default
// `failOn`, 'warning', is what refuses a photo that's cut short, which it would otherwise read, filling in what's missing.
export async function resize(photo: Buffer, width: PhotoWidth): Promise<Buffer> {
  return sharp(photo, { limitInputPixels: PHOTO_MAX_PIXELS })
    .autoOrient()
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
