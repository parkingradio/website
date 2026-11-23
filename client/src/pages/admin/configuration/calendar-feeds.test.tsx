import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../../../test-utils'
import { CalendarFeeds } from './calendar-feeds'

const URL = '/api/admin/calendar/feeds'
const TEAM = {
  id: 'feed-1',
  name: "Calendrier de l'équipe",
  kind: 'occupation',
  createdBy: 'admin@example.com',
  createdAt: '2026-11-07T16:30:00-05:00',
  readAt: '2026-11-22T12:15:00-05:00',
  error: null,
}
const STAYS = { ...TEAM, id: 'feed-2', name: 'Séjours', kind: 'quiet-time', readAt: null, error: "The link can't be read: its server fails (503)" }
const list = (...feeds: object[]) => ({ [URL]: { ok: true, total: feeds.length, feeds } })

const nameField = () => screen.getByRole('textbox', { name: 'Nom' })
const linkField = () => screen.getByLabelText('Lien')
const addButton = () => screen.getByRole('button', { name: 'ajouter' })
const items = () => screen.queryAllByRole('listitem').filter((item) => item.closest('.admin-list'))

function fill(kind: 'occupations' | 'silence' = 'occupations') {
  fireEvent.change(nameField(), { target: { value: 'Nouveau' } })
  fireEvent.click(screen.getByRole('radio', { name: kind }))
  fireEvent.change(linkField(), { target: { value: 'webcal://example.com/secret.ics' } })
}

describe('The calendar feeds', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says when there are none', async () => {
    mockFetch(list())
    render(<CalendarFeeds />)

    await screen.findByText('Aucun calendrier externe pour le moment.')
  })

  it('lists each feed with its kind, who added it, and when it was last read, or why that failed', async () => {
    mockFetch(list(TEAM, STAYS))
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(2))
    const [team, stays] = items()
    expect(team).toHaveTextContent("Calendrier de l'équipe (occupations)")
    expect(within(team).getByText(/^Ajouté par admin@example.com le 7 novembre 2026/)).toHaveTextContent(/Lu le 22 novembre 2026 à 12 h 15\.$/)
    expect(team).not.toHaveTextContent('a échoué')
    expect(stays).toHaveTextContent('Séjours (silence)')
    expect(stays).toHaveTextContent('Pas encore lu.')
    expect(within(stays).getByText(/^La dernière lecture a échoué/)).toHaveTextContent("La dernière lecture a échoué : The link can't be read: its server fails (503)")
  })

  it('takes the link as a secret, whose field shows dots', async () => {
    mockFetch(list())
    render(<CalendarFeeds />)

    await waitFor(() => expect(linkField()).toBeInTheDocument())
    expect(linkField()).toHaveAttribute('type', 'password')
    expect(linkField()).toHaveAttribute('autocomplete', 'off')
  })

  it('adds a feed once its name, kind and link are filled in, then clears the form and lists it', async () => {
    mockFetch({ ...list(TEAM), [`POST ${URL}`]: { ok: true, feed: { ...STAYS, id: 'feed-3', name: 'Nouveau', error: null, readAt: '2026-11-22T12:20:00-05:00' } } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(1))
    expect(addButton()).toBeDisabled()
    fill('silence')
    expect(addButton()).toBeEnabled()
    fireEvent.click(addButton())
    // The server reads the link first, which takes a while.
    expect(addButton()).toBeDisabled()
    expect(screen.getByText('Lecture du calendrier…')).toBeInTheDocument()

    await waitFor(() => expect(items()).toHaveLength(2))
    expect(items()[1]).toHaveTextContent('Nouveau (silence)')
    expect(requestsTo('POST', URL).map(jsonBody)).toEqual([{ name: 'Nouveau', kind: 'quiet-time', link: 'webcal://example.com/secret.ics' }])
    expect(nameField()).toHaveValue('')
    expect(linkField()).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'silence' })).not.toBeChecked()
    expect(addButton()).toBeDisabled()
  })

  it("says why a feed couldn't be added, and keeps what was typed", async () => {
    mockFetch({ ...list(TEAM), [`POST ${URL}`]: { ok: false, error: `The feed "Calendrier de l'équipe" already has this link` } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(1))
    fill()
    fireEvent.click(addButton())

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(`Le calendrier n'a pas pu être ajouté : The feed "Calendrier de l'équipe" already has this link`),
    )
    expect(items()).toHaveLength(1)
    expect(nameField()).toHaveValue('Nouveau')
    expect(addButton()).toBeEnabled()
  })

  it('removes a feed once the admin confirms', async () => {
    mockFetch({ ...list(TEAM, STAYS), [`DELETE ${URL}/feed-1`]: { ok: true } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(2))
    fireEvent.click(within(items()[0]).getByRole('button', { name: 'retirer' }))
    expect(confirm).toHaveBeenCalledWith("Retirer le calendrier «\u00a0Calendrier de l'équipe\u00a0» ? Pour l'ajouter à nouveau, il faudra son lien.")
    expect(requestsTo('DELETE', `${URL}/feed-1`)).toHaveLength(0)

    fireEvent.click(within(items()[0]).getByRole('button', { name: 'retirer' }))
    await waitFor(() => expect(items()).toHaveLength(1))
    expect(items()[0]).toHaveTextContent('Séjours')
  })

  it("says why a feed couldn't be removed", async () => {
    mockFetch({ ...list(TEAM), [`DELETE ${URL}/feed-1`]: { ok: false, error: 'Boom' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(1))
    fireEvent.click(within(items()[0]).getByRole('button', { name: 'retirer' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Le calendrier n'a pas pu être retiré : Boom"))
    expect(items()).toHaveLength(1)
  })

  it("says when the feeds couldn't be loaded", async () => {
    mockFetch({ [URL]: { ok: false, error: 'Boom' } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les calendriers externes n'ont pas pu être chargés : Boom"))
  })
})
