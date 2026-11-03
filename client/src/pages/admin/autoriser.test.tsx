import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import App from '../../app'
import { UNAUTHORIZED, jsonBody, mockFetch, requestsTo } from '../../test-utils'
import { browser } from '../../browser'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const PARAMS = {
  response_type: 'code',
  client_id: CLAUDE,
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  state: 'the-state',
}
const SEARCH = new URLSearchParams(PARAMS).toString()
const CHECK = `/api/admin/oauth/authorization?${SEARCH}`
const ASKED_BY_CLAUDE = { ok: true, client: 'Claude', redirectHost: 'claude.ai', local: false, scopes: ['admin'] }
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback?code=the-code&state=the-state&iss=https%3A%2F%2Fparking.radio'

function renderAt(search = SEARCH) {
  return render(
    <MemoryRouter initialEntries={[`/autoriser?${search}`]}>
      <App />
    </MemoryRouter>,
  )
}

describe('Autoriser une application', () => {
  let go: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    go = vi.spyOn(browser, 'go').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the login form while logged out, without the admin menu, then what the app asks for', async () => {
    mockFetch({ '/api/admin/me': UNAUTHORIZED, '/api/auth/login': { ok: true, email: 'admin@example.com' }, [CHECK]: ASKED_BY_CLAUDE })
    renderAt()

    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
    expect(screen.getByText("Connectez-vous pour autoriser l'application.")).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'admin' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))
    expect(await screen.findByRole('heading', { name: 'Autoriser Claude' })).toBeInTheDocument()
  })

  it('says which app asks, as whom, what it will be able to do, and where the browser goes back to', async () => {
    mockFetch({ ...LOGGED_IN, [CHECK]: ASKED_BY_CLAUDE })
    renderAt()

    expect(await screen.findByRole('heading', { name: 'Autoriser Claude' })).toBeInTheDocument()
    expect(screen.getByText(/demande à agir en votre nom \(admin@example\.com\) sur Parking Radio/)).toBeInTheDocument()
    expect(screen.getByText('Il pourra faire tout ce que vous faites dans les pages admin, sauf :')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'gérer les admins et les applications connectées',
      'voir ou ajouter des photos',
      'changer la connexion SoundCloud',
      'voir ou changer les features de la page Configuration',
      "choisir les destinataires de l'envoi des candidatures par e-mail",
    ])
    expect(screen.getByText(/N'autorisez Claude que si vous venez vous-même de lancer sa connexion/)).toBeInTheDocument()
    expect(screen.getByText('Ensuite, votre navigateur retournera vers claude.ai.')).toBeInTheDocument()
  })

  it("says when the browser goes back to the admin's computer", async () => {
    mockFetch({ ...LOGGED_IN, [CHECK]: { ...ASKED_BY_CLAUDE, client: 'Claude Code', redirectHost: 'localhost', local: true } })
    renderAt()

    expect(await screen.findByText('Ensuite, votre navigateur retournera vers votre ordinateur (localhost).')).toBeInTheDocument()
  })

  it.each([
    ['autoriser', true, CALLBACK],
    ['refuser', false, 'https://claude.ai/api/mcp/auth_callback?error=access_denied'],
  ])('sends the answer of "%s", then the browser back to the app', async (button, allow, redirect) => {
    mockFetch({ ...LOGGED_IN, [CHECK]: ASKED_BY_CLAUDE, 'POST /api/admin/oauth/authorization': { ok: true, redirect } })
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: button }))

    await waitFor(() => expect(go).toHaveBeenCalledWith(redirect))
    expect(requestsTo('POST', '/api/admin/oauth/authorization').map(jsonBody)).toEqual([{ ...PARAMS, allow }])
    expect(screen.getByRole('status')).toHaveTextContent("Retour vers l'application…")
  })

  it("says when the answer couldn't be sent, and lets the admin try again", async () => {
    mockFetch({ ...LOGGED_IN, [CHECK]: ASKED_BY_CLAUDE, 'POST /api/admin/oauth/authorization': { ok: false, error: 'Boom' } })
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'autoriser' }))
    // Until the answer is sent, so that it's only sent once.
    expect(screen.getByRole('button', { name: 'autoriser' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'refuser' })).toBeDisabled()

    expect(await screen.findByRole('alert')).toHaveTextContent("La réponse n'a pas pu être envoyée : Boom")
    expect(screen.getByRole('button', { name: 'autoriser' })).toBeEnabled()
    expect(go).not.toHaveBeenCalled()
  })

  it('shows the login form when the session ends before the answer is sent, then the request again', async () => {
    mockFetch({
      ...LOGGED_IN,
      [CHECK]: ASKED_BY_CLAUDE,
      'POST /api/admin/oauth/authorization': UNAUTHORIZED,
      '/api/auth/login': { ok: true, email: 'admin@example.com' },
    })
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'autoriser' }))

    expect(await screen.findByText('La session a pris fin. Connectez-vous à nouveau pour continuer.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))
    expect(await screen.findByRole('heading', { name: 'Autoriser Claude' })).toBeInTheDocument()
    expect(requestsTo('GET', CHECK)).toHaveLength(2)
    expect(go).not.toHaveBeenCalled()
  })

  it('checks the parameters the page then sends, even with a name that has to be encoded', async () => {
    const { state, ...rest } = PARAMS
    const search = `${new URLSearchParams(rest)}&x%23y=1&state=${state}`
    mockFetch({
      ...LOGGED_IN,
      [`/api/admin/oauth/authorization?${search}`]: ASKED_BY_CLAUDE,
      'POST /api/admin/oauth/authorization': { ok: true, redirect: CALLBACK },
    })
    renderAt(search)

    fireEvent.click(await screen.findByRole('button', { name: 'autoriser' }))

    await waitFor(() => expect(go).toHaveBeenCalledWith(CALLBACK))
    expect(requestsTo('POST', '/api/admin/oauth/authorization').map(jsonBody)).toEqual([{ ...rest, 'x#y': '1', state, allow: true }])
  })

  it("sends the browser back to the app right away when the app can be told what's wrong, with the parameters as they were", async () => {
    const search = `${SEARCH}&state=again`
    const wrong = 'https://claude.ai/api/mcp/auth_callback?error=invalid_request'
    mockFetch({ ...LOGGED_IN, [`/api/admin/oauth/authorization?${search}`]: { ok: false, error: '`state` is there more than once', redirect: wrong } })
    renderAt(search)

    await waitFor(() => expect(go).toHaveBeenCalledWith(wrong))
  })

  it("says that only Claude and Claude Code can connect, for an app the site doesn't know", async () => {
    mockFetch({ ...LOGGED_IN, [CHECK]: { ok: false, error: 'Only Claude and Claude Code can connect', unknownClient: true } })
    renderAt()

    expect(await screen.findByRole('alert')).toHaveTextContent('Seuls Claude et Claude Code peuvent se connecter à Parking Radio.')
    expect(go).not.toHaveBeenCalled()
  })

  it("says when the link isn't valid, without sending the browser back", async () => {
    mockFetch({ ...LOGGED_IN, [CHECK]: { ok: false, error: "`redirect_uri` isn't one of the app's" } })
    renderAt()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Ce lien n'est pas valide (`redirect_uri` isn't one of the app's). Recommencez la connexion depuis l'application.",
    )
    expect(go).not.toHaveBeenCalled()
  })

  it("says when the request couldn't be checked", async () => {
    mockFetch(LOGGED_IN)
    renderAt()

    expect(await screen.findByRole('alert')).toHaveTextContent(/^La demande n'a pas pu être vérifiée : .*\. Rechargez la page pour réessayer\.$/)
  })
})
