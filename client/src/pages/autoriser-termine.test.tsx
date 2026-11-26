import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import App from '../app'
import { mockFetch, requestsTo } from '../test-utils'

function renderAt(path: string) {
  mockFetch()
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('/autoriser/termine', () => {
  it('says that the app is connected, under the navbar, without asking whether anyone is logged in', async () => {
    renderAt('/autoriser/termine')

    expect(screen.getByRole('heading', { name: 'Application connectée' })).toBeInTheDocument()
    expect(screen.getByText("L'application est maintenant connectée à Parking Radio. Vous pouvez fermer cet onglet.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'archives' })).toBeInTheDocument()
    await waitFor(() => expect(requestsTo('GET', '/api/config')).toHaveLength(1))
    expect(requestsTo('GET', '/api/admin/me')).toHaveLength(0)
  })

  it.each(['failed', 'failed=1', 'failed=Boom%20from%20the%20address&client_id=Claude'])(
    "says that the app couldn't be connected with ?%s, and nothing from the address",
    (search) => {
      const { container } = renderAt(`/autoriser/termine?${search}`)

      expect(screen.getByRole('heading', { name: 'Application non connectée' })).toBeInTheDocument()
      expect(
        screen.getByText("L'application n'a pas pu être connectée à Parking Radio. Revenez à l'application pour savoir pourquoi."),
      ).toBeInTheDocument()
      expect(container).not.toHaveTextContent(/Boom|Claude/)
    },
  )
})
