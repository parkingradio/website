import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import App from '../../app'
import type { Session } from '../../session-fields'
import { held, mockFetch, requestsTo, visibleText as shownText } from '../../test-utils'
import type { Calendar } from './calendrier/model'

// Today is Thursday, November 19, 2026, in Québec.
const NOW = new Date('2026-11-19T12:00:00-05:00')
const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }
const NOVEMBER = '/api/admin/calendar?from=2026-11-01&to=2026-12-05'
const DECEMBER = '/api/admin/calendar?from=2026-11-29&to=2027-01-02'
const OCTOBER = '/api/admin/calendar?from=2026-09-27&to=2026-10-31'

function session(id: string, title: string, start: string | null, end: string | null, fields: Partial<Session> = {}): Session {
  return { id, title, start, end, durationMinutes: 180, status: 'planned', sets: [], createdAt: '2026-10-01T12:00:00Z', ...fields } as Session
}

const performers = (...names: string[]) => ({ performers: names.map((name) => ({ id: name, name })) })
const TEAM = { id: 'team', name: "Calendrier de l'équipe", kind: 'occupation', createdBy: 'admin@example.com', createdAt: '2026-11-01T12:00:00Z', readAt: '2026-11-19T11:50:00-05:00', error: null } as const
const STAYS = { ...TEAM, id: 'stays', name: 'Séjours', kind: 'quiet-time', error: "The link can't be read: its server fails (503)" } as const

const TAKEOVER = session('session-1', 'HAUTE RIVE TAKEOVER', '2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00', { sets: [performers('Aurore', 'Brume'), performers('Cyan')] as Session['sets'] })
const PLAYED = session('session-2', 'SOIRÉE', '2026-11-07T20:00:00-05:00', '2026-11-07T23:00:00-05:00', { status: 'done' })
const CANCELLED = session('session-3', 'LIVE PERFORMANCE', '2026-11-24T20:00:00-05:00', '2026-11-24T23:00:00-05:00', { status: 'cancelled' })
const UNDATED = session('session-4', 'LES SŒURS ONDES TAKEOVER', null, null, { sets: [performers('Ondine'), performers('Écume')] as Session['sets'] })
const REPAIR = { feed: 'team', start: '2026-11-26T10:00:00-05:00', end: '2026-11-26T16:00:00-05:00', wholeDay: false, title: 'RÉPARATION' }
const CLOSED = { feed: 'team', start: '2026-12-02T00:00:00-05:00', end: '2026-12-04T00:00:00-05:00', wholeDay: true, title: '' }
const STAY = { feed: 'stays', start: '2026-11-20T15:00:00-05:00', end: '2026-11-22T11:00:00-05:00', wholeDay: false }
// The stay and the takeover, as the server gives them.
const CONFLICT = {
  start: TAKEOVER.start!,
  end: TAKEOVER.end!,
  things: [
    { kind: 'quiet-time', ...STAY },
    { kind: 'session', id: TAKEOVER.id, title: TAKEOVER.title, start: TAKEOVER.start!, end: TAKEOVER.end!, status: 'planned' },
  ],
} as Calendar['conflicts'][number]

const CALENDAR: Calendar = {
  ok: true,
  today: '2026-11-19',
  feeds: [TEAM, STAYS],
  sessions: [PLAYED, TAKEOVER, CANCELLED],
  occupations: [REPAIR, CLOSED],
  quietTimes: [STAY],
  conflicts: [CONFLICT],
  undatedSessions: [UNDATED],
}
const EMPTY: Calendar = { ...CALENDAR, sessions: [], occupations: [], quietTimes: [] }

// Where the page is, and a way back.
function CurrentPath() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <div data-testid="path">{location.pathname + location.search}</div>
      <button type="button" data-testid="back" onClick={() => navigate(-1)} />
    </>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} useTransitions={false}>
      <App />
      <CurrentPath />
    </MemoryRouter>,
  )
}

// What an element shows, with its non-breaking spaces as spaces.
const visibleText = (element: Element) => shownText(element).replace(/\u00a0/g, ' ')
const path = () => screen.getByTestId('path').textContent
const back = () => fireEvent.click(screen.getByTestId('back'))
const dayButton = (day: string) => document.querySelector<HTMLButtonElement>(`.calendar-month [data-day="${day}"]`)!
const cell = (day: string) => dayButton(day).closest('td')!
const cellText = (day: string) => visibleText(cell(day))
const chosenDay = () => screen.queryByRole('region', { name: /2026/ })
const loaded = () => screen.findByRole('heading', { name: 'Sources' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())

describe('Calendrier', () => {
  describe('asks for the days of its grid', () => {
    it("of today's month, unless the address gives one, and the server's", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY })
      const first = renderAt('/admin/calendrier')
      await loaded()
      expect(requestsTo('GET', NOVEMBER)).toHaveLength(1)
      expect(screen.getByRole('heading', { name: 'novembre 2026' })).toBeInTheDocument()
      first.unmount()

      renderAt('/admin/calendrier?month=2026-12')
      await waitFor(() => expect(requestsTo('GET', DECEMBER)).toHaveLength(1))
      expect(screen.getByRole('heading', { name: 'décembre 2026' })).toBeInTheDocument()
    })

    it('ignores a month it does not know', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier?month=2026-13')
      await loaded()
      expect(requestsTo('GET', NOVEMBER)).toHaveLength(1)
    })

    it('within the days the server takes', async () => {
      mockFetch({ ...LOGGED_IN, '/api/admin/calendar?from=2000-01-01&to=2000-02-05': EMPTY })
      renderAt('/admin/calendrier?month=2000-01')
      await loaded()
      // The grid starts on Sunday, December 26, 1999, which has no things.
      expect(dayButton('1999-12-26')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'mois précédent' })).toHaveAttribute('aria-disabled', 'true')
    })

    it('of the month before and after, which add a step to the history and unchoose the day, and today', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY, [OCTOBER]: EMPTY })
      renderAt('/admin/calendrier?day=2026-11-21')
      await loaded()

      fireEvent.click(screen.getByRole('button', { name: 'mois suivant' }))
      expect(path()).toBe('/admin/calendrier?month=2026-12')
      await waitFor(() => expect(requestsTo('GET', DECEMBER)).toHaveLength(1))
      fireEvent.click(screen.getByRole('button', { name: 'mois précédent' }))
      fireEvent.click(screen.getByRole('button', { name: 'mois précédent' }))
      await waitFor(() => expect(requestsTo('GET', OCTOBER)).toHaveLength(1))
      expect(screen.getByRole('heading', { name: 'octobre 2026' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: "aujourd'hui" }))
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-19')
      expect(dayButton('2026-11-19')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('link', { name: 'nouvelle session' })).toHaveAttribute('href', '/admin/sessions/nouvelle')
    })
  })

  describe('the month', () => {
    it('goes from Sunday to Saturday, with the days of the other months faded out, and today', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const table = screen.getByRole('table', { name: 'novembre 2026' })
      expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'])
      expect(table.querySelectorAll('tbody tr')).toHaveLength(5)
      expect(cell('2026-12-01')).toHaveClass('calendar-other-month')
      expect(cell('2026-11-30')).not.toHaveClass('calendar-other-month')
      expect(screen.getByRole('button', { name: 'jeudi 19 novembre 2026' })).toHaveAttribute('aria-current', 'date')
      expect(dayButton('2026-11-18')).not.toHaveAttribute('aria-current')
    })

    it('shows what takes each day, with its kind, its part of the day, and its status', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      expect(cellText('2026-11-21')).toBe('21toute la journéesilenceconflit21 h – 1 hsession : HAUTE RIVE TAKEOVERAurore, Brume · Cyanconflit')
      expect(within(cell('2026-11-21')).getByRole('link', { name: 'HAUTE RIVE TAKEOVER' })).toHaveAttribute('href', '/admin/sessions/session-1')
      expect(cellText('2026-11-22')).toBe("22jusqu'à 11 hsilenceconflitjusqu'à 1 hsession : HAUTE RIVE TAKEOVERAurore, Brume · Cyanconflitdispo dès 11 h")
      expect(cellText('2026-11-07')).toBe('720 h – 23 hsession : SOIRÉE jouée')
      expect(cell('2026-11-07').querySelector('li')).toHaveClass('admin-status-done')
      expect(cellText('2026-11-24')).toContain('session : LIVE PERFORMANCE annulée')
      expect(cellText('2026-11-26')).toBe('2610 h – 16 hoccupation : RÉPARATION')
      // Things of the other months too.
      expect(cellText('2026-12-02')).toBe('2toute la journéeoccupation : sans titre')
    })

    it("describes each day's button with what's on the day", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      // Its list, whose text jsdom puts together without the spaces that its lines have in a browser.
      const description = (day: string) => document.getElementById(dayButton(day).getAttribute('aria-describedby')!)
      expect(description('2026-11-26')).toBe(cell('2026-11-26').querySelector('ul'))
      expect(dayButton('2026-11-19')).toHaveAccessibleDescription('disponible')
      expect(dayButton('2026-11-18')).not.toHaveAttribute('aria-describedby')
    })

    it('says "conflit" on the days the overlap takes some of', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      expect(cellText('2026-11-20')).toBe("20dès 15 hsilencedispo jusqu'à 15 h")
      expect(cell('2026-11-21').querySelectorAll('.calendar-conflict')).toHaveLength(2)
      expect(cell('2026-11-22').querySelectorAll('.calendar-conflict')).toHaveLength(2)
    })

    it('shows free time from today on, in the month, on the days on which no session or occupation starts', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const free = (day: string) => [...cell(day).querySelectorAll('.calendar-free')].map((tag) => tag.textContent)
      expect(free('2026-11-18')).toEqual([])
      expect(free('2026-11-19')).toEqual(['disponible'])
      expect(cell('2026-11-19')).toHaveClass('calendar-available')
      expect(free('2026-11-20')).toEqual(["dispo jusqu'à 15 h"])
      expect(free('2026-11-21')).toEqual([])
      expect(free('2026-11-22')).toEqual(['dispo dès 11 h'])
      // A cancelled session doesn't take the studio.
      expect(free('2026-11-24')).toEqual(['disponible'])
      expect(free('2026-11-26')).toEqual([])
      expect(free('2026-12-05')).toEqual([])
    })
  })

  describe('choosing a day', () => {
    it('by clicking it, or again to unchoose it, without a step in the history', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      fireEvent.click(cell('2026-11-26'))
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-26')
      expect(dayButton('2026-11-26')).toHaveAttribute('aria-pressed', 'true')
      expect(chosenDay()).toHaveAccessibleName('jeudi 26 novembre 2026')
      // A day of the next month in the grid, which stays as it is.
      fireEvent.click(cell('2026-12-02'))
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-12-02')
      expect(screen.getByRole('heading', { name: 'novembre 2026' })).toBeInTheDocument()
      fireEvent.click(dayButton('2026-12-02'))
      expect(path()).toBe('/admin/calendrier?month=2026-11')
      expect(chosenDay()).not.toBeInTheDocument()
    })

    it("but not by clicking a session's link, which opens its page", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const link = within(cell('2026-11-21')).getByRole('link', { name: 'HAUTE RIVE TAKEOVER' })
      // Out of the keyboard's way.
      expect(link).toHaveAttribute('tabindex', '-1')
      fireEvent.click(link)
      expect(path()).toBe('/admin/sessions/session-1')
      // The day wasn't chosen before.
      back()
      expect(path()).toBe('/admin/calendrier')
    })

    it('from the address, unless it is not in the grid, and in its own month without one', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY })
      const first = renderAt('/admin/calendrier?month=2026-11&day=2026-12-10')
      await loaded()
      expect(chosenDay()).not.toBeInTheDocument()
      first.unmount()

      renderAt('/admin/calendrier?day=2026-12-10')
      await waitFor(() => expect(chosenDay()).toHaveAccessibleName('jeudi 10 décembre 2026'))
      expect(screen.getByRole('heading', { name: 'décembre 2026' })).toBeInTheDocument()
    })

    it('with the keyboard, the grid being one stop, whose arrows move between days and stop at its edges', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const stops = () => [...document.querySelectorAll('.calendar-month [tabindex="0"]')].map((element) => element.getAttribute('data-day'))
      // Today.
      expect(stops()).toEqual(['2026-11-19'])
      dayButton('2026-11-19').focus()
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
      expect(document.activeElement).toBe(dayButton('2026-11-27'))
      expect(stops()).toEqual(['2026-11-27'])
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      // The last week.
      expect(document.activeElement).toBe(dayButton('2026-12-04'))
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
      expect(document.activeElement).toBe(dayButton('2026-12-05'))
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
      fireEvent.click(document.activeElement!)
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-28')

      // Once the focus leaves, the stop is the chosen day.
      act(() => screen.getByRole('button', { name: "aujourd'hui" }).focus())
      expect(stops()).toEqual(['2026-11-28'])
      // Closing it puts the focus back on it.
      fireEvent.click(screen.getByRole('button', { name: 'fermer le jour' }))
      expect(chosenDay()).not.toBeInTheDocument()
      expect(document.activeElement).toBe(dayButton('2026-11-28'))
    })
  })

  describe('the chosen day', () => {
    it('lists what takes it, with its times in full and its conflicts there', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier?day=2026-11-22')
      await loaded()

      const rows = within(chosenDay()!).getAllByRole('listitem').map(visibleText)
      expect(rows).toEqual([
        "silenceven. 20 nov., 15 h – dim. 22 nov., 11 hcalendrier « Séjours »conflit avec la session HAUTE RIVE TAKEOVER",
        'sessionsam. 21 nov., 21 h – 1 hHAUTE RIVE TAKEOVER Aurore, Brume · Cyanconflit avec le silence du calendrier « Séjours »',
        'disponibledès 11 h',
      ])
      expect(within(chosenDay()!).getByRole('link', { name: 'nouvelle session ce jour →' })).toHaveAttribute('href', '/admin/sessions/nouvelle?day=2026-11-22')
    })

    it('says when nothing takes it, and has no new session on a past day', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier?day=2026-11-18')
      await loaded()

      expect(within(chosenDay()!).getByText('Rien ce jour-là.')).toBeInTheDocument()
      expect(within(chosenDay()!).queryByRole('link', { name: 'nouvelle session ce jour →' })).not.toBeInTheDocument()
    })

    it("says what an occupation is, and where it's changed, and today", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      const first = renderAt('/admin/calendrier?day=2026-11-26')
      await loaded()
      expect(within(chosenDay()!).getAllByRole('listitem').map(visibleText)).toEqual(['occupation10 h – 16 hRÉPARATION (calendrier « Calendrier de l\'équipe »)'])
      first.unmount()

      renderAt('/admin/calendrier?day=2026-11-19')
      await loaded()
      expect(chosenDay()).toHaveAccessibleName("jeudi 19 novembre 2026 · aujourd'hui")
      expect(within(chosenDay()!).getAllByRole('listitem').map(visibleText)).toEqual(['disponibletoute la journée'])
    })

    it("has its free time, even when it's a day of the month after, which the month doesn't show", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier?month=2026-11&day=2026-12-01')
      await loaded()

      expect(within(chosenDay()!).getAllByRole('listitem').map(visibleText)).toEqual(['disponibletoute la journée'])
      expect(cell('2026-12-01').querySelector('.calendar-free')).toBeNull()
      expect(cell('2026-12-01')).not.toHaveClass('calendar-available')
    })
  })

  describe('À régler', () => {
    it('counts what needs settling, closed until it is opened, which the address keeps', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const box = screen.getByRole('region', { name: 'À régler' })
      const toggle = within(box).getByRole('button', { name: /conflit/ })
      expect(toggle).toHaveTextContent('1 conflit1 sans date')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(within(box).queryByRole('link', { name: 'LES SŒURS ONDES TAKEOVER' })).not.toBeInTheDocument()
      fireEvent.click(toggle)
      expect(path()).toBe('/admin/calendrier?issues=open')
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(toggle)
      expect(path()).toBe('/admin/calendrier')
    })

    it('lists the conflicts and the sessions without a date', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY })
      renderAt('/admin/calendrier?month=2026-12&issues=open')
      const box = await screen.findByRole('region', { name: 'À régler' })

      const [conflict, undated] = within(box).getAllByRole('listitem')
      expect(visibleText(conflict)).toBe('sam. 21 nov. 2026 21 h – 1 hsilence, à changer dans le calendrier « Séjours »session : HAUTE RIVE TAKEOVER')
      expect(within(conflict).getByRole('link', { name: 'HAUTE RIVE TAKEOVER' })).toHaveAttribute('href', '/admin/sessions/session-1')
      expect(visibleText(undated)).toBe('LES SŒURS ONDES TAKEOVER Ondine · Écume 3 h')
      expect(within(undated).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-4')

      // Its day shows it, chosen, in its month, with the focus on it.
      fireEvent.click(within(conflict).getByRole('button', { name: 'sam. 21 nov. 2026' }))
      expect(path()).toBe('/admin/calendrier?month=2026-11&issues=open&day=2026-11-21')
      await waitFor(() => expect(document.activeElement).toBe(dayButton('2026-11-21')))
      expect(dayButton('2026-11-21')).toHaveAttribute('aria-pressed', 'true')
    })

    it('says when there is nothing to settle, and warns of the feeds that were not read', async () => {
      const notRead = { ...TEAM, id: 'new', name: 'Nouveau', readAt: null }
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, feeds: [TEAM, STAYS, notRead], conflicts: [], undatedSessions: [] } })
      renderAt('/admin/calendrier')
      await loaded()

      const box = screen.getByRole('region', { name: 'À régler' })
      expect(within(box).getByText('Rien à régler.')).toBeInTheDocument()
      expect([...box.querySelectorAll('.admin-warning')].map(visibleText)).toEqual([
        "⚠ Des conflits peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier « Séjours » a échoué : The link can't be read: its server fails (503)",
        "⚠ Le calendrier « Nouveau » n'a pas encore été lu : des conflits peuvent manquer.",
      ])
    })

    it('says when there are no feeds', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, feeds: [] } })
      renderAt('/admin/calendrier')
      await loaded()

      const box = screen.getByRole('region', { name: 'À régler' })
      expect(box).toHaveTextContent('Aucun calendrier externe : les conflits avec des occupations ou du silence ne peuvent pas être trouvés.')
      expect(within(box).getByRole('link', { name: 'Configuration' })).toHaveAttribute('href', '/admin/configuration')
    })
  })

  it('says where each kind of thing comes from', async () => {
    mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, feeds: [STAYS] } })
    renderAt('/admin/calendrier')
    await loaded()

    const sources = screen.getByRole('region', { name: 'Sources' })
    expect(within(sources).getByRole('link', { name: 'Sessions' })).toHaveAttribute('href', '/admin/sessions')
    expect(sources).toHaveTextContent("OccupationsAucun calendrier pour le moment : ils s'ajoutent dans Configuration, « Calendriers externes ».")
    expect(sources).toHaveTextContent("SilenceSéjours Lu le 19 novembre 2026 à 11 h 50.La dernière lecture a échoué : The link can't be read: its server fails (503)")
  })

  describe('while loading, and when it fails', () => {
    it('says why the calendar could not be read', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ok: false, error: 'Internal server error' } })
      renderAt('/admin/calendrier?day=2026-11-21')

      expect(await screen.findByRole('alert')).toHaveTextContent("Le calendrier n'a pas pu être chargé : Internal server error")
      expect(screen.queryByRole('region', { name: 'À régler' })).not.toBeInTheDocument()
      expect(cellText('2026-11-21')).toBe('21')
      // The chosen day only has its heading, and its new session.
      expect(within(chosenDay()!).queryByRole('listitem')).not.toBeInTheDocument()
      expect(within(chosenDay()!).queryByText('Rien ce jour-là.')).not.toBeInTheDocument()
      expect(within(chosenDay()!).getByRole('link', { name: 'nouvelle session ce jour →' })).toBeInTheDocument()
    })

    it("shows none of the month's things before its calendar is read, but keeps what needs settling", async () => {
      const december = held()
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: december.body })
      renderAt('/admin/calendrier')
      await loaded()

      fireEvent.click(screen.getByRole('button', { name: 'mois suivant' }))
      // December 2, whose occupation November's calendar has.
      expect(cellText('2026-12-02')).toBe('2')
      expect(screen.getByRole('region', { name: 'À régler' })).toBeInTheDocument()
      await december.answer(CALENDAR)
      expect(cellText('2026-12-02')).toBe('2toute la journéeoccupation : sans titre')
    })

    it('shows only the last month asked for, whatever order the answers come in', async () => {
      const december = held()
      const january = '/api/admin/calendar?from=2026-12-27&to=2027-02-06'
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: december.body, [january]: EMPTY })
      renderAt('/admin/calendrier')
      await loaded()

      fireEvent.click(screen.getByRole('button', { name: 'mois suivant' }))
      fireEvent.click(screen.getByRole('button', { name: 'mois suivant' }))
      await waitFor(() => expect(requestsTo('GET', january)).toHaveLength(1))
      await december.answer({ ...CALENDAR, undatedSessions: [] })
      expect(screen.getByRole('heading', { name: 'janvier 2027' })).toBeInTheDocument()
      // January's: December's answer came too late.
      expect(screen.getByRole('region', { name: 'À régler' })).toHaveTextContent('1 sans date')
    })

    it('keeps what it shows when reading it again fails, and reads it again when the tab is shown, at most once a minute', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()
      const shown = () => act(() => document.dispatchEvent(new Event('visibilitychange')))

      await shown()
      expect(requestsTo('GET', NOVEMBER)).toHaveLength(1)
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ok: false, error: 'Internal server error' } })
      vi.setSystemTime(NOW.getTime() + 61 * 1000)
      await shown()

      expect(await screen.findByRole('alert')).toHaveTextContent("Le calendrier n'a pas pu être chargé : Internal server error")
      expect(cellText('2026-11-26')).toBe('2610 h – 16 hoccupation : RÉPARATION')
      expect(screen.getByRole('region', { name: 'À régler' })).toBeInTheDocument()
    })
  })
})
