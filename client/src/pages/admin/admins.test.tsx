import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Admin } from 'shared/admin'
import { jsonBody, mockFetch, requestsTo } from '../../test-utils'
import { Admins } from './admins'
import { dateFormat, dateTimeFormat } from './describe'

const createdAt = '2026-10-01T12:00:00.000Z'
const inviteExpiresAt = '2026-10-15T12:00:00.000Z'
const admin = (fields: Partial<Admin> & Pick<Admin, 'id' | 'email'>): Admin => ({
  status: 'active',
  inviteExpiresAt: null,
  invitedBy: null,
  createdAt,
  you: false,
  ...fields,
})
const ADMINS = [
  admin({ id: 'me', email: 'me@example.com', you: true }),
  admin({ id: 'other', email: 'other@example.com', invitedBy: 'me@example.com' }),
  admin({ id: 'invited', email: 'invited@example.com', status: 'invited', inviteExpiresAt, invitedBy: 'me@example.com' }),
  admin({ id: 'expired', email: 'expired@example.com', status: 'expired' }),
]

function invite(email: string) {
  fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: "envoyer l'invitation" }))
}

// The row of the admin with this email, once the list is loaded: the one that starts with it, since others can have it
// too, as who added them.
async function row(email: string) {
  return within(await screen.findByRole('row', { name: (name) => name.startsWith(email) }))
}

describe('Admins', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a confirmation after inviting a new admin, and reloads the list', async () => {
    mockFetch({ '/api/admin/admins': { ok: true, admins: ADMINS }, 'POST /api/admin/invite': { ok: true } })
    render(<Admins />)
    await row('me@example.com')

    invite('new-admin@example.com')

    await waitFor(() => expect(screen.getByText('Invitation envoyée.')).toBeInTheDocument())
    expect(requestsTo('POST', '/api/admin/invite').map(jsonBody)).toEqual([{ email: 'new-admin@example.com' }])
    expect(screen.getByLabelText('Courriel')).toHaveValue('')
    await waitFor(() => expect(requestsTo('GET', '/api/admin/admins')).toHaveLength(2))
  })

  it('shows the error after a failed invite', async () => {
    mockFetch({
      '/api/admin/admins': { ok: true, admins: ADMINS },
      'POST /api/admin/invite': { ok: false, error: 'This email address is already an activated admin' },
    })
    render(<Admins />)

    invite('already-admin@example.com')

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "L'invitation n'a pas pu être envoyée : This email address is already an activated admin",
      ),
    )
  })

  it('lists the admins, with their status and who added them', async () => {
    mockFetch({ '/api/admin/admins': { ok: true, admins: ADMINS } })
    render(<Admins />)

    const added = dateFormat.format(new Date(createdAt))
    const me = await row('me@example.com')
    expect(me.getByText('me@example.com (vous)')).toBeInTheDocument()
    expect(me.getByText('actif')).toBeInTheDocument()
    expect(me.getByText(added)).toBeInTheDocument()
    expect((await row('other@example.com')).getByText(`${added}, par me@example.com`)).toBeInTheDocument()
    expect(
      (await row('invited@example.com')).getByText(`invitation envoyée, expire le ${dateTimeFormat.format(new Date(inviteExpiresAt))}`),
    ).toBeInTheDocument()
    expect((await row('expired@example.com')).getByText('invitation expirée')).toBeInTheDocument()
  })

  it('lets admins revoke anyone but themselves, and invite again those who have not accepted', async () => {
    mockFetch({ '/api/admin/admins': { ok: true, admins: ADMINS } })
    render(<Admins />)

    const buttons = async (email: string) => (await row(email)).queryAllByRole('button').map((button) => button.textContent)
    expect(await buttons('me@example.com')).toEqual([])
    expect(await buttons('other@example.com')).toEqual(['révoquer'])
    expect(await buttons('invited@example.com')).toEqual(['renvoyer', 'révoquer'])
    expect(await buttons('expired@example.com')).toEqual(['renvoyer', 'révoquer'])
  })

  it('revokes an admin once confirmed, and reloads the list', async () => {
    mockFetch({ '/api/admin/admins': { ok: true, admins: ADMINS }, 'DELETE /api/admin/admins/other': { ok: true } })
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    render(<Admins />)

    fireEvent.click((await row('other@example.com')).getByRole('button', { name: 'révoquer' }))

    expect(confirm).toHaveBeenCalledWith("Révoquer l'accès de other@example.com ? Ses sessions prendront fin aussitôt.")
    await waitFor(() => expect(requestsTo('DELETE', '/api/admin/admins/other')).toHaveLength(1))
    await waitFor(() => expect(requestsTo('GET', '/api/admin/admins')).toHaveLength(2))
  })

  it("doesn't revoke anyone unless confirmed", async () => {
    mockFetch({ '/api/admin/admins': { ok: true, admins: ADMINS } })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    render(<Admins />)

    fireEvent.click((await row('invited@example.com')).getByRole('button', { name: 'révoquer' }))

    expect(confirm).toHaveBeenCalledWith("Révoquer l'invitation de invited@example.com ?")
    expect(requestsTo('DELETE', '/api/admin/admins/invited')).toHaveLength(0)
  })

  it('says why an admin could not be revoked', async () => {
    mockFetch({ '/api/admin/admins': { ok: true, admins: ADMINS }, 'DELETE /api/admin/admins/other': { ok: false, error: 'No such admin' } })
    vi.stubGlobal('confirm', () => true)
    render(<Admins />)

    const other = await row('other@example.com')
    fireEvent.click(other.getByRole('button', { name: 'révoquer' }))

    await waitFor(() => expect(other.getByRole('alert')).toHaveTextContent("L'admin n'a pas pu être révoqué : No such admin"))
    // In case the list is out of date, e.g. another admin revoked them already.
    await waitFor(() => expect(requestsTo('GET', '/api/admin/admins')).toHaveLength(2))
  })

  it('invites again an admin who has not accepted their invite', async () => {
    mockFetch({ '/api/admin/admins': { ok: true, admins: ADMINS }, 'POST /api/admin/invite': { ok: true } })
    render(<Admins />)

    const expired = await row('expired@example.com')
    fireEvent.click(expired.getByRole('button', { name: 'renvoyer' }))

    await waitFor(() => expect(expired.getByText('Invitation renvoyée.')).toBeInTheDocument())
    expect(requestsTo('POST', '/api/admin/invite').map(jsonBody)).toEqual([{ email: 'expired@example.com' }])
    await waitFor(() => expect(requestsTo('GET', '/api/admin/admins')).toHaveLength(2))
  })

  it("says so when the admins can't be loaded", async () => {
    mockFetch({ '/api/admin/admins': { ok: false, error: 'Unauthorized' } })
    render(<Admins />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Les admins n'ont pas pu être chargés : Unauthorized")
  })
})
