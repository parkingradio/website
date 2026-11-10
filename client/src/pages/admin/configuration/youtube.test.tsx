import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../../../test-utils'
import { YouTubeCredentials } from './youtube'

// The form is shared with the SoundCloud app's (see credentials-form.tsx), whose tests cover how it verifies and saves
// credentials (see soundcloud.test.tsx): these are for what's YouTube's own.
describe('The YouTube channel', () => {
  const URL = '/api/admin/video/credentials'
  const CHECK_URL = `${URL}/check`
  const CHANNEL_ID = 'UCvMw4qUIPPwkcZmBRRS0vNA'
  const NONE = { [URL]: { ok: true, credentials: null } }
  const entered = (error: string | null = null) => ({
    ok: true,
    credentials: { channelId: CHANNEL_ID, updatedBy: 'admin@example.com', updatedAt: '2026-10-07T16:30:00.000Z', error },
  })

  const channelId = () => screen.getByRole('textbox', { name: 'ID de la chaîne' })
  const apiKey = () => screen.getByLabelText("Clé d'API")
  const verifyButton = () => screen.getByRole('button', { name: 'vérifier' })
  const saveButton = () => screen.getByRole('button', { name: 'enregistrer' })
  const failedRead = () => screen.queryByText(/^La dernière lecture de YouTube a échoué/)

  it('shows who entered the credentials, the channel id, and dots for the key, which is never sent back', async () => {
    mockFetch({ [URL]: entered() })
    render(<YouTubeCredentials />)

    await waitFor(() => expect(channelId()).toHaveValue(CHANNEL_ID))
    expect(screen.getByText(/^Changés par admin@example.com le 7 octobre 2026/)).toBeInTheDocument()
    expect(apiKey()).toHaveValue('')
    expect(apiKey()).toHaveAttribute('type', 'password')
    expect(apiKey()).toHaveAttribute('placeholder', '•'.repeat(32))
    expect(failedRead()).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'paramètres avancés' })).toHaveAttribute('href', 'https://www.youtube.com/account_advanced')
    expect(screen.getByRole('link', { name: 'identifiants' })).toHaveAttribute('href', 'https://console.cloud.google.com/apis/credentials')
  })

  it('says that the site has no video to show until the credentials are entered', async () => {
    mockFetch(NONE)
    render(<YouTubeCredentials />)

    await waitFor(() => expect(screen.getByText("Aucun identifiant : le site n'a aucune vidéo à montrer.")).toBeInTheDocument())
    expect(channelId()).toHaveValue('')
    expect(apiKey()).not.toHaveAttribute('placeholder')
  })

  it('says why the last read of YouTube failed', async () => {
    mockFetch({ [URL]: entered('YouTube refused this key: API key expired.') })
    render(<YouTubeCredentials />)

    await waitFor(() => expect(failedRead()).toHaveTextContent('La dernière lecture de YouTube a échoué : YouTube refused this key: API key expired.'))
  })

  it('verifies the credentials with YouTube, then saves them, and says why the read that follows failed, if it did', async () => {
    mockFetch({ ...NONE, [`POST ${CHECK_URL}`]: { ok: true }, [`PUT ${URL}`]: entered('YouTube cannot be reached: fetch failed') })
    render(<YouTubeCredentials />)

    await waitFor(() => expect(channelId()).toBeInTheDocument())
    fireEvent.change(channelId(), { target: { value: CHANNEL_ID } })
    fireEvent.change(apiKey(), { target: { value: 'the-key' } })
    fireEvent.click(verifyButton())
    await waitFor(() => expect(screen.getByRole('status', { name: 'Identifiants acceptés par YouTube' })).toHaveTextContent('✓'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(screen.getByRole('status', { name: 'Identifiants enregistrés' })).toHaveTextContent('✓'))
    expect(requestsTo('POST', CHECK_URL).map(jsonBody)).toEqual([{ channelId: CHANNEL_ID, apiKey: 'the-key' }])
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ channelId: CHANNEL_ID, apiKey: 'the-key' }])
    expect(screen.getByText(/^Changés par admin@example.com/)).toBeInTheDocument()
    expect(failedRead()).toHaveTextContent('YouTube cannot be reached: fetch failed')
  })

  it('says why the credentials could not be verified', async () => {
    mockFetch({ ...NONE, [`POST ${CHECK_URL}`]: { ok: false, error: 'YouTube finds no such channel' } })
    render(<YouTubeCredentials />)

    await waitFor(() => expect(channelId()).toBeInTheDocument())
    fireEvent.change(channelId(), { target: { value: CHANNEL_ID } })
    fireEvent.change(apiKey(), { target: { value: 'the-key' } })
    fireEvent.click(verifyButton())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les identifiants n'ont pas pu être vérifiés : YouTube finds no such channel"))
    expect(saveButton()).toBeDisabled()
  })

  it('says when the credentials could not be loaded', async () => {
    mockFetch({ [URL]: { ok: false, error: 'Boom' } })
    render(<YouTubeCredentials />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les identifiants YouTube n'ont pas pu être chargés : Boom"))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
