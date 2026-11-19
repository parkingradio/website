import { randomUUID } from 'node:crypto'
import { access, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config } from './config.js'

// The app's private files, e.g. artists' photos, which only the server reads (see private-bucket.tf). They're kept in
// the private S3 bucket, or, without one (e.g. in development), in a local directory, under the same keys.
export type PrivateFiles = {
  // Stores the file under `key`, replacing any file that was there.
  put(key: string, body: Buffer, contentType: string): Promise<void>
  // The file with that key, or null if there's none.
  read(key: string): Promise<Readable | null>
  // Whether there's a file with that key.
  exists(key: string): Promise<boolean>
  // Deletes the file with that key, if there's one. The bucket keeps it for as long as the database's backups, and
  // it's gone for good after that (see private-bucket.tf).
  delete(key: string): Promise<void>
}

// The private files, kept where `config.privateFiles` says.
export function privateBucket(where: typeof config.privateFiles): PrivateFiles {
  if ('bucket' in where) {
    // A request that stalls fails rather than holding up what waits for it, e.g. the resizing of photos, which reads them
    // a few at a time (see `takingTurns` in artists/sizes.ts): when connecting, waiting for the response, or reading it
    // without anything coming for a while, though a large file can take longer in all.
    const s3 = new S3Client({
      region: config.awsRegion,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000, throwOnRequestTimeout: true, socketTimeout: 30_000 },
    })
    return {
      async put(key, body, contentType) {
        await s3.send(new PutObjectCommand({ Bucket: where.bucket, Key: key, Body: body, ContentType: contentType }))
      },

      async read(key) {
        try {
          const { Body } = await s3.send(new GetObjectCommand({ Bucket: where.bucket, Key: key }))
          return Body as Readable
        } catch (error) {
          // S3 only says a file doesn't exist to those who may list the bucket (see private-bucket.tf). It says
          // access is denied to everyone else, which mustn't be taken for a missing file.
          if (error instanceof NoSuchKey) return null
          throw error
        }
      },

      async exists(key) {
        try {
          await s3.send(new HeadObjectCommand({ Bucket: where.bucket, Key: key }))
          return true
        } catch (error) {
          // A HEAD response has no body, so S3 can't say NoSuchKey: it's only NotFound, which, like NoSuchKey, it only
          // says to those who may list the bucket.
          if (error instanceof NotFound) return false
          throw error
        }
      },

      async delete(key) {
        await s3.send(new DeleteObjectCommand({ Bucket: where.bucket, Key: key }))
      },
    }
  }

  const file = (key: string) => path.join(where.directory, key)
  return {
    // Written next to where it goes, then moved there, so that it's never read half-written, as S3 never shows it.
    async put(key, body) {
      await mkdir(path.dirname(file(key)), { recursive: true })
      const written = `${file(key)}.${randomUUID()}.tmp`
      try {
        await writeFile(written, body)
        await rename(written, file(key))
      } catch (error) {
        await rm(written, { force: true })
        throw error
      }
    },

    async read(key) {
      try {
        return (await open(file(key))).createReadStream()
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },

    async exists(key) {
      try {
        await access(file(key))
        return true
      } catch (error) {
        if (isMissing(error)) return false
        throw error
      }
    },

    async delete(key) {
      await rm(file(key), { force: true })
    },
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
