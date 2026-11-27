// The sizes of photos and flyers that the server makes and serves (see "Photos" in docs/design/server/artists.md): their
// widths, names and keys. They're made by `makeSizes` in images.ts.

// The widths they're served at, in pixels: thumbnails, and pages where the image is the content.
export const PHOTO_WIDTHS = [320, 1280] as const
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number]

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
