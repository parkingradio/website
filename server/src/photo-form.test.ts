import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'

import { readPhotoForm } from './photo-form.js'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])

// A multipart/form-data body with a field, and a file part named "photo" for each of `photos`.
function form(photos: Buffer[]) {
  const boundary = 'test-boundary'
  const chunks = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="artist"\r\n\r\n{}\r\n`)]
  for (const photo of photos) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo"\r\nContent-Type: image/jpeg\r\n\r\n`),
      photo,
      Buffer.from('\r\n'),
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

describe('readPhotoForm', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  // These go through a real connection, unlike `inject`, so that they see what's left of a request on it.
  it('reads the rest of a request with more than one photo, so that its connection can be used for the next one', async () => {
    app = Fastify()
    await app.register(multipart)
    app.post('/form', async (request) => {
      const form = await readPhotoForm(request)
      return { form: typeof form === 'string' ? form : 'read' }
    })
    app.get('/next', async () => ({ next: true }))
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo

    // A single connection, kept alive, for both requests.
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    const send = (method: string, path: string, body?: { body: Buffer; contentType: string }) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = http.request(
          { host: '127.0.0.1', port, method, path, agent, headers: body ? { 'content-type': body.contentType } : {} },
          (response) => {
            let text = ''
            response.on('data', (chunk) => (text += chunk))
            response.on('end', () => resolve({ status: response.statusCode!, body: text }))
          },
        )
        request.setTimeout(3_000, () => request.destroy(new Error(`No response to ${method} ${path}`)))
        request.on('error', reject)
        request.end(body?.body)
      })

    try {
      // The second photo is larger than what the connection buffers, so that it can't have been read by accident.
      const twoPhotos = await send('POST', '/form', form([JPEG, Buffer.concat([JPEG, Buffer.alloc(4 * 1024 * 1024)])]))
      expect(twoPhotos).toEqual({ status: 200, body: JSON.stringify({ form: 'malformed' }) })
      expect(await send('GET', '/next')).toEqual({ status: 200, body: JSON.stringify({ next: true }) })
    } finally {
      agent.destroy()
    }
  })
})
