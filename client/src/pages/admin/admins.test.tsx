import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Schema } from '../../api/client'
import { jsonBody, mockFetch, requestsTo } from '../../test-utils'
import { Admins } from './admins'
import { dateFormat, dateTimeFormat } from './describe'

const createdAt = '2026-10-01T12:00:00.000Z'
const inviteExpiresAt = '2026-10-15T12:00:00.000Z'
type Admin = Schema<'Admin'>
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
// The admins, and the apps the admin connected, which the page lists under them: none.
const LOADED = { '/api/admin/admins': { ok: true, admins: ADMINS }, '/api/admin/connections': { ok: true, connections: [] } }

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
    mockFetch({ ...LOADED, 'POST /api/admin/invite': { ok: true } })
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
      ...LOADED,
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
    mockFetch({ ...LOADED })
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
    mockFetch({ ...LOADED })
    render(<Admins />)

    const buttons = async (email: string) => (await row(email)).queryAllByRole('button').map((button) => button.textContent)
    expect(await buttons('me@example.com')).toEqual([])
    expect(await buttons('other@example.com')).toEqual(['révoquer'])
    expect(await buttons('invited@example.com')).toEqual(['renvoyer', 'révoquer'])
    expect(await buttons('expired@example.com')).toEqual(['renvoyer', 'révoquer'])
  })

  it('revokes an admin once confirmed, and reloads the list', async () => {
    mockFetch({ ...LOADED, 'DELETE /api/admin/admins/other': { ok: true } })
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    render(<Admins />)

    fireEvent.click((await row('other@example.com')).getByRole('button', { name: 'révoquer' }))

    expect(confirm).toHaveBeenCalledWith("Révoquer l'accès de other@example.com ? Ses sessions prendront fin aussitôt.")
    await waitFor(() => expect(requestsTo('DELETE', '/api/admin/admins/other')).toHaveLength(1))
    await waitFor(() => expect(requestsTo('GET', '/api/admin/admins')).toHaveLength(2))
  })

  it("doesn't revoke anyone unless confirmed", async () => {
    mockFetch({ ...LOADED })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    render(<Admins />)

    fireEvent.click((await row('invited@example.com')).getByRole('button', { name: 'révoquer' }))

    expect(confirm).toHaveBeenCalledWith("Révoquer l'invitation de invited@example.com ?")
    expect(requestsTo('DELETE', '/api/admin/admins/invited')).toHaveLength(0)
  })

  it('says why an admin could not be revoked', async () => {
    mockFetch({ ...LOADED, 'DELETE /api/admin/admins/other': { ok: false, error: 'No such admin' } })
    vi.stubGlobal('confirm', () => true)
    render(<Admins />)

    const other = await row('other@example.com')
    fireEvent.click(other.getByRole('button', { name: 'révoquer' }))

    await waitFor(() => expect(other.getByRole('alert')).toHaveTextContent("L'admin n'a pas pu être révoqué : No such admin"))
    // In case the list is out of date, e.g. another admin revoked them already.
    await waitFor(() => expect(requestsTo('GET', '/api/admin/admins')).toHaveLength(2))
  })

  it('invites again an admin who has not accepted their invite', async () => {
    mockFetch({ ...LOADED, 'POST /api/admin/invite': { ok: true } })
    render(<Admins />)

    const expired = await row('expired@example.com')
    fireEvent.click(expired.getByRole('button', { name: 'renvoyer' }))

    await waitFor(() => expect(expired.getByText('Invitation renvoyée.')).toBeInTheDocument())
    expect(requestsTo('POST', '/api/admin/invite').map(jsonBody)).toEqual([{ email: 'expired@example.com' }])
    await waitFor(() => expect(requestsTo('GET', '/api/admin/admins')).toHaveLength(2))
  })

  it("says so when the admins can't be loaded", async () => {
    mockFetch({ ...LOADED, '/api/admin/admins': { ok: false, error: 'Boom' } })
    render(<Admins />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Les admins n'ont pas pu être chargés : Boom")
  })
})

describe('Connecting Claude', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const connection = (fields: Partial<Schema<'Connection'>> = {}): Schema<'Connection'> => ({
    id: 'connection-id',
    client: 'Claude',
    scopes: ['admin'],
    createdAt,
    lastUsedAt: inviteExpiresAt,
    ...fields,
  })

  // The row of the app with this name: the one where the name is followed by when it was connected, since another app's
  // name can start with it, e.g. "Claude Code".
  async function appRow(name: string) {
    const connected = dateTimeFormat.format(new Date(createdAt))
    return within(await screen.findByRole('row', { name: (rowName) => rowName.startsWith(`${name} ${connected}`) }))
  }

  it("gives the connector's address, which it copies, and the command for Claude Code, and says when no app is connected", async () => {
    mockFetch({ ...LOADED })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<Admins />)

    const address = `${location.origin}/mcp`
    expect(screen.getByRole('heading', { name: 'Connecter Claude' })).toBeInTheDocument()
    expect(screen.getByText(address)).toBeInTheDocument()
    expect(screen.getByText(`claude mcp add --transport http parking-radio ${address}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'copier' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Adresse copiée.'))
    expect(writeText).toHaveBeenCalledWith(address)
    expect(screen.getByText('Aucune application connectée.')).toBeInTheDocument()
  })

  it("says when the address can't be copied", async () => {
    mockFetch({ ...LOADED })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('denied')) }, configurable: true })
    render(<Admins />)

    fireEvent.click(screen.getByRole('button', { name: 'copier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("L'adresse n'a pas pu être copiée : sélectionnez-la pour la copier vous-même.")
  })

  it("lists the admin's connected apps, and disconnects one, which reloads the list", async () => {
    mockFetch({
      '/api/admin/admins': { ok: true, admins: ADMINS },
      '/api/admin/connections': { ok: true, connections: [connection(), connection({ id: 'other-id', client: 'Claude Code' })] },
      'DELETE /api/admin/connections/connection-id': { ok: true },
    })
    render(<Admins />)

    const claude = await appRow('Claude')
    expect(claude.getByText(dateTimeFormat.format(new Date(createdAt)))).toBeInTheDocument()
    expect(claude.getByText(dateTimeFormat.format(new Date(inviteExpiresAt)))).toBeInTheDocument()
    expect((await appRow('Claude Code')).getByRole('button', { name: 'déconnecter' })).toBeInTheDocument()
    fireEvent.click(claude.getByRole('button', { name: 'déconnecter' }))

    await waitFor(() => expect(requestsTo('DELETE', '/api/admin/connections/connection-id')).toHaveLength(1))
    await waitFor(() => expect(requestsTo('GET', '/api/admin/connections')).toHaveLength(2))
  })

  it("says when an app can't be disconnected", async () => {
    mockFetch({
      '/api/admin/admins': { ok: true, admins: ADMINS },
      '/api/admin/connections': { ok: true, connections: [connection()] },
      'DELETE /api/admin/connections/connection-id': { ok: false, error: 'No such connection' },
    })
    render(<Admins />)
    fireEvent.click((await appRow('Claude')).getByRole('button', { name: 'déconnecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("L'application n'a pas pu être déconnectée : No such connection")
  })

  it("says when the apps can't be loaded", async () => {
    mockFetch({ ...LOADED, '/api/admin/connections': { ok: false, error: 'Boom' } })
    render(<Admins />)
    expect(await screen.findByText("Les applications connectées n'ont pas pu être chargées : Boom")).toBeInTheDocument()
  })
})
