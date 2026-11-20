import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { vi } from 'vitest'
import sharp from 'sharp'
import { PHOTO_WIDTHS, sizeKey } from './sizes.js'
import type { PhotoWidth } from './sizes.js'
import type { NewPhoto, PhotoFolder, Photos, SizedPhoto } from './store.js'

// For the tests of the routes that store and serve photos and flyers: they're kept in `stored`, by key, with their sizes
// under theirs, as the bucket would keep them, under keys named after `name`, e.g. "artists/photo-1.jpeg", counted from 1
// again after `reset`, rather than made from their content, and deleted whether or not something uses them: what the
// bucket and the database do with them is tested on them (see artists/photos.db.test.ts).
export function memoryPhotos(name = 'photo') {
  const stored = new Map<string, Buffer>()
  let next = 0
  const read = (key: string) => (stored.has(key) ? Readable.from([stored.get(key)!]) : null)
  return {
    stored,
    reset() {
      stored.clear()
      next = 0
    },
    store: vi.fn(async ({ body, type, sizes }: SizedPhoto, folder: PhotoFolder): Promise<NewPhoto> => {
      const key = `${folder}/${name}-${++next}.${type.split('/')[1]}`
      stored.set(key, body)
      for (const [width, size] of sizes) stored.set(sizeKey(key, width), size)
      return { key, type, keep: async () => {} }
    }),
    read: vi.fn(async (key: string) => read(key)),
    readSize: vi.fn<Photos['readSize']>(async (key, width) => read(sizeKey(key, width))),
    deleteUnused: vi.fn(async (key: string) => {
      stored.delete(key)
      for (const width of PHOTO_WIDTHS) stored.delete(sizeKey(key, width))
    }),
    // The photos that are stored, without their sizes.
    photos: () => [...stored.keys()].filter((key) => !/\.w\d+\.webp$/.test(key)),
    // The size at `width` of the photo with `key`, as it was stored with it.
    size: (key: string, width: PhotoWidth) => stored.get(sizeKey(key, width)),
  } satisfies Photos & Record<string, unknown>
}

// Small images of one colour, which can be read, and their sizes made: a JPEG, a PNG, and a JPEG cut short, which
// starts like one, and so passes the check of its type, but can't be read.
export const JPEG = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#e4572e' } }).jpeg().toBuffer()
export const PNG = await sharp({ create: { width: 48, height: 64, channels: 3, background: '#2e86ab' } }).png().toBuffer()
export const UNREADABLE_JPEG = JPEG.subarray(0, JPEG.length / 2)

// For the tests that never send photos or flyers: storing one fails, and there are none to read.
export const NO_PHOTOS: Photos = {
  store: async () => {
    throw new Error('No photos or flyers in these tests')
  },
  read: async () => null,
  readSize: async () => null,
  deleteUnused: async () => {},
}

// An image of one colour, `width` by `height`, in `format`, with EXIF that tells where it was taken and on what, with
// "PLANTED-MAKE" and "PLANTED-GPS" in it, so that tests can tell it's gone, an ICC profile, and the EXIF orientation 6
// when it's `rotated`, which says to turn it a quarter clockwise, as phones do for portraits.
export async function testImage(
  format: 'jpeg' | 'png' | 'webp',
  width: number,
  height: number,
  { rotated = false, alpha = false }: { rotated?: boolean; alpha?: boolean } = {},
): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: alpha ? 4 : 3, background: { r: 228, g: 87, b: 46, alpha: alpha ? 0.5 : 1 } } })
    .withExif({ IFD0: { Make: 'PLANTED-MAKE' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '46/1 48/1 0/1', GPSMapDatum: 'PLANTED-GPS' } })
    .withIccProfile('p3')
  return (rotated ? image.withMetadata({ orientation: 6 }) : image)[format]().toBuffer()
}

// The keys of the files kept in `directory`, as the private files keep them there without a bucket (see
// core/private-bucket.ts), in order.
export async function keptFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort()
}
