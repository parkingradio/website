import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config } from './config.js'

// The app's private files, e.g. artists' photos, which only the server reads (see private-bucket.tf). They're kept in
// the private S3 bucket, or, without one (e.g. in development), in a local directory, under the same keys.
export type PrivateFiles = {
  // Stores the file under `key`, replacing any file that was there.
  put(key: string, body: Buffer, contentType: string): Promise<void>
  // The file with that key, or null if there's none.
  read(key: string): Promise<Readable | null>
  // Deletes the file with that key, if there's one. The bucket keeps it for as long as the database's backups, and
  // it's gone for good after that (see private-bucket.tf).
  delete(key: string): Promise<void>
}

// The private files, kept where `config.privateFiles` says.
export function privateBucket(where: typeof config.privateFiles): PrivateFiles {
  if ('bucket' in where) {
    const s3 = new S3Client({ region: config.awsRegion })
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

      async delete(key) {
        await s3.send(new DeleteObjectCommand({ Bucket: where.bucket, Key: key }))
      },
    }
  }

  const file = (key: string) => path.join(where.directory, key)
  return {
    async put(key, body) {
      await mkdir(path.dirname(file(key)), { recursive: true })
      await writeFile(file(key), body)
    },

    async read(key) {
      try {
        return (await open(file(key))).createReadStream()
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
        throw error
      }
    },

    async delete(key) {
      await rm(file(key), { force: true })
    },
  }
}
