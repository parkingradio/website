import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { expect, vi } from 'vitest'
import sharp from 'sharp'
import { PHOTO_WIDTHS, sizeKey, sizeName } from './sizes.js'
import type { PhotoWidth } from './sizes.js'
import { EXTENSIONS } from './keys.js'
import type { PhotoFolder } from './keys.js'
import type { NewPhoto, Photos, SizedPhoto } from './store.js'

// For the tests of the routes that store and serve photos and flyers: they're kept in `stored`, by key, with their
// sizes under theirs, as the bucket would keep them, under keys named from their count, by `named`, e.g.
// "artists/photo-1.jpg", counted from 1 again after `reset`, rather than made from their content, and deleted whether
// or not something uses them: what the bucket and the database do with them is tested on them (see
// artists/photos.db.test.ts).
export function memoryPhotos(named = (count: number) => `photo-${count}`) {
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
      const key = `${folder}/${named(++next)}.${EXTENSIONS[type]}`
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
    photos: () => [...stored.keys()].filter((key) => !PHOTO_WIDTHS.some((width) => key.endsWith(`.${sizeName(width)}`))),
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

// The colour of `testImage`, in sRGB.
export const TEST_COLOUR = [228, 87, 46]

// An image of one colour, `width` by `height`, in `format`, with EXIF that tells where it was taken and on what, with
// "PLANTED-MAKE" and "PLANTED-GPS" in it, so that tests can tell it's gone, an ICC profile, and the EXIF orientation 6
// when it's `rotated`, which says to turn it a quarter clockwise, as phones do for portraits.
export async function testImage(
  format: 'jpeg' | 'png' | 'webp',
  width: number,
  height: number,
  { rotated = false, alpha = false }: { rotated?: boolean; alpha?: boolean } = {},
): Promise<Buffer> {
  const [r, g, b] = TEST_COLOUR
  const image = sharp({ create: { width, height, channels: alpha ? 4 : 3, background: { r, g, b, alpha: alpha ? 0.5 : 1 } } })
    .withExif({ IFD0: { Make: 'PLANTED-MAKE' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '46/1 48/1 0/1', GPSMapDatum: 'PLANTED-GPS' } })
    .withIccProfile('p3')
  return (rotated ? image.withMetadata({ orientation: 6 }) : image)[format]().toBuffer()
}

// Images with and without a profile, 8-bit and 16-bit, by name, with the colour each one is, in sRGB, to check that
// what's made from them keeps it (see `readPhoto` in sizes.ts): `testImage`'s colour, which `testImage` makes in
// Display P3, where it's about (212, 96, 59), and a grey whose profile has a gamma of 1.8, far enough from sRGB's that
// it's another grey when the profile is ignored.
export async function colourTestImages(): Promise<Record<string, { image: Buffer; colour: number[] }>> {
  const p3 = await testImage('png', 64, 64)
  const [r, g, b] = TEST_COLOUR
  const srgb = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } })
  const grey = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#787878' } }).toColourspace('b-w').jpeg().toBuffer()
  const colour = TEST_COLOUR
  return {
    p3: { image: p3, colour },
    'p3 16-bit': { image: await sharp(p3).keepIccProfile().toColourspace('rgb16').png().toBuffer(), colour },
    'sRGB, with its profile': { image: await srgb().withIccProfile('srgb').jpeg().toBuffer(), colour },
    'sRGB 16-bit, with its profile': { image: await srgb().toColourspace('rgb16').withIccProfile('srgb').png().toBuffer(), colour },
    'sRGB 16-bit, without a profile': { image: await srgb().toColourspace('rgb16').png().toBuffer(), colour },
    // 120 at gamma 1.8 is 139 in sRGB.
    'grey, with a profile of gamma 1.8': { image: withJpegProfile(grey, greyProfile(1.8)), colour: [139, 139, 139] },
  }
}

// An ICC profile for greyscale of gamma `gamma`, built by hand, since neither sharp nor CI has one: a header, and a
// description, a white point and the grey's curve.
function greyProfile(gamma: number): Buffer {
  const uint32 = (value: number) => {
    const bytes = Buffer.alloc(4)
    bytes.writeUInt32BE(value)
    return bytes
  }
  const d50 = Buffer.concat([0.9642, 1, 0.8249].map((value) => uint32(Math.round(value * 65536))))
  const tags = Object.entries({
    desc: Buffer.concat([Buffer.from('desc\0\0\0\0', 'latin1'), uint32(2), Buffer.from('g', 'latin1'), Buffer.alloc(79)]),
    wtpt: Buffer.concat([Buffer.from('XYZ \0\0\0\0', 'latin1'), d50]),
    kTRC: Buffer.concat([Buffer.from('curv\0\0\0\0', 'latin1'), uint32(1), uint32(Math.round(gamma * 256) << 16)]),
  })
  const table = [uint32(tags.length)]
  let offset = 128 + 4 + 12 * tags.length
  for (const [signature, tag] of tags) {
    table.push(Buffer.from(signature, 'latin1'), uint32(offset), uint32(tag.length))
    offset += tag.length
  }
  const header = Buffer.alloc(128)
  header.writeUInt32BE(offset, 0)
  header.writeUInt32BE(0x02100000, 8)
  header.write('mntrGRAYXYZ ', 12, 'latin1')
  header.write('acsp', 36, 'latin1')
  d50.copy(header, 68)
  return Buffer.concat([header, ...table, ...tags.map(([, tag]) => tag)])
}

// `jpeg` with `profile` embedded, in an APP2 segment right after its start.
function withJpegProfile(jpeg: Buffer, profile: Buffer): Buffer {
  const segment = Buffer.concat([Buffer.from([0xff, 0xe2, 0, 0]), Buffer.from('ICC_PROFILE\0\x01\x01', 'latin1'), profile])
  segment.writeUInt16BE(segment.length - 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
}

// Images of Display P3's pure green, a colour outside sRGB, 8-bit and 16-bit, in Display P3, by name. sharp takes the
// colour it's given to be in Display P3 when it works in 16 bits, and only tags it with the profile.
export async function wideGamutTestImages(): Promise<Record<string, Buffer>> {
  const green = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 255, b: 0 } } }).pipelineColourspace('rgb16').withIccProfile('p3')
  return { p3: await green().png().toBuffer(), 'p3 16-bit': await green().toColourspace('rgb16').png().toBuffer() }
}

// Expects the pixel at the top left of `image` to be `rgb`, give or take `tolerance` on each channel: in sRGB, converted
// from its profile when it has one, as browsers show it, or, when `stored`, as it's stored, in its profile.
export async function expectColour(image: Buffer, rgb: number[], tolerance: number, name?: string, { stored = false } = {}) {
  const actual = [...(await sharp(image, { ignoreIcc: stored }).raw().toBuffer()).subarray(0, 3)]
  rgb.forEach((value, channel) => {
    expect(Math.abs(actual[channel] - value), `${name ?? 'image'}: channel ${channel} of ${actual}`).toBeLessThanOrEqual(tolerance)
  })
}

// The keys of the files kept in `directory`, as the private files keep them there without a bucket (see
// core/private-bucket.ts), in order.
export async function keptFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort()
}
