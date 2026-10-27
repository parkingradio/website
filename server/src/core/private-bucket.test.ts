import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3'
import { privateBucket } from './private-bucket.js'

describe('privateBucket', () => {
  describe('in a local directory', () => {
    let directory: string

    beforeEach(async () => {
      directory = await mkdtemp(path.join(tmpdir(), 'private-bucket-'))
    })

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true })
    })

    it('keeps files under their keys, and deletes them', async () => {
      const files = privateBucket({ directory })
      await files.put('artists/a.jpg', Buffer.from('photo'), 'image/jpeg')
      expect(await readFile(path.join(directory, 'artists/a.jpg'), 'utf8')).toBe('photo')
      expect(await buffer((await files.read('artists/a.jpg'))!)).toEqual(Buffer.from('photo'))

      await files.delete('artists/a.jpg')
      expect(await files.read('artists/a.jpg')).toBeNull()
      // Deleting a file that isn't there is fine.
      await files.delete('artists/a.jpg')
    })
  })

  describe('in an S3 bucket', () => {
    const send = vi.spyOn(S3Client.prototype, 'send')
    const files = privateBucket({ bucket: 'parking-radio-test-private' })

    beforeEach(() => {
      send.mockReset()
    })

    it('puts, reads and deletes objects under their keys', async () => {
      send.mockResolvedValue({} as never)
      await files.put('artists/a.jpg', Buffer.from('photo'), 'image/jpeg')
      const put = send.mock.calls[0][0]
      expect(put).toBeInstanceOf(PutObjectCommand)
      expect(put.input).toEqual({ Bucket: 'parking-radio-test-private', Key: 'artists/a.jpg', Body: Buffer.from('photo'), ContentType: 'image/jpeg' })

      const body = {} as Readable
      send.mockResolvedValueOnce({ Body: body } as never)
      expect(await files.read('artists/a.jpg')).toBe(body)
      expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand)
      expect(send.mock.calls[1][0].input).toEqual({ Bucket: 'parking-radio-test-private', Key: 'artists/a.jpg' })

      await files.delete('artists/a.jpg')
      expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand)
      expect(send.mock.calls[2][0].input).toEqual({ Bucket: 'parking-radio-test-private', Key: 'artists/a.jpg' })
    })

    it("reads a missing object as null, but not one it's denied access to", async () => {
      send.mockRejectedValueOnce(new NoSuchKey({ message: 'The specified key does not exist.', $metadata: {} }))
      expect(await files.read('artists/missing.jpg')).toBeNull()

      const denied = new S3ServiceException({ name: 'AccessDenied', message: 'Access Denied', $fault: 'client', $metadata: {} })
      send.mockRejectedValueOnce(denied)
      await expect(files.read('artists/a.jpg')).rejects.toBe(denied)
    })
  })
})
