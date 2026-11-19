import sharp from 'sharp'

// The sizes of photos and flyers that the server makes and serves (see "Photos" in docs/design/server/artists.md).

// The widths they're served at, in pixels: thumbnails, and pages where the image is the content.
export const PHOTO_WIDTHS = [320, 1280] as const
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number]

// Each photo is resized once per width, then kept, so libvips' cache of recent operations would only take memory, which
// the server has little of.
sharp.cache(false)

// The most pixels a photo can have to be resized, e.g. a 100 MP camera's, far more than a photo of up to PHOTO_MAX_BYTES
// usually has, unless it compresses very well, e.g. a flat image. Resizing a PNG of this many pixels, which can't be
// decoded smaller than it is, as a JPEG can, takes about 120 MB more.
const MAX_INPUT_PIXELS = 100_000_000

// How many photos are resized at once, at most, by the same server: the others wait their turn (see `takingTurns`).
// Resizing one holds it in memory, up to PHOTO_MAX_BYTES, as it was read, and decoding it can take up to about 120 MB
// more (see MAX_INPUT_PIXELS), so that the server, which has 1 GB of memory, would run out of it resizing many at once,
// e.g. the first time a page shows many photos that don't have their sizes yet. The server has 2 CPUs, which this keeps
// busy.
export const RESIZED_AT_ONCE = 2

// The largest width or height a WebP image can have.
const WEBP_MAX_DIMENSION = 16383

// The type of every size.
export const SIZE_TYPE = 'image/webp'

// Where the size of a photo is kept: next to it, under its key with a suffix. The suffix names how the size is encoded,
// and has to change when that does: sizes are made only once, so those already made would otherwise be served as they
// are.
export function sizeKey(key: string, width: PhotoWidth): string {
  return `${key}.w${width}.webp`
}

// The photo at `width`, or narrower when it is, as WebP, upright as its EXIF orientation says, and without any of its
// metadata, which sharp drops unless told to keep it. Throws when the photo can't be decoded, or is too large.
export async function resize(photo: Buffer, width: PhotoWidth): Promise<Buffer> {
  return sharp(photo, { limitInputPixels: MAX_INPUT_PIXELS })
    .autoOrient()
    .resize({ width, height: WEBP_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
}

// Runs the work it's given, `atOnce` at a time at most: the rest waits its turn, in order.
export function takingTurns(atOnce: number) {
  let running = 0
  const waiting: (() => void)[] = []
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (running < atOnce) running++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await work()
    } finally {
      // Its turn goes to the next one waiting, if there's one.
      const next = waiting.shift()
      if (next) next()
      else running--
    }
  }
}
