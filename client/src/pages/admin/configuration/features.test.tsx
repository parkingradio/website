import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../../../test-utils'
import { Features } from './features'

// These tests use flags of their own, so that they don't depend on which flags there are.
vi.mock('../describe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../describe')>()),
  FEATURE_LABELS: {
    'new-thing': { name: 'Nouveau truc', description: 'Montre le nouveau truc.' },
    'other-thing': { name: 'Autre truc', description: "Montre l'autre truc." },
  },
}))

const URL = '/api/admin/features'
const OFF = { id: 'new-thing', enabled: false, updatedBy: null, updatedAt: null }
const ON = { id: 'new-thing', enabled: true, updatedBy: 'admin@example.com', updatedAt: '2026-10-09T16:30:00.000Z' }

const toggle = () => screen.getByRole('switch', { name: 'Nouveau truc' })

describe('Features', () => {
  it('says when there are no flags', async () => {
    mockFetch({ [URL]: { ok: true, features: [] } })
    render(<Features />)

    await waitFor(() => expect(screen.getByText('Aucune feature pour le moment.')).toBeInTheDocument())
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('shows each flag, what it does, whether it is on, and who last switched it', async () => {
    mockFetch({ [URL]: { ok: true, features: [OFF, { ...ON, id: 'other-thing' }] } })
    render(<Features />)

    await waitFor(() => expect(toggle()).not.toBeChecked())
    expect(screen.getByText('Montre le nouveau truc.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Autre truc' })).toBeChecked()
    expect(screen.getByText(/^Activée par admin@example.com le 9 octobre 2026/)).toBeInTheDocument()
    // Nobody switched the first one yet.
    expect(screen.getAllByText(/par admin@example.com/)).toHaveLength(1)
  })

  it('saves a flag as soon as it is switched, and shows it as the server returns it', async () => {
    mockFetch({ [URL]: { ok: true, features: [OFF] }, [`PUT ${URL}/new-thing`]: { ok: true, feature: ON } })
    render(<Features />)

    await waitFor(() => expect(toggle()).toBeInTheDocument())
    fireEvent.click(toggle())
    // It can't be switched again until it's saved.
    expect(toggle()).toBeDisabled()

    await waitFor(() => expect(toggle()).toBeChecked())
    expect(toggle()).toBeEnabled()
    expect(requestsTo('PUT', `${URL}/new-thing`).map(jsonBody)).toEqual([{ enabled: true }])
    expect(screen.getByText(/^Activée par admin@example.com le 9 octobre 2026/)).toBeInTheDocument()

    mockFetch({ [`PUT ${URL}/new-thing`]: { ok: true, feature: { ...ON, enabled: false } } })
    fireEvent.click(toggle())
    await waitFor(() => expect(toggle()).not.toBeChecked())
    expect(screen.getByText(/^Désactivée par admin@example.com/)).toBeInTheDocument()
  })

  it("says when a flag couldn't be switched, and keeps it as it was", async () => {
    mockFetch({ [URL]: { ok: true, features: [OFF] }, [`PUT ${URL}/new-thing`]: { ok: false, error: 'Boom' } })
    render(<Features />)

    await waitFor(() => expect(toggle()).toBeInTheDocument())
    fireEvent.click(toggle())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("La feature n'a pas pu être activée : Boom"))
    expect(toggle()).not.toBeChecked()
    expect(toggle()).toBeEnabled()
  })

  it("says when the flags couldn't be loaded", async () => {
    mockFetch({ [URL]: { ok: false, error: 'Boom' } })
    render(<Features />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les features n'ont pas pu être chargées : Boom"))
  })
})
