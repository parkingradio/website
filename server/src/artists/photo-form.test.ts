import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'

import { useZodSchemas, zodRoutes } from '../api/schemas.js'
import { photoRoute, readPhotoForm, sendPhoto } from './photo-form.js'
import { withSizes } from './store.js'
import { JPEG, memoryPhotos } from './test-photos.js'

// A multipart/form-data body with a field, and a file part named "photo" for each of `photos`.
function form(photos: Buffer[]) {
  const boundary = 'test-boundary'
  const chunks: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="artist"\r\n\r\n{}\r\n`)]
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

describe('sendPhoto', () => {
  it('never serves the public a photo as it was sent, nor serves a photo on a route that does not say who it is for', async () => {
    const app = Fastify()
    useZodSchemas(app)
    const photos = memoryPhotos()
    const { key } = await photos.store(await withSizes({ body: JPEG, type: 'image/jpeg' }), 'artists')
    const row = { photoKey: key, photoType: 'image/jpeg' }
    const api = zodRoutes(app)
    // As if its schema let a request without `width` through.
    api.get('/public/:id', photoRoute('artist', 'public', { summary: 'A photo', tags: [] }), (_, reply) => sendPhoto(reply, photos, row, 'artist', undefined))
    api.get('/sized/:id', photoRoute('artist', 'public', { summary: 'A photo', tags: [] }), (request, reply) => sendPhoto(reply, photos, row, 'artist', request.query.width))
    app.get('/other/:id', { schema: { summary: 'A photo' } }, (_, reply) => sendPhoto(reply, photos, row, 'artist', 320))
    expect((await app.inject('/public/1')).statusCode).toBe(500)
    expect((await app.inject('/other/1')).statusCode).toBe(500)
    expect(photos.read).not.toHaveBeenCalled()
    expect(photos.readSize).not.toHaveBeenCalled()
    expect((await app.inject('/sized/1')).statusCode).toBe(200)
    await app.close()
  })
})
