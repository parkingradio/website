import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Admins } from './admins'

function invite(email: string) {
  fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: "envoyer l'invitation" }))
}

describe('Admins', () => {
  it('shows a confirmation after successfully inviting a new admin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) }))
    render(<Admins />)

    invite('new-admin@example.com')

    await waitFor(() => expect(screen.getByText('Invitation envoyée.')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/invite',
      expect.objectContaining({ body: JSON.stringify({ email: 'new-admin@example.com' }) }),
    )
    expect(screen.getByLabelText('Courriel')).toHaveValue('')
  })

  it('shows the error after a failed invite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ ok: false, error: 'This email address is already an activated admin' }),
      }),
    )
    render(<Admins />)

    invite('already-admin@example.com')

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "L'invitation n'a pas pu être envoyée : This email address is already an activated admin",
      ),
    )
  })

  it('has a placeholder for the list of admins', () => {
    render(<Admins />)
    expect(screen.getByRole('heading', { name: 'Admins existants' })).toBeInTheDocument()
    expect(screen.getByText('Pas encore implémenté !')).toBeInTheDocument()
  })
})
