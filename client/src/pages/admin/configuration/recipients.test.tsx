import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../../../test-utils'
import { Recipients } from './recipients'

// Nobody gets applications by email yet, as on a new server.
const NO_RECIPIENTS = { '/api/admin/applications/recipients': { ok: true, recipients: [], updatedBy: null, updatedAt: null } }

describe('Who applications are emailed to', () => {
  const URL = '/api/admin/applications/recipients'
  const CHOSEN = { ok: true, recipients: ['equipe@example.com', 'booking@example.com'], updatedBy: 'admin@example.com', updatedAt: '2026-10-07T16:30:00.000Z' }

  const entry = () => screen.getByRole('textbox', { name: "Adresse e-mail d'un destinataire" })
  const shown = () =>
    within(screen.getByRole('group', { name: 'Destinataires' }))
      .queryAllByRole('listitem')
      .map((item) => item.firstChild?.textContent)
  const add = (value: string) => {
    fireEvent.change(entry(), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter ce destinataire' }))
  }

  it('shows the recipients, and who chose them', async () => {
    mockFetch({ [URL]: CHOSEN })
    render(<Recipients />)

    await waitFor(() => expect(shown()).toEqual(['equipe@example.com', 'booking@example.com']))
    expect(screen.getByText(/^Changé par admin@example.com le 7 octobre 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Aucun destinataire/)).not.toBeInTheDocument()
    // Each change is saved right away.
    expect(screen.queryByRole('button', { name: 'enregistrer' })).not.toBeInTheDocument()
  })

  it('says that applications are emailed to nobody until recipients are chosen', async () => {
    mockFetch({ ...NO_RECIPIENTS })
    render(<Recipients />)

    await waitFor(() => expect(entry()).toBeInTheDocument())
    expect(shown()).toEqual([])
    expect(screen.getByText(/Aucun destinataire/)).toBeInTheDocument()
    expect(screen.queryByText(/^Changé par/)).not.toBeInTheDocument()
  })

  it('saves an address as soon as it is added, and shows the recipients as the server returns them', async () => {
    const saved = { ok: true, recipients: ['equipe@example.com'], updatedBy: 'admin@example.com', updatedAt: '2026-10-08T16:30:00.000Z' }
    mockFetch({ ...NO_RECIPIENTS, [`PUT ${URL}`]: saved })
    render(<Recipients />)

    await waitFor(() => expect(entry()).toBeInTheDocument())
    add(' equipe@example.com ')

    await waitFor(() => expect(shown()).toEqual(['equipe@example.com']))
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ recipients: ['equipe@example.com'] }])
    expect(entry()).toHaveValue('')
    expect(screen.queryByText(/Aucun destinataire/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Changé par admin@example.com le 8 octobre 2026/)).toBeInTheDocument()
  })

  it('adds the address with Enter too, and keeps the focus on it for the next one', async () => {
    mockFetch({ ...NO_RECIPIENTS, [`PUT ${URL}`]: { ...CHOSEN, recipients: ['equipe@example.com'] } })
    render(<Recipients />)

    await waitFor(() => expect(entry()).toBeInTheDocument())
    fireEvent.change(entry(), { target: { value: 'equipe@example.com' } })
    // Enter submits the form, which jsdom doesn't do by itself.
    fireEvent.submit(entry().closest('form')!)
    // Nothing can be added or removed while the recipients are being saved.
    expect(screen.getByRole('button', { name: 'ajouter ce destinataire' })).toBeDisabled()

    await waitFor(() => expect(shown()).toEqual(['equipe@example.com']))
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ recipients: ['equipe@example.com'] }])
    expect(screen.getByRole('button', { name: 'ajouter ce destinataire' })).toBeEnabled()
    expect(entry()).toHaveFocus()
  })

  it('keeps what was typed while an address was being saved', async () => {
    mockFetch({ ...NO_RECIPIENTS })
    render(<Recipients />)

    await waitFor(() => expect(entry()).toBeInTheDocument())
    // The save only returns once `respond` is called.
    let respond: (response: Response) => void = () => {}
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => (respond = resolve)))
    add('equipe@example.com')
    fireEvent.change(entry(), { target: { value: 'booking@' } })
    respond({ ok: true, json: () => Promise.resolve({ ...CHOSEN, recipients: ['equipe@example.com'] }) } as Response)

    await waitFor(() => expect(shown()).toEqual(['equipe@example.com']))
    expect(entry()).toHaveValue('booking@')
  })

  it('saves the recipients as soon as one is removed', async () => {
    mockFetch({ [URL]: CHOSEN, [`PUT ${URL}`]: { ...CHOSEN, recipients: ['booking@example.com'] } })
    render(<Recipients />)

    fireEvent.click(await screen.findByRole('button', { name: 'retirer equipe@example.com' }))
    expect(screen.getByRole('button', { name: 'retirer booking@example.com' })).toBeDisabled()
    await waitFor(() => expect(shown()).toEqual(['booking@example.com']))
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ recipients: ['booking@example.com'] }])
    // Rather than being lost with the button that was clicked.
    expect(entry()).toHaveFocus()
  })

  it('keeps an address that could not be removed, and says why', async () => {
    mockFetch({ [URL]: CHOSEN, [`PUT ${URL}`]: { ok: false, error: 'Internal server error' } })
    render(<Recipients />)

    fireEvent.click(await screen.findByRole('button', { name: 'retirer equipe@example.com' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Les destinataires n'ont pas pu être enregistrés : Internal server error"),
    )
    expect(shown()).toEqual(['equipe@example.com', 'booking@example.com'])
  })

  it('stops adding addresses once there are as many as there can be', async () => {
    const recipients = Array.from({ length: 10 }, (_, i) => `admin-${i}@example.com`)
    mockFetch({ [URL]: { ...CHOSEN, recipients } })
    render(<Recipients />)

    await waitFor(() => expect(shown()).toEqual(recipients))
    expect(screen.getByRole('button', { name: 'ajouter ce destinataire' })).toBeDisabled()
  })

  it("doesn't save an address the recipients already have, whatever its case", async () => {
    mockFetch({ [URL]: CHOSEN })
    render(<Recipients />)

    await waitFor(() => expect(entry()).toBeInTheDocument())
    add('Equipe@Example.com')
    expect(entry()).toHaveValue('')
    expect(requestsTo('PUT', URL)).toHaveLength(0)
  })

  it("doesn't save what isn't an email address", async () => {
    mockFetch({ ...NO_RECIPIENTS })
    render(<Recipients />)

    await waitFor(() => expect(entry()).toBeInTheDocument())
    add('pas une adresse')
    expect(screen.getByText('Adresse e-mail invalide.')).toBeInTheDocument()
    expect(entry()).toHaveValue('pas une adresse')
    expect(entry()).toHaveAttribute('aria-invalid', 'true')
    expect(requestsTo('PUT', URL)).toHaveLength(0)

    // Until the address is changed.
    fireEvent.change(entry(), { target: { value: 'pas une adresse@' } })
    expect(screen.queryByText('Adresse e-mail invalide.')).not.toBeInTheDocument()
    expect(entry()).not.toHaveAttribute('aria-invalid')
  })

  it('says why an address could not be saved, and keeps it typed, until it is', async () => {
    mockFetch({ [URL]: CHOSEN, [`PUT ${URL}`]: { ok: false, error: 'Internal server error' } })
    render(<Recipients />)

    await waitFor(() => expect(entry()).toBeInTheDocument())
    add('autre@example.com')

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Les destinataires n'ont pas pu être enregistrés : Internal server error"),
    )
    expect(shown()).toEqual(['equipe@example.com', 'booking@example.com'])
    expect(entry()).toHaveValue('autre@example.com')

    mockFetch({ [URL]: CHOSEN, [`PUT ${URL}`]: { ...CHOSEN, recipients: [...CHOSEN.recipients, 'autre@example.com'] } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter ce destinataire' }))
    await waitFor(() => expect(shown()).toEqual(['equipe@example.com', 'booking@example.com', 'autre@example.com']))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
