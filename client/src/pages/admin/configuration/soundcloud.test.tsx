import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../../../test-utils'
import { SoundCloudCredentials } from './soundcloud'

describe('The SoundCloud app', () => {
  const URL = '/api/admin/radio/credentials'
  const CHECK_URL = `${URL}/check`
  // No credentials yet, as on a new server.
  const NONE = { [URL]: { ok: true, credentials: null } }
  const entered = (error: string | null = null) => ({
    ok: true,
    credentials: { clientId: 'client-id', updatedBy: 'admin@example.com', updatedAt: '2026-10-07T16:30:00.000Z', error },
  })
  const ENTERED = entered()
  const ACCEPTED = { [`POST ${CHECK_URL}`]: { ok: true } }

  const clientId = () => screen.getByRole('textbox', { name: 'Client ID' })
  const clientSecret = () => screen.getByLabelText('Client secret')
  const verifyButton = () => screen.getByRole('button', { name: 'vérifier' })
  const saveButton = () => screen.getByRole('button', { name: 'enregistrer' })
  const verified = () => screen.queryByRole('status', { name: 'Identifiants acceptés par SoundCloud' })
  const saved = () => screen.queryByRole('status', { name: 'Identifiants enregistrés' })
  const failedRead = () => screen.queryByText(/^La dernière lecture de la playlist de la radio a échoué/)
  const type = (id: string, secret: string) => {
    fireEvent.change(clientId(), { target: { value: id } })
    fireEvent.change(clientSecret(), { target: { value: secret } })
  }

  it('shows who entered the credentials, the client ID, and dots for the secret, which is never sent back', async () => {
    mockFetch({ [URL]: ENTERED })
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(clientId()).toHaveValue('client-id'))
    expect(screen.getByText(/^Changés par admin@example.com le 7 octobre 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Aucun identifiant/)).not.toBeInTheDocument()
    expect(failedRead()).not.toBeInTheDocument()
    // Only in the field.
    expect(screen.queryByText('client-id')).not.toBeInTheDocument()
    expect(clientSecret()).toHaveValue('')
    expect(clientSecret()).toHaveAttribute('type', 'password')
    expect(clientSecret()).toHaveAttribute('placeholder', '•'.repeat(32))
    // They were verified when they were saved, so there's nothing to do until another secret is typed.
    expect(verifyButton()).toBeDisabled()
    expect(saveButton()).toBeDisabled()
  })

  it('says that the radio is off air until the credentials are entered', async () => {
    mockFetch(NONE)
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(screen.getByText(/Aucun identifiant/)).toBeInTheDocument())
    expect(clientId()).toHaveValue('')
    expect(clientSecret()).not.toHaveAttribute('placeholder')
    expect(screen.queryByText(/^Changés par/)).not.toBeInTheDocument()
  })

  it("says why the radio's last read of its playlist failed", async () => {
    mockFetch({ [URL]: entered('SoundCloud refused to issue a token: 401') })
    render(<SoundCloudCredentials />)

    await waitFor(() =>
      expect(failedRead()).toHaveTextContent('La dernière lecture de la playlist de la radio a échoué : SoundCloud refused to issue a token: 401'),
    )
  })

  it('verifies the credentials once both are typed, and only then lets them be saved', async () => {
    mockFetch({ ...NONE, ...ACCEPTED })
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(clientId()).toBeInTheDocument())
    fireEvent.change(clientId(), { target: { value: 'client-id' } })
    expect(verifyButton()).toBeDisabled()
    fireEvent.change(clientSecret(), { target: { value: 'client-secret' } })
    expect(verifyButton()).toBeEnabled()
    expect(saveButton()).toBeDisabled()

    fireEvent.click(verifyButton())

    await waitFor(() => expect(verified()).toHaveTextContent('✓'))
    expect(requestsTo('POST', CHECK_URL).map(jsonBody)).toEqual([{ clientId: 'client-id', clientSecret: 'client-secret' }])
    expect(requestsTo('PUT', URL)).toEqual([])
    expect(verifyButton()).toBeDisabled()
    expect(saveButton()).toBeEnabled()
  })

  it('has to verify the credentials again once they are changed', async () => {
    mockFetch({ ...NONE, ...ACCEPTED })
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(clientId()).toBeInTheDocument())
    type('client-id', 'client-secret')
    fireEvent.click(verifyButton())
    await waitFor(() => expect(saveButton()).toBeEnabled())

    fireEvent.change(clientSecret(), { target: { value: 'other-secret' } })

    expect(verified()).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(verifyButton()).toBeEnabled()
  })

  it('saves verified credentials, and says so until they are changed again', async () => {
    mockFetch({ ...NONE, ...ACCEPTED, [`PUT ${URL}`]: ENTERED })
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(clientId()).toBeInTheDocument())
    type('client-id', 'client-secret')
    fireEvent.click(verifyButton())
    await waitFor(() => expect(saveButton()).toBeEnabled())
    fireEvent.click(saveButton())
    // Nothing can be sent again while they're being saved.
    expect(saveButton()).toBeDisabled()

    await waitFor(() => expect(saved()).toHaveTextContent('✓'))
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ clientId: 'client-id', clientSecret: 'client-secret' }])
    expect(screen.getByText(/^Changés par admin@example.com le 7 octobre 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Aucun identifiant/)).not.toBeInTheDocument()
    expect(clientId()).toHaveValue('client-id')
    expect(clientSecret()).toHaveValue('')
    expect(clientSecret()).toHaveAttribute('placeholder', '•'.repeat(32))
    expect(saveButton()).toBeDisabled()

    fireEvent.change(clientSecret(), { target: { value: 'other-secret' } })
    expect(saved()).not.toBeInTheDocument()
  })

  it('says why reading the playlist through the credentials saved failed, if it did', async () => {
    mockFetch({ ...NONE, ...ACCEPTED, [`PUT ${URL}`]: entered('SoundCloud responded to /playlists with 500') })
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(clientId()).toBeInTheDocument())
    type('client-id', 'client-secret')
    fireEvent.click(verifyButton())
    await waitFor(() => expect(saveButton()).toBeEnabled())
    fireEvent.click(saveButton())

    await waitFor(() => expect(saved()).toHaveTextContent('✓'))
    expect(failedRead()).toHaveTextContent('SoundCloud responded to /playlists with 500')
  })

  it('says why the credentials could not be verified, and keeps what was typed', async () => {
    mockFetch({ [URL]: ENTERED, [`POST ${CHECK_URL}`]: { ok: false, error: 'SoundCloud refused these credentials' } })
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(clientId()).toBeInTheDocument())
    type('wrong-id', 'wrong-secret')
    fireEvent.click(verifyButton())

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Les identifiants n'ont pas pu être vérifiés : SoundCloud refused these credentials"),
    )
    expect(clientId()).toHaveValue('wrong-id')
    expect(clientSecret()).toHaveValue('wrong-secret')
    expect(verified()).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    // The ones that were saved stay.
    expect(screen.getByText(/^Changés par admin@example.com le 7 octobre 2026/)).toBeInTheDocument()
  })

  it('says why verified credentials could not be saved', async () => {
    mockFetch({ ...NONE, ...ACCEPTED, [`PUT ${URL}`]: { ok: false, error: 'The credentials cannot be checked with SoundCloud' } })
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(clientId()).toBeInTheDocument())
    type('client-id', 'client-secret')
    fireEvent.click(verifyButton())
    await waitFor(() => expect(saveButton()).toBeEnabled())
    fireEvent.click(saveButton())

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Les identifiants n'ont pas pu être enregistrés : The credentials cannot be checked with SoundCloud"),
    )
    expect(saved()).not.toBeInTheDocument()
    expect(clientSecret()).toHaveValue('client-secret')
    // They can be saved again.
    expect(saveButton()).toBeEnabled()
  })

  it('says when the credentials could not be loaded', async () => {
    mockFetch({ [URL]: { ok: false, error: 'Boom' } })
    render(<SoundCloudCredentials />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les identifiants SoundCloud n'ont pas pu être chargés : Boom"))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
