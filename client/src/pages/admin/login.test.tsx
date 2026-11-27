import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ConfigContext } from '../../config-context'
import type { ConfigState } from '../../config-context'
import { CONFIG, NEXT_TURNSTILE_TOKEN, TURNSTILE_TOKEN, configWith, jsonBody, mockFetch, requestsTo, turnstile } from '../../test-utils'
import { Login } from './login'

// Once the configuration has been fetched, unless told otherwise.
function renderLogin({ onLogin = vi.fn(), config = configWith({}) }: { onLogin?: (email: string) => void; config?: ConfigState } = {}) {
  render(
    <ConfigContext value={config}>
      <MemoryRouter>
        <Login onLogin={onLogin} />
      </MemoryRouter>
    </ConfigContext>,
  )
  return onLogin
}

function logIn(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))
}

const logins = () => requestsTo('POST', '/api/auth/login').map(jsonBody)

const NOT_VOUCHED = "La vérification anti-robot n'est pas terminée. Attendez quelques secondes, ou rechargez la page si elle n'apparaît pas."

describe('Login', () => {
  it("reports the logged-in email after a successful login, sent with Turnstile's token", async () => {
    mockFetch({ 'POST /api/auth/login': { ok: true, email: 'Admin@example.com' } })
    const onLogin = renderLogin()

    logIn('admin@example.com', 'correct-password')

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('Admin@example.com'))
    expect(logins()).toEqual([{ email: 'admin@example.com', password: 'correct-password', turnstileToken: TURNSTILE_TOKEN }])
  })

  it("renders Turnstile with the site key from the server's configuration, in French, only shown when it's needed", () => {
    renderLogin()
    expect(turnstile.render).toHaveBeenCalledOnce()
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({ sitekey: CONFIG.turnstileSiteKey, language: 'fr', appearance: 'interaction-only' })
  })

  it('keeps no room for the widget until Cloudflare needs the admin to click it', () => {
    renderLogin()
    const widget = document.querySelector('.turnstile')!
    expect(widget).not.toHaveClass('shown')

    act(() => turnstile.callbacks!['before-interactive-callback']())

    expect(widget).toHaveClass('shown')
  })

  it('shows an error after a failed login, and gets a new token from Turnstile, since a token can only be checked once', async () => {
    mockFetch({ 'POST /api/auth/login': { ok: false, error: 'Invalid email or password' } })
    const onLogin = renderLogin()
    // The next widget only vouches when the test says so, so that the token sent next is shown to come from it.
    turnstile.vouches = false

    logIn('admin@example.com', 'wrong-password')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password'))
    expect(onLogin).not.toHaveBeenCalled()
    expect(turnstile.remove).toHaveBeenCalledWith('widget')
    expect(turnstile.render).toHaveBeenCalledTimes(2)

    mockFetch({ 'POST /api/auth/login': { ok: true, email: 'admin@example.com' } })
    act(() => turnstile.callbacks!.callback(NEXT_TURNSTILE_TOKEN))
    fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('admin@example.com'))
    expect(logins().map((body) => body.turnstileToken)).toEqual([NEXT_TURNSTILE_TOKEN])
  })

  it('gets a new token from Turnstile when the server cannot be reached too', async () => {
    // Without the login among its answers, `fetch` fails, as when the network does.
    mockFetch()
    renderLogin()

    logIn('admin@example.com', 'correct-password')

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(turnstile.render).toHaveBeenCalledTimes(2)
  })

  it("doesn't log in until Turnstile vouches for the admin, and says so", async () => {
    turnstile.vouches = false
    mockFetch({ 'POST /api/auth/login': { ok: true, email: 'admin@example.com' } })
    const onLogin = renderLogin()

    logIn('admin@example.com', 'correct-password')
    expect(screen.getByRole('alert')).toHaveTextContent(NOT_VOUCHED)
    expect(logins()).toEqual([])

    act(() => turnstile.callbacks!.callback(TURNSTILE_TOKEN))
    fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('admin@example.com'))
  })

  it("doesn't send a token that expired", () => {
    renderLogin()
    act(() => turnstile.callbacks!['expired-callback']())

    logIn('admin@example.com', 'correct-password')

    expect(screen.getByRole('alert')).toHaveTextContent(NOT_VOUCHED)
    expect(logins()).toEqual([])
  })

  it("can't log in when the configuration can't be fetched, since Turnstile needs it", () => {
    renderLogin({ config: { kind: 'failed' } })
    expect(turnstile.render).not.toHaveBeenCalled()

    logIn('admin@example.com', 'correct-password')

    expect(screen.getByRole('alert')).toHaveTextContent("La connexion n'est pas possible pour le moment. Rechargez la page.")
    expect(logins()).toEqual([])
  })

  it('shows its notice rather than the message the page was opened with', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/admin', state: { message: 'Mot de passe enregistré.' } }]}>
        <Login onLogin={vi.fn()} notice="La session a pris fin." />
      </MemoryRouter>,
    )
    expect(screen.getByText('La session a pris fin.')).toBeInTheDocument()
    expect(screen.queryByText('Mot de passe enregistré.')).not.toBeInTheDocument()
  })
})
