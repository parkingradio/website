import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../../../test-utils'
import { CalendarFeeds } from './calendar-feeds'

const URL = '/api/admin/calendar/feeds'
const TEAM_LINK = 'https://calendar.google.com/calendar/ical/team%40group.calendar.google.com/private-abc/basic.ics'
const TEAM = {
  id: 'feed-1',
  name: "Calendrier de l'équipe",
  link: TEAM_LINK,
  createdBy: 'admin@example.com',
  createdAt: '2026-11-07T16:30:00-05:00',
  updatedBy: null,
  updatedAt: null,
  readAt: '2026-11-22T12:15:00-05:00',
  error: null,
}
const STAYS = {
  ...TEAM,
  id: 'feed-2',
  name: 'Séjours',
  link: 'https://example.com/stays.ics',
  readAt: null,
  error: "The link can't be read: its server fails (503)",
}
const list = (...feeds: object[]) => ({ [URL]: { ok: true, total: feeds.length, feeds } })

const items = () => screen.queryAllByRole('listitem').filter((item) => item.closest('.admin-list'))
// The form that adds a feed, which comes after the list.
const addForm = () => screen.getByRole('button', { name: 'ajouter' }).closest('form')!
const nameField = (form = addForm()) => within(form).getByRole('textbox', { name: 'Nom' })
const linkField = (form = addForm()) => within(form).getByRole('textbox', { name: 'Lien' })
const addButton = () => screen.getByRole('button', { name: 'ajouter' })

function fill() {
  fireEvent.change(nameField(), { target: { value: 'Nouveau' } })
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

  it('lists each feed with its link, who added it, and when it was last read, or why that failed', async () => {
    mockFetch(list(TEAM, STAYS))
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(2))
    const [team, stays] = items()
    expect(team).toHaveTextContent("Calendrier de l'équipe modifier retirer")
    expect(within(team).getByText(TEAM_LINK)).toBeInTheDocument()
    expect(within(team).queryByRole('link')).toBeNull()
    expect(within(team).getByText(/^Ajouté par admin@example.com le 7 novembre 2026/)).toHaveTextContent(/Lu le 22 novembre 2026 à 12 h 15\.$/)
    expect(team).not.toHaveTextContent('a échoué')
    expect(stays).toHaveTextContent('Séjours')
    expect(stays).toHaveTextContent('https://example.com/stays.ics')
    expect(stays).toHaveTextContent('Pas encore lu.')
    expect(within(stays).getByText(/^La dernière lecture a échoué/)).toHaveTextContent("La dernière lecture a échoué : The link can't be read: its server fails (503)")
  })

  it('takes the link as text', async () => {
    mockFetch(list())
    render(<CalendarFeeds />)

    await waitFor(() => expect(linkField()).toBeInTheDocument())
    expect(linkField()).toHaveAttribute('autocomplete', 'off')
  })

  it('adds a feed once its name and link are filled in, then clears the form and lists it', async () => {
    const added = { ...TEAM, id: 'feed-3', name: 'Nouveau', link: 'https://example.com/secret.ics', readAt: '2026-11-22T12:20:00-05:00' }
    mockFetch({ ...list(TEAM), [`POST ${URL}`]: { ok: true, feed: added } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(1))
    expect(addButton()).toBeDisabled()
    fill()
    expect(addButton()).toBeEnabled()
    fireEvent.click(addButton())
    // The server reads the link first, which takes a while.
    expect(addButton()).toBeDisabled()
    expect(screen.getByText('Lecture du calendrier…')).toBeInTheDocument()

    await waitFor(() => expect(items()).toHaveLength(2))
    expect(items()[1]).toHaveTextContent('Nouveau')
    expect(requestsTo('POST', URL).map(jsonBody)).toEqual([{ name: 'Nouveau', link: 'webcal://example.com/secret.ics' }])
    expect(nameField()).toHaveValue('')
    expect(linkField()).toHaveValue('')
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

  it('changes a feed in a form filled in with it, then shows it as it is then', async () => {
    const changed = { ...TEAM, name: 'Équipe', link: 'https://example.com/new.ics', updatedBy: 'admin@example.com' }
    mockFetch({ ...list(TEAM), [`PATCH ${URL}/feed-1`]: { ok: true, feed: changed } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(1))
    fireEvent.click(within(items()[0]).getByRole('button', { name: 'modifier' }))
    const form = within(items()[0]).getByRole('button', { name: 'enregistrer' }).closest('form')!
    expect(nameField(form)).toHaveValue("Calendrier de l'équipe")
    expect(linkField(form)).toHaveValue(TEAM_LINK)
    fireEvent.change(nameField(form), { target: { value: 'Équipe' } })
    fireEvent.change(linkField(form), { target: { value: 'https://example.com/new.ics' } })
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))
    // The server reads the new link first.
    expect(within(form).getByText('Lecture du calendrier…')).toBeInTheDocument()

    await waitFor(() => expect(within(items()[0]).queryByRole('button', { name: 'enregistrer' })).toBeNull())
    expect(requestsTo('PATCH', `${URL}/feed-1`).map(jsonBody)).toEqual([{ name: 'Équipe', link: 'https://example.com/new.ics' }])
    expect(items()[0]).toHaveTextContent('Équipe')
    expect(items()[0]).toHaveTextContent('https://example.com/new.ics')
    // The add form is as it was.
    expect(nameField()).toHaveValue('')
  })

  it('only sends what was changed, and nothing when nothing was, and gives the focus to the name, then back to "modifier"', async () => {
    mockFetch({ ...list(TEAM), [`PATCH ${URL}/feed-1`]: { ok: true, feed: { ...TEAM, name: 'Équipe' } } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(1))
    const modifier = () => within(items()[0]).getByRole('button', { name: 'modifier' })
    fireEvent.click(modifier())
    let form = within(items()[0]).getByRole('button', { name: 'enregistrer' }).closest('form')!
    expect(nameField(form)).toHaveFocus()
    // The link as it was typed, with spaces around it, isn't a change.
    fireEvent.change(linkField(form), { target: { value: ` ${TEAM_LINK} ` } })
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(modifier()).toHaveFocus())
    expect(requestsTo('PATCH', `${URL}/feed-1`)).toHaveLength(0)

    fireEvent.click(modifier())
    form = within(items()[0]).getByRole('button', { name: 'enregistrer' }).closest('form')!
    fireEvent.change(nameField(form), { target: { value: 'Équipe' } })
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(modifier()).toHaveFocus())
    expect(requestsTo('PATCH', `${URL}/feed-1`).map(jsonBody)).toEqual([{ name: 'Équipe' }])
    expect(items()[0]).toHaveTextContent('Équipe')

    fireEvent.click(modifier())
    fireEvent.click(within(items()[0]).getByRole('button', { name: 'annuler' }))
    expect(modifier()).toHaveFocus()
  })

  it("says why a feed couldn't be changed, and keeps its form open, until it's cancelled", async () => {
    mockFetch({ ...list(TEAM, STAYS), [`PATCH ${URL}/feed-1`]: { ok: false, error: 'The feed "Séjours" already has this link' } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(2))
    fireEvent.click(within(items()[0]).getByRole('button', { name: 'modifier' }))
    const form = within(items()[0]).getByRole('button', { name: 'enregistrer' }).closest('form')!
    fireEvent.change(linkField(form), { target: { value: 'https://example.com/stays.ics' } })
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(`Le calendrier n'a pas pu être enregistré : The feed "Séjours" already has this link`),
    )
    expect(linkField(form)).toHaveValue('https://example.com/stays.ics')
    fireEvent.click(within(form).getByRole('button', { name: 'annuler' }))
    expect(items()[0]).toHaveTextContent(TEAM_LINK)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removes a feed once the admin confirms', async () => {
    mockFetch({ ...list(TEAM, STAYS), [`DELETE ${URL}/feed-1`]: { ok: true } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<CalendarFeeds />)

    await waitFor(() => expect(items()).toHaveLength(2))
    fireEvent.click(within(items()[0]).getByRole('button', { name: 'retirer' }))
    expect(confirm).toHaveBeenCalledWith("Retirer le calendrier «\u00a0Calendrier de l'équipe\u00a0» ?")
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
