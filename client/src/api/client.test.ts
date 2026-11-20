import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CONFIG, UNAUTHORIZED, jsonBody, mockFetch, requestsTo } from '../test-utils'
import { api, formData, onSessionEnded } from './client'
import { useApi } from './use-api'

const FEATURE = { id: 'some-flag', enabled: true, updatedBy: 'admin@example.com', updatedAt: '2026-10-09T16:30:00.000Z' }

describe('api', () => {
  it('returns the response with `ok: true` when the request succeeds', async () => {
    mockFetch()
    expect(await api.GET('/api/config')).toEqual({ ok: true, ...CONFIG })
  })

  it('sends the path parameters in the URL, and the body as JSON', async () => {
    mockFetch({ 'PUT /api/admin/features/some-flag': { ok: true, feature: FEATURE } })
    const result = await api.PUT('/api/admin/features/{id}', { params: { path: { id: 'some-flag' } }, body: { enabled: true } })
    expect(result).toEqual({ ok: true, feature: FEATURE })
    const [request] = requestsTo('PUT', '/api/admin/features/some-flag')
    expect(jsonBody(request)).toEqual({ enabled: true })
    expect(new Headers(request.headers).get('Content-Type')).toBe('application/json')
  })

  it('sends the fields that PATCH changes as JSON', async () => {
    mockFetch({ 'PATCH /api/admin/sessions/session-1': { ok: false, error: 'Stop' } })
    await api.PATCH('/api/admin/sessions/{id}', { params: { path: { id: 'session-1' } }, body: { raEvent: '6683745' } })
    const [request] = requestsTo('PATCH', '/api/admin/sessions/session-1')
    expect(jsonBody(request)).toEqual({ raEvent: '6683745' })
    expect(new Headers(request.headers).get('Content-Type')).toBe('application/json')
  })

  it('sends a multipart/form-data body with `formData`: files as they are, objects as JSON, and nothing for undefined', async () => {
    mockFetch({ 'POST /api/admin/artists': { ok: false, error: 'Stop' } })
    const photo = new File(['photo'], 'photo.png', { type: 'image/png' })
    const artist = { name: 'Aurore', bio: 'Une bio.', email: 'aurore@example.com' }
    await api.POST('/api/admin/artists', { body: { artist, photo }, bodySerializer: formData })
    await api.POST('/api/admin/artists', { body: { artist, photo: undefined }, bodySerializer: formData })
    const [withPhoto, without] = requestsTo('POST', '/api/admin/artists').map((request) => request.body as FormData)
    expect(withPhoto.get('artist')).toBe(JSON.stringify(artist))
    expect(withPhoto.get('photo')).toBe(photo)
    expect(without.has('photo')).toBe(false)
  })

  it('sends a list of files with `formData` as a part for each, in order', async () => {
    mockFetch({ 'POST /api/applications': { ok: true } })
    const photos = [new Blob(), new File(['photo'], 'photo.png', { type: 'image/png' })]
    const body = { artist: { kind: 'artist' }, application: {}, memberPhoto: photos, turnstileToken: 'token' }
    await api.POST('/api/applications', { body: body as never, bodySerializer: formData })
    const form = requestsTo('POST', '/api/applications')[0].body as FormData
    expect(form.getAll('memberPhoto').map((file) => (file as File).size)).toEqual([0, 5])
    expect(form.getAll('memberPhoto')[1]).toBe(photos[1])
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
    mockFetch({ '/api/admin/features': { ok: false, error: 'Boom' } })
    expect(await api.GET('/api/admin/features')).toEqual({ ok: false, error: 'Boom' })
  })

  it("returns everything the server's error has, e.g. what's in the way of a 409", async () => {
    mockFetch({ 'PUT /api/admin/sets/set-1/status': { ok: false, error: 'This session is cancelled', session: null, set: null } })
    const result = await api.PUT('/api/admin/sets/{id}/status', { params: { path: { id: 'set-1' } }, body: { status: 'planned' } })
    expect(result).toEqual({ ok: false, error: 'This session is cancelled', session: null, set: null })
    // Typed as the endpoint's errors.
    if (!result.ok && 'set' in result) expect(result.set).toBeNull()
  })

  it('tells that the session ended when an admin request fails with 401, before returning the error', async () => {
    mockFetch({ '/api/admin/features': UNAUTHORIZED })
    const listener = vi.fn()
    const unsubscribe = onSessionEnded(listener)
    try {
      const result = api.GET('/api/admin/features').then((result) => {
        expect(listener).toHaveBeenCalledTimes(1)
        return result
      })
      expect(await result).toEqual({ ok: false, error: 'Unauthorized' })

      unsubscribe()
      await api.GET('/api/admin/features')
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it("doesn't tell that the session ended for other failures, nor for a 401 outside the admin endpoints", async () => {
    mockFetch({ '/api/admin/features': { ok: false, error: 'Boom' }, 'POST /api/auth/login': UNAUTHORIZED })
    const listener = vi.fn()
    const unsubscribe = onSessionEnded(listener)
    try {
      await api.GET('/api/admin/features')
      // A wrong password.
      await api.POST('/api/auth/login', { body: { email: 'admin@example.com', password: 'wrong' } })
      expect(listener).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  it("returns an error, rather than throwing, when the response isn't the API's", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Request Entity Too Large</html>', { status: 413 })))
    expect(await api.GET('/api/admin/features')).toEqual({ ok: false, error: 'Erreur inconnue', fromServer: false })
  })

  it("returns an error, rather than throwing, when the server can't be reached", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await api.GET('/api/admin/features')).toEqual({ ok: false, error: 'Failed to fetch', fromServer: false })
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
    mockFetch({ '/api/admin/features': { ok: false, error: 'Boom' } })
    const { result } = renderHook(() => useApi('/api/admin/features'))
    await waitFor(() => expect(result.current).toEqual({ kind: 'error', message: 'Boom' }))
  })
})
