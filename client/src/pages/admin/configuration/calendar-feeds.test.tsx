import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonBody, mockFetch, requestsTo } from '../../../test-utils'
import { CalendarFeeds } from './calendar-feeds'

const URL = '/api/admin/calendar/feeds'
const TEAM_LINK = 'https://calendar.google.com/calendar/ical/team%40group.calendar.google.com/private-abc/basic.ics'
const TEAM = {
  id: 'feed-1',
  name: "Calendrier de l'équipe",
  kind: 'occupations',
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
  kind: 'holds',
  link: 'https://example.com/stays.ics',
  readAt: null,
  error: "The link can't be read: its server fails (503)",
}
const list = (...feeds: object[]) => ({ [URL]: { ok: true, total: feeds.length, feeds } })

const table = () => screen.getByRole('table', { name: 'Calendriers externes' })
// Each feed's rows: its row, or its form, then the line under it, if it has one.
const feeds = () => within(table()).getAllByRole('rowgroup').slice(1)
// The feed named `name`'s rows, found by its row's header, while its row is shown.
const feedOf = (name: string) => screen.getByRole('rowheader', { name }).closest('tbody')!
const button = (action: 'modifier' | 'retirer', name: string) => screen.getByRole('button', { name: `${action} : ${name}` })
// The form that changes a feed, the only one open.
const editForm = () => screen.getByRole('button', { name: 'enregistrer' }).closest('form')!
// The form that adds a feed, which comes after the list.
const addForm = () => screen.getByRole('button', { name: 'ajouter' }).closest('form')!
const nameField = (form = addForm()) => within(form).getByRole('textbox', { name: 'Nom' })
const linkField = (form = addForm()) => within(form).getByRole('textbox', { name: 'Lien' })
const kindGroup = (form = addForm()) => within(form).getByRole('group', { name: 'Type' })
const kindChoice = (name: 'Occupations' | 'Plages protégées', form = addForm()) => within(kindGroup(form)).getByRole('radio', { name })
const addButton = () => screen.getByRole('button', { name: 'ajouter' })

function fill() {
  fireEvent.change(nameField(), { target: { value: 'Nouveau' } })
  fireEvent.click(kindChoice('Plages protégées'))
  fireEvent.change(linkField(), { target: { value: 'webcal://example.com/secret.ics' } })
}

describe('The calendar feeds', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says when there are none, rather than showing an empty table', async () => {
    mockFetch(list())
    render(<CalendarFeeds />)

    await screen.findByText('Aucun calendrier externe pour le moment.')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('lists the feeds in a table, one per row, with their type and when they were last read, but not their link nor who added them', async () => {
    const unread = { ...TEAM, id: 'feed-3', name: 'Répétitions', readAt: null }
    mockFetch(list(TEAM, STAYS, unread))
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(3))
    expect(within(table()).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Nom', 'Type', 'Dernière lecture', ''])
    expect(within(table()).getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument()
    expect(within(table()).getAllByRole('rowheader').map((header) => header.textContent)).toEqual(["Calendrier de l'équipe", 'Séjours', 'Répétitions'])
    // The cells of each feed's rows, but its name.
    const cells = (name: string) => [...feedOf(name).querySelectorAll('td')].map((cell) => cell.textContent)
    expect(cells("Calendrier de l'équipe")).toEqual(['Occupations', '22 novembre 2026 à 12 h 15', 'modifier retirer'])
    // Its buttons are named after it.
    button('modifier', "Calendrier de l'équipe")
    button('retirer', "Calendrier de l'équipe")
    expect(cells('Séjours').slice(0, 2)).toEqual(['Plages protégées', 'échec'])
    expect(cells('Répétitions').slice(0, 2)).toEqual(['Occupations', 'pas encore lu'])
    expect(table()).not.toHaveTextContent(TEAM_LINK)
    expect(table()).not.toHaveTextContent('admin@example.com')
  })

  it("says why a feed's last read failed on a line under its row, across the table, with when it was last read successfully", async () => {
    const failed = { ...STAYS, readAt: '2026-11-22T12:15:00-05:00' }
    mockFetch(list(TEAM, failed))
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(2))
    const [row, line] = within(feedOf('Séjours')).getAllByRole('row')
    expect(row).toHaveTextContent('Séjours')
    const cell = within(line).getByRole('cell')
    expect(cell).toHaveAttribute('colspan', '4')
    // Its feed's, rather than the first column's.
    expect(cell).toHaveAttribute('headers', screen.getByRole('rowheader', { name: 'Séjours' }).id)
    expect(cell).toHaveTextContent(
      "La dernière lecture a échoué : The link can't be read: its server fails (503). Dernière lecture réussie le 22 novembre 2026 à 12 h 15.",
    )
  })

  it("doesn't say when a feed whose last read failed was last read successfully when it hasn't been", async () => {
    mockFetch(list(STAYS))
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(1))
    expect(within(feedOf('Séjours')).getAllByRole('row')[1]).toHaveTextContent(/^La dernière lecture a échoué : The link can't be read: its server fails \(503\)\.$/)
  })

  it('takes the link as text', async () => {
    mockFetch(list())
    render(<CalendarFeeds />)

    await waitFor(() => expect(linkField()).toBeInTheDocument())
    expect(linkField()).toHaveAttribute('autocomplete', 'off')
  })

  it('adds a feed once its name, its type and its link are filled in, then clears the form and lists it', async () => {
    const added = { ...TEAM, id: 'feed-3', name: 'Nouveau', kind: 'holds', link: 'https://example.com/secret.ics', readAt: '2026-11-22T12:20:00-05:00' }
    mockFetch({ ...list(TEAM), [`POST ${URL}`]: { ok: true, feed: added } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(1))
    expect(addButton()).toBeDisabled()
    // No type is picked at first, so that it's always chosen.
    expect(kindChoice('Occupations')).not.toBeChecked()
    expect(kindChoice('Plages protégées')).not.toBeChecked()
    fireEvent.change(nameField(), { target: { value: 'Nouveau' } })
    fireEvent.change(linkField(), { target: { value: 'webcal://example.com/secret.ics' } })
    expect(addButton()).toBeDisabled()
    fireEvent.click(kindChoice('Plages protégées'))
    expect(addButton()).toBeEnabled()
    fireEvent.click(addButton())
    // The server reads the link first, which takes a while.
    expect(addButton()).toBeDisabled()
    expect(screen.getByText('Lecture du calendrier…')).toBeInTheDocument()

    await waitFor(() => expect(feeds()).toHaveLength(2))
    expect(feeds()[1]).toHaveTextContent('NouveauPlages protégées')
    expect(requestsTo('POST', URL).map(jsonBody)).toEqual([{ name: 'Nouveau', kind: 'holds', link: 'webcal://example.com/secret.ics' }])
    expect(nameField()).toHaveValue('')
    expect(kindChoice('Plages protégées')).not.toBeChecked()
    expect(linkField()).toHaveValue('')
    expect(addButton()).toBeDisabled()
  })

  it("says why a feed couldn't be added, and keeps what was typed", async () => {
    mockFetch({ ...list(TEAM), [`POST ${URL}`]: { ok: false, error: `The feed "Calendrier de l'équipe" already has this link` } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(1))
    fill()
    fireEvent.click(addButton())

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(`Le calendrier n'a pas pu être ajouté : The feed "Calendrier de l'équipe" already has this link`),
    )
    expect(feeds()).toHaveLength(1)
    expect(nameField()).toHaveValue('Nouveau')
    expect(addButton()).toBeEnabled()
  })

  it('changes a feed in a row across the table, with its link and who added it, then shows it as it is then', async () => {
    const changed = { ...TEAM, name: 'Équipe', link: 'https://example.com/new.ics', updatedBy: 'other@example.com', updatedAt: '2026-11-23T09:05:00-05:00' }
    mockFetch({ ...list(TEAM), [`PATCH ${URL}/feed-1`]: { ok: true, feed: changed } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(1))
    fireEvent.click(button('modifier', "Calendrier de l'équipe"))
    // The form replaces the feed's row.
    expect(within(feeds()[0]).getAllByRole('row')).toHaveLength(1)
    const cell = within(feeds()[0]).getByRole('cell')
    expect(cell).toHaveAttribute('colspan', '4')
    expect(within(cell).getByText('Ajouté par admin@example.com le 7 novembre 2026 à 16 h 30.')).toBeInTheDocument()
    // It hasn't been changed.
    expect(cell).not.toHaveTextContent('Modifié')
    const form = editForm()
    expect(cell).toContainElement(form)
    expect(nameField(form)).toHaveValue("Calendrier de l'équipe")
    expect(kindChoice('Occupations', form)).toBeChecked()
    expect(linkField(form)).toHaveValue(TEAM_LINK)
    fireEvent.change(nameField(form), { target: { value: 'Équipe' } })
    fireEvent.change(linkField(form), { target: { value: 'https://example.com/new.ics' } })
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))
    // The server reads the new link first.
    expect(within(form).getByText('Lecture du calendrier…')).toBeInTheDocument()

    await waitFor(() => expect(screen.queryByRole('button', { name: 'enregistrer' })).toBeNull())
    expect(requestsTo('PATCH', `${URL}/feed-1`).map(jsonBody)).toEqual([{ name: 'Équipe', link: 'https://example.com/new.ics' }])
    expect(feedOf('Équipe')).toBeInTheDocument()
    // The add form is as it was.
    expect(nameField()).toHaveValue('')

    // Who changed it is in its form.
    fireEvent.click(button('modifier', 'Équipe'))
    expect(within(feeds()[0]).getByText('Modifié par other@example.com le 23 novembre 2026 à 09 h 05.')).toBeInTheDocument()
    expect(linkField(editForm())).toHaveValue('https://example.com/new.ics')
  })

  it("keeps the line that says why a feed's last read failed under its form", async () => {
    mockFetch(list(STAYS))
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(1))
    fireEvent.click(button('modifier', 'Séjours'))
    const [form, line] = within(feeds()[0]).getAllByRole('row')
    expect(within(form).getByRole('button', { name: 'enregistrer' })).toBeInTheDocument()
    expect(line).toHaveTextContent(/^La dernière lecture a échoué/)
    // Its feed's row, whose header it was associated with, isn't shown.
    expect(within(line).getByRole('cell')).not.toHaveAttribute('headers')
  })

  it('only sends what was changed, and nothing when nothing was, and gives the focus to the name, then back to "modifier"', async () => {
    mockFetch({ ...list(TEAM), [`PATCH ${URL}/feed-1`]: { ok: true, feed: { ...TEAM, name: 'Équipe' } } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(1))
    fireEvent.click(button('modifier', "Calendrier de l'équipe"))
    let form = editForm()
    expect(nameField(form)).toHaveFocus()
    // The link as it was typed, with spaces around it, isn't a change.
    fireEvent.change(linkField(form), { target: { value: ` ${TEAM_LINK} ` } })
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(button('modifier', "Calendrier de l'équipe")).toHaveFocus())
    expect(requestsTo('PATCH', `${URL}/feed-1`)).toHaveLength(0)

    fireEvent.click(button('modifier', "Calendrier de l'équipe"))
    form = editForm()
    fireEvent.change(nameField(form), { target: { value: 'Équipe' } })
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(button('modifier', 'Équipe')).toHaveFocus())
    expect(requestsTo('PATCH', `${URL}/feed-1`).map(jsonBody)).toEqual([{ name: 'Équipe' }])

    fireEvent.click(button('modifier', 'Équipe'))
    fireEvent.click(within(feeds()[0]).getByRole('button', { name: 'annuler' }))
    expect(button('modifier', 'Équipe')).toHaveFocus()
  })

  it('changes only the type, without the server reading the link', async () => {
    mockFetch({ ...list(TEAM), [`PATCH ${URL}/feed-1`]: { ok: true, feed: { ...TEAM, kind: 'holds' } } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(1))
    fireEvent.click(button('modifier', "Calendrier de l'équipe"))
    const form = editForm()
    fireEvent.click(kindChoice('Plages protégées', form))
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))
    expect(within(form).queryByText('Lecture du calendrier…')).toBeNull()

    await waitFor(() => expect(feedOf("Calendrier de l'équipe")).toHaveTextContent('Plages protégées'))
    expect(requestsTo('PATCH', `${URL}/feed-1`).map(jsonBody)).toEqual([{ kind: 'holds' }])
  })

  it("says why a feed couldn't be changed, and keeps its form open, until it's cancelled", async () => {
    mockFetch({ ...list(TEAM, STAYS), [`PATCH ${URL}/feed-1`]: { ok: false, error: 'The feed "Séjours" already has this link' } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(2))
    fireEvent.click(button('modifier', "Calendrier de l'équipe"))
    const form = editForm()
    fireEvent.change(linkField(form), { target: { value: 'https://example.com/stays.ics' } })
    fireEvent.click(within(form).getByRole('button', { name: 'enregistrer' }))

    // In the form's row.
    await waitFor(() =>
      expect(within(feeds()[0]).getByRole('alert')).toHaveTextContent(`Le calendrier n'a pas pu être enregistré : The feed "Séjours" already has this link`),
    )
    expect(linkField(form)).toHaveValue('https://example.com/stays.ics')
    fireEvent.click(within(form).getByRole('button', { name: 'annuler' }))
    expect(feedOf("Calendrier de l'équipe")).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removes a feed once the admin confirms', async () => {
    mockFetch({ ...list(TEAM, STAYS), [`DELETE ${URL}/feed-1`]: { ok: true } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(2))
    fireEvent.click(button('retirer', "Calendrier de l'équipe"))
    expect(confirm).toHaveBeenCalledWith("Retirer le calendrier « Calendrier de l'équipe » ?")
    expect(requestsTo('DELETE', `${URL}/feed-1`)).toHaveLength(0)

    fireEvent.click(button('retirer', "Calendrier de l'équipe"))
    await waitFor(() => expect(feeds()).toHaveLength(1))
    expect(feeds()[0]).toHaveTextContent('Séjours')
  })

  it("says why a feed couldn't be removed on the line under its row, with why its last read failed", async () => {
    mockFetch({ ...list(TEAM, STAYS), [`DELETE ${URL}/feed-1`]: { ok: false, error: 'Boom' }, [`DELETE ${URL}/feed-2`]: { ok: false, error: 'Bang' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CalendarFeeds />)

    await waitFor(() => expect(feeds()).toHaveLength(2))
    fireEvent.click(button('retirer', "Calendrier de l'équipe"))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Le calendrier n'a pas pu être retiré : Boom"))
    const [, line] = within(feedOf("Calendrier de l'équipe")).getAllByRole('row')
    expect(line).toHaveTextContent(/^Le calendrier n'a pas pu être retiré : Boom$/)
    expect(feeds()).toHaveLength(2)

    fireEvent.click(button('retirer', 'Séjours'))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    const lines = within(feedOf('Séjours')).getAllByRole('row')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toHaveTextContent(/^La dernière lecture a échoué : .*\.Le calendrier n'a pas pu être retiré : Bang$/)
  })

  it("says when the feeds couldn't be loaded", async () => {
    mockFetch({ [URL]: { ok: false, error: 'Boom' } })
    render(<CalendarFeeds />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les calendriers externes n'ont pas pu être chargés : Boom"))
  })
})
