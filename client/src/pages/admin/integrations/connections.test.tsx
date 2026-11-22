import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Schema } from '../../../api/client'
import { mockFetch, requestsTo } from '../../../test-utils'
import { dateTimeFormat } from '../describe'
import { ConnectClaude, ConnectedApps } from './connections'

const createdAt = '2026-10-01T12:00:00.000Z'
const lastUsedAt = '2026-10-15T12:00:00.000Z'

describe('Connecting Claude', () => {
  it("gives the connector's address, which it copies, and the command for Claude Code", async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ConnectClaude />)

    const address = `${location.origin}/mcp`
    expect(screen.getByText(address)).toBeInTheDocument()
    expect(screen.getByText(`claude mcp add --transport http parking-radio ${address}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'copier' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Adresse copiée.'))
    expect(writeText).toHaveBeenCalledWith(address)
  })

  it("says when the address can't be copied", async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('denied')) }, configurable: true })
    render(<ConnectClaude />)

    fireEvent.click(screen.getByRole('button', { name: 'copier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("L'adresse n'a pas pu être copiée : sélectionnez-la pour la copier vous-même.")
  })
})

describe('The connected apps', () => {
  const connection = (fields: Partial<Schema<'Connection'>> = {}): Schema<'Connection'> => ({
    id: 'connection-id',
    client: 'Claude',
    scopes: ['admin'],
    createdAt,
    lastUsedAt,
    ...fields,
  })

  // The row of the app with this name: the one where the name is followed by when it was connected, since another app's
  // name can start with it, e.g. "Claude Code".
  async function appRow(name: string) {
    const connected = dateTimeFormat.format(new Date(createdAt))
    return within(await screen.findByRole('row', { name: (rowName) => rowName.startsWith(`${name} ${connected}`) }))
  }

  it('says when no app is connected', async () => {
    mockFetch({ '/api/admin/connections': { ok: true, connections: [] } })
    render(<ConnectedApps />)

    expect(await screen.findByText('Aucune application connectée.')).toBeInTheDocument()
  })

  it("lists the admin's connected apps, and disconnects one, which reloads the list", async () => {
    mockFetch({
      '/api/admin/connections': { ok: true, connections: [connection(), connection({ id: 'other-id', client: 'Claude Code' })] },
      'DELETE /api/admin/connections/connection-id': { ok: true },
    })
    render(<ConnectedApps />)

    const claude = await appRow('Claude')
    expect(claude.getByText(dateTimeFormat.format(new Date(createdAt)))).toBeInTheDocument()
    expect(claude.getByText(dateTimeFormat.format(new Date(lastUsedAt)))).toBeInTheDocument()
    expect((await appRow('Claude Code')).getByRole('button', { name: 'déconnecter' })).toBeInTheDocument()
    fireEvent.click(claude.getByRole('button', { name: 'déconnecter' }))

    await waitFor(() => expect(requestsTo('DELETE', '/api/admin/connections/connection-id')).toHaveLength(1))
    await waitFor(() => expect(requestsTo('GET', '/api/admin/connections')).toHaveLength(2))
  })

  it("says when an app can't be disconnected", async () => {
    mockFetch({
      '/api/admin/connections': { ok: true, connections: [connection()] },
      'DELETE /api/admin/connections/connection-id': { ok: false, error: 'No such connection' },
    })
    render(<ConnectedApps />)
    fireEvent.click((await appRow('Claude')).getByRole('button', { name: 'déconnecter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("L'application n'a pas pu être déconnectée : No such connection")
    // In case the list is out of date, e.g. the app was disconnected already.
    await waitFor(() => expect(requestsTo('GET', '/api/admin/connections')).toHaveLength(2))
  })

  it("says when the apps can't be loaded", async () => {
    mockFetch({ '/api/admin/connections': { ok: false, error: 'Boom' } })
    render(<ConnectedApps />)
    expect(await screen.findByText("Les applications connectées n'ont pas pu être chargées : Boom")).toBeInTheDocument()
  })
})
