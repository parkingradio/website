import { Readable } from 'node:stream'
import { vi } from 'vitest'
import sharp from 'sharp'
import type { PhotoWidth } from './sizes.js'
import type { PhotoFolder, Photos, SentPhoto } from './store.js'

// For the tests of the routes that store and serve photos and flyers: they're kept in `stored`, by key, as the bucket
// would keep them, under keys named after `name`, e.g. "artists/photo-1.jpeg", counted from 1 again after `reset`. Their
// sizes are made up (see `fakeSize`) rather than resized, which store.test.ts and sizes.test.ts cover.
export function memoryPhotos(name = 'photo') {
  const stored = new Map<string, Buffer>()
  let next = 0
  return {
    stored,
    reset() {
      stored.clear()
      next = 0
    },
    store: vi.fn(async ({ body, type }: SentPhoto, folder: PhotoFolder) => {
      const key = `${folder}/${name}-${++next}.${type.split('/')[1]}`
      stored.set(key, body)
      return key
    }),
    read: vi.fn(async (key: string) => (stored.has(key) ? Readable.from([stored.get(key)!]) : null)),
    sized: vi.fn<Photos['sized']>(async (key, width) => {
      const photo = stored.get(key)
      return photo ? fakeSize(photo, width) : null
    }),
    delete: vi.fn(async (key: string) => {
      stored.delete(key)
    }),
  } satisfies Photos & Record<string, unknown>
}

// The smallest thing that starts like a JPEG image, which is all the type check needs, though it can't be decoded.
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])

// What the photos above give as the size of `photo` at `width`.
export function fakeSize(photo: Buffer, width: PhotoWidth): Buffer {
  return Buffer.concat([Buffer.from(`${width}:`), photo])
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
