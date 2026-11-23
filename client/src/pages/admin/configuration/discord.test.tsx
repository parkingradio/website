import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../../../test-utils'
import { DiscordCredentials } from './discord'

// The form is shared with the SoundCloud app's (see credentials-form.tsx), whose tests cover how it verifies and saves
// credentials (see soundcloud.test.tsx): these are for what's Discord's own.
describe('The Discord bot', () => {
  const URL = '/api/admin/chat/discord'
  const CHECK_URL = `${URL}/check`
  const CHANNEL_ID = '1234567890123456789'
  const NONE = { [URL]: { ok: true, credentials: null } }
  const ENTERED = {
    ok: true,
    credentials: { channelId: CHANNEL_ID, botName: 'parking.radio', channelName: 'chat', updatedBy: 'admin@example.com', updatedAt: '2026-11-23T16:30:00.000Z' },
  }

  const channelId = () => screen.getByRole('textbox', { name: 'ID du salon Discord' })
  const botToken = () => screen.getByLabelText('Token du bot Discord')

  it('shows the bot, the channel, who entered the credentials, the channel id, and dots for the token, which is never sent back', async () => {
    mockFetch({ [URL]: ENTERED })
    render(<DiscordCredentials />)

    await waitFor(() => expect(channelId()).toHaveValue(CHANNEL_ID))
    expect(screen.getByText(/^Bot « parking.radio » → #chat\. Changés par admin@example.com le 23 novembre 2026/)).toBeInTheDocument()
    expect(botToken()).toHaveValue('')
    expect(botToken()).toHaveAttribute('type', 'password')
    expect(botToken()).toHaveAttribute('placeholder', '•'.repeat(32))
    expect(screen.getByText(/la page d'accueil montre toujours le chat par WidgetBot/)).toBeInTheDocument()
    expect(screen.getByText(/discord\.com\/channels\/<ID du serveur>\/<ID du salon>/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'portail des développeurs' })).toHaveAttribute('href', 'https://discord.com/developers/applications')
  })

  it('says that there are none until the credentials are entered', async () => {
    mockFetch(NONE)
    render(<DiscordCredentials />)

    await waitFor(() => expect(screen.getByText('Aucun identifiant pour le moment.')).toBeInTheDocument())
    expect(channelId()).toHaveValue('')
    expect(botToken()).not.toHaveAttribute('placeholder')
  })

  it('verifies the credentials with Discord, then saves them, and shows the bot and the channel', async () => {
    mockFetch({ ...NONE, [`POST ${CHECK_URL}`]: { ok: true }, [`PUT ${URL}`]: ENTERED })
    render(<DiscordCredentials />)

    await waitFor(() => expect(channelId()).toBeInTheDocument())
    fireEvent.change(channelId(), { target: { value: CHANNEL_ID } })
    fireEvent.change(botToken(), { target: { value: 'the-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'vérifier' }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Identifiants acceptés par Discord' })).toHaveTextContent('✓'))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByRole('status', { name: 'Identifiants enregistrés' })).toHaveTextContent('✓'))
    expect(requestsTo('POST', CHECK_URL).map(jsonBody)).toEqual([{ botToken: 'the-token', channelId: CHANNEL_ID }])
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ botToken: 'the-token', channelId: CHANNEL_ID }])
    expect(screen.getByText(/^Bot « parking.radio » → #chat\. Changés par admin@example.com/)).toBeInTheDocument()
    expect(botToken()).toHaveValue('')
  })

  it('says why the credentials could not be verified', async () => {
    mockFetch({ ...NONE, [`POST ${CHECK_URL}`]: { ok: false, error: "The bot doesn't have these permissions in the channel: Manage Webhooks" } })
    render(<DiscordCredentials />)

    await waitFor(() => expect(channelId()).toBeInTheDocument())
    fireEvent.change(channelId(), { target: { value: CHANNEL_ID } })
    fireEvent.change(botToken(), { target: { value: 'the-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'vérifier' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Les identifiants n'ont pas pu être vérifiés : The bot doesn't have these permissions in the channel: Manage Webhooks",
      ),
    )
    expect(screen.getByRole('button', { name: 'enregistrer' })).toBeDisabled()
  })

  it('says when the credentials could not be loaded', async () => {
    mockFetch({ [URL]: { ok: false, error: 'Boom' } })
    render(<DiscordCredentials />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les identifiants Discord n'ont pas pu être chargés : Boom"))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
