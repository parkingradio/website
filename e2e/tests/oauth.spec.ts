import { createHash, randomBytes } from 'node:crypto'
import { test, expect, logIn } from './fixtures.ts'

// Connecting an app through OAuth, as Claude does: the admin allows it on the authorization page, it exchanges its code for
// tokens, and the admin disconnects it from the Admins page, which ends its tokens.

const CLIENTS = {
  'Claude Code': { id: 'https://claude.ai/oauth/claude-code-client-metadata', redirectUri: 'http://127.0.0.1:3118/callback' },
  Claude: { id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', redirectUri: 'https://claude.ai/api/mcp/auth_callback' },
}

test('an admin allows an app, which gets tokens, then disconnects it', async ({ page, hasDrawer }) => {
  // Each project connects an app of its own, so that they can run at the same time and tell their connections apart. The
  // phone connects Claude, and the computer Claude Code, which runs on it.
  const name = hasDrawer ? 'Claude' : 'Claude Code'
  const client = CLIENTS[name]
  const verifier = randomBytes(32).toString('base64url')
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.id,
    redirect_uri: client.redirectUri,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'the-state',
  })
  // The browser is sent back to the app, which isn't there: this stands in for it.
  await page.route(`${client.redirectUri}**`, (route) => route.fulfill({ body: 'connected' }))

  await logIn(page, { at: `/autoriser?${query}` })
  await expect(page.getByRole('heading', { name: `Autoriser ${name}` })).toBeVisible()
  await page.getByRole('button', { name: 'autoriser' }).click()
  // Once the browser is back at the app, rather than once it asks for it: going elsewhere while that navigation is still
  // on its way would be interrupted by it.
  await page.waitForURL((url) => url.href.startsWith(client.redirectUri))
  const answer = new URL(page.url())
  expect(answer.searchParams.get('state')).toBe('the-state')

  const exchange = { grant_type: 'authorization_code', code: answer.searchParams.get('code')!, client_id: client.id, redirect_uri: client.redirectUri, code_verifier: verifier }
  const tokens = await page.request.post('/api/oauth/token', { form: exchange })
  expect(tokens.status()).toBe(200)
  const { refresh_token: refreshToken } = await tokens.json()

  await page.goto('/admin/admins')
  // The most recently used first: this test's connection, which was just made.
  const rows = page.getByRole('row', { name: new RegExp(`^${name} \\d`) })
  await expect(rows.first()).toBeVisible()
  const connected = await rows.count()
  await rows.first().getByRole('button', { name: 'déconnecter' }).click()
  await expect(rows).toHaveCount(connected - 1)

  const refresh = await page.request.post('/api/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.id } })
  expect(refresh.status()).toBe(400)
  expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' })
})
