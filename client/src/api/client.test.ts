import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../test-utils'
import { api, formData } from './client'
import { useApi } from './use-api'

const FEATURE = { id: 'nouveau-lecteur', enabled: true, updatedBy: 'admin@example.com', updatedAt: '2026-10-09T16:30:00.000Z' }

describe('api', () => {
  it('returns the response with `ok: true` when the request succeeds', async () => {
    mockFetch()
    expect(await api.GET('/api/config')).toEqual({
      ok: true,
      assetsDomain: 'assets.example.test',
      turnstileSiteKey: '1x00000000000000000000AA',
      features: {},
    })
  })

  it('sends the path parameters in the URL, and the body as JSON', async () => {
    mockFetch({ 'PUT /api/admin/features/nouveau-lecteur': { ok: true, feature: FEATURE } })
    const result = await api.PUT('/api/admin/features/{id}', { params: { path: { id: 'nouveau-lecteur' } }, body: { enabled: true } })
    expect(result).toEqual({ ok: true, feature: FEATURE })
    const [request] = requestsTo('PUT', '/api/admin/features/nouveau-lecteur')
    expect(jsonBody(request)).toEqual({ enabled: true })
    expect(new Headers(request.headers).get('Content-Type')).toBe('application/json')
  })

  it('sends a multipart/form-data body with `formData`: files as they are, objects as JSON, and nothing for undefined', async () => {
    mockFetch({ 'PUT /api/admin/artists/artist-1': { ok: false, error: 'Stop' } })
    const photo = new File(['photo'], 'photo.png', { type: 'image/png' })
    const artist = { kind: 'artist' as const, name: 'Aurore', bio: 'Une bio.', email: 'aurore@example.com' }
    await api.PUT('/api/admin/artists/{id}', { params: { path: { id: 'artist-1' } }, body: { artist, photo, removePhoto: undefined }, bodySerializer: formData })
    const form = requestsTo('PUT', '/api/admin/artists/artist-1')[0].body as FormData
    expect(form.get('artist')).toBe(JSON.stringify(artist))
    expect(form.get('photo')).toBe(photo)
    expect(form.has('removePhoto')).toBe(false)
  })

  it('only sends a multipart/form-data body with `formData`', () => {
    const typeCheck = () => {
      const artist = { kind: 'artist' as const, name: 'Aurore', bio: 'Une bio.', email: 'aurore@example.com' }
      // @ts-expect-error: as JSON.
      void api.POST('/api/admin/artists', { body: { artist } })
      // @ts-expect-error: a JSON body.
      void api.PUT('/api/admin/features/{id}', { params: { path: { id: 'x' } }, body: { enabled: true }, bodySerializer: formData })
    }
    expect(typeCheck).toBeTypeOf('function')
  })

  it("returns the server's error when the request fails", async () => {
    mockFetch({ '/api/admin/features': { ok: false, error: 'Unauthorized' } })
    expect(await api.GET('/api/admin/features')).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it("returns an error, rather than throwing, when the response isn't the API's", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Request Entity Too Large</html>', { status: 413 })))
    expect(await api.GET('/api/admin/features')).toEqual({ ok: false, error: 'Erreur inconnue' })
  })

  it("returns an error, rather than throwing, when the server can't be reached", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await api.GET('/api/admin/features')).toEqual({ ok: false, error: 'Failed to fetch' })
  })
})

describe('useApi', () => {
  it('loads the response, and loads it again when the version changes', async () => {
    mockFetch({ '/api/admin/features': { ok: true, features: [FEATURE] } })
    const { result, rerender } = renderHook(({ version }) => useApi('/api/admin/features', { version }), {
      initialProps: { version: 0 },
    })
    expect(result.current).toEqual({ kind: 'loading' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', value: { ok: true, features: [FEATURE] } }))

    mockFetch({ '/api/admin/features': { ok: true, features: [] } })
    rerender({ version: 1 })
    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', value: { ok: true, features: [] } }))
  })

  it('says why the response could not be loaded', async () => {
    mockFetch({ '/api/admin/features': { ok: false, error: 'Unauthorized' } })
    const { result } = renderHook(() => useApi('/api/admin/features'))
    await waitFor(() => expect(result.current).toEqual({ kind: 'error', message: 'Unauthorized' }))
  })
})
