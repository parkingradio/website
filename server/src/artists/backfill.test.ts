import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buffer } from 'node:stream/consumers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import sharp from 'sharp'
import { privateBucket } from '../core/private-bucket.js'
import type { PrivateFiles } from '../core/private-bucket.js'
import { sizesBackfill } from './backfill.js'
import type { StoredImage } from './backfill.js'
import { sizeKey } from './sizes.js'
import { testImage } from './test-photos.js'

// Making the sizes that the photos and flyers the server keeps don't have, when it starts (see "Photos" in
// docs/design/server/artists.md).

describe('sizesBackfill', () => {
  let directory: string
  let files: PrivateFiles
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const logger = log as unknown as FastifyBaseLogger

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'backfill-'))
    files = privateBucket({ directory })
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const kept = async () =>
    (await readdir(directory, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
      .sort()

  // Runs it, as the server does, through `files` unless it's given others, until it's done.
  async function backfill(images: StoredImage[], through = files) {
    const run = sizesBackfill(async () => images, through, logger)
    run.start()
    await run.stopped()
  }

  // The files, but each photo is deleted, with its sizes, as soon as it's read, as if it were while its sizes are made,
  // before they're stored.
  const deletingOnRead = (others: Partial<PrivateFiles> = {}): PrivateFiles => ({
    ...files,
    read: async (key) => {
      const read = await files.read(key)
      if (read) await files.delete(key)
      return read
    },
    ...others,
  })

  const width = async (key: string) => (await sharp(await buffer((await files.read(key))!)).metadata()).width

  it('makes the sizes that photos and flyers do not have, and only those', async () => {
    await files.put('artists/a.jpg', await testImage('jpeg', 2000, 1000), 'image/jpeg')
    await files.put('sessions/s.png', await testImage('png', 2000, 1000), 'image/png')
    await files.put(sizeKey('sessions/s.png', 320), Buffer.from('kept'), 'image/webp')
    await files.put('collectives/c.webp', await testImage('webp', 640, 480), 'image/webp')
    await files.put(sizeKey('collectives/c.webp', 320), Buffer.from('kept'), 'image/webp')
    await files.put(sizeKey('collectives/c.webp', 1280), Buffer.from('kept'), 'image/webp')
    const put = vi.spyOn(files, 'put')

    await backfill([
      { of: 'session', id: 's', key: 'sessions/s.png' },
      { of: 'artist', id: 'a', key: 'artists/a.jpg' },
      { of: 'collective', id: 'c', key: 'collectives/c.webp' },
    ])

    expect(await width(sizeKey('artists/a.jpg', 320))).toBe(320)
    expect(await width(sizeKey('artists/a.jpg', 1280))).toBe(1280)
    expect(await width(sizeKey('sessions/s.png', 1280))).toBe(1280)
    // Those it had are kept as they are.
    expect(put.mock.calls.map(([key]) => key).sort()).toEqual(
      [sizeKey('artists/a.jpg', 320), sizeKey('artists/a.jpg', 1280), sizeKey('sessions/s.png', 1280)].sort(),
    )
    expect(await buffer((await files.read(sizeKey('sessions/s.png', 320)))!)).toEqual(Buffer.from('kept'))
    expect(log.info).toHaveBeenLastCalledWith({ complete: 1, made: 2, missing: 0, unreadable: 0, failed: 0 }, 'Made the missing sizes of photos and flyers')
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
  })

  it("skips the photos that can't be read or are missing, and those it fails to make the sizes of, logging them", async () => {
    const photo = await testImage('jpeg', 640, 480)
    await files.put('artists/cut.jpg', photo.subarray(0, photo.length / 2), 'image/jpeg')
    await files.put('artists/failing.jpg', photo, 'image/jpeg')
    await files.put('artists/fine.jpg', photo, 'image/jpeg')
    const failing: PrivateFiles = {
      ...files,
      put: async (key, ...rest) => (key.startsWith('artists/failing') ? Promise.reject(new Error('S3 is down')) : files.put(key, ...rest)),
    }

    await backfill(
      [
        { of: 'artist', id: 'cut', key: 'artists/cut.jpg' },
        { of: 'collective', id: 'gone', key: 'collectives/gone.jpg' },
        { of: 'artist', id: 'failing', key: 'artists/failing.jpg' },
        { of: 'artist', id: 'fine', key: 'artists/fine.jpg' },
      ],
      failing,
    )

    expect(await kept()).toEqual(['artists/cut.jpg', 'artists/failing.jpg', 'artists/fine.jpg', sizeKey('artists/fine.jpg', 1280), sizeKey('artists/fine.jpg', 320)])
    expect(log.warn).toHaveBeenCalledOnce()
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ of: 'artist', id: 'cut', key: 'artists/cut.jpg', err: expect.any(Error) }),
      "Can't make the sizes of a photo or flyer: it can't be read",
    )
    expect(log.info).toHaveBeenCalledWith({ of: 'collective', id: 'gone', key: 'collectives/gone.jpg' }, expect.stringMatching(/missing too/))
    expect(log.error).toHaveBeenCalledOnce()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ of: 'artist', id: 'failing', key: 'artists/failing.jpg' }),
      'Failed to make the sizes of a photo or flyer',
    )
    expect(log.info).toHaveBeenLastCalledWith({ complete: 0, made: 1, missing: 1, unreadable: 1, failed: 1 }, 'Made the missing sizes of photos and flyers')
  })

  it('deletes the sizes it made of a photo that was deleted meanwhile', async () => {
    await files.put('artists/a.jpg', await testImage('jpeg', 640, 480), 'image/jpeg')
    await backfill([{ of: 'artist', id: 'a', key: 'artists/a.jpg' }], deletingOnRead())
    expect(await kept()).toEqual([])
    expect(log.error).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenLastCalledWith(expect.objectContaining({ made: 0, missing: 1 }), 'Made the missing sizes of photos and flyers')
  })

  it('logs a size of a deleted photo that it fails to delete', async () => {
    await files.put('artists/a.jpg', await testImage('jpeg', 640, 480), 'image/jpeg')
    await backfill([{ of: 'artist', id: 'a', key: 'artists/a.jpg' }], deletingOnRead({ delete: async () => Promise.reject(new Error('S3 is down')) }))
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      { err: expect.any(Error), key: 'artists/a.jpg' },
      'Failed to delete the size of a photo that may have been deleted',
    )
  })

  it('logs, rather than throws, when it fails to list the photos', async () => {
    const run = sizesBackfill(async () => Promise.reject(new Error('The database is down')), files, logger)
    run.start()
    await run.stopped()
    expect(log.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Failed to make the missing sizes of photos and flyers')
  })

  it('stops before the next photo once it is asked to, after the one it is making', async () => {
    for (const name of ['a', 'b', 'c']) await files.put(`artists/${name}.jpg`, await testImage('jpeg', 640, 480), 'image/jpeg')
    const run = sizesBackfill(
      async () => ['a', 'b', 'c'].map((id) => ({ of: 'artist' as const, id, key: `artists/${id}.jpg` })),
      {
        ...files,
        // Asked to stop while it makes the sizes of the first one.
        read: async (key) => {
          run.stop()
          return files.read(key)
        },
      },
      logger,
    )
    run.start()
    await run.stopped()
    expect(await kept()).toEqual(['artists/a.jpg', sizeKey('artists/a.jpg', 1280), sizeKey('artists/a.jpg', 320), 'artists/b.jpg', 'artists/c.jpg'])
    expect(log.info).toHaveBeenLastCalledWith(expect.objectContaining({ made: 1 }), 'Stopped making the missing sizes of photos and flyers')
  })
})
