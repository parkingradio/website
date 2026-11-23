import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import App from '../../app'
import type { Collective } from '../../collective-profile'
import type { Session } from '../../session-fields'
import { held, mockFetch, requestsTo, visibleText as shownText } from '../../test-utils'
import type { Calendar } from './calendrier/model'

// Today is Thursday, November 19, 2026, in Québec.
const NOW = new Date('2026-11-19T12:00:00-05:00')
const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }
const NOVEMBER = '/api/admin/calendar?from=2026-11-01&to=2026-12-05'
const DECEMBER = '/api/admin/calendar?from=2026-11-29&to=2027-01-02'
const OCTOBER = '/api/admin/calendar?from=2026-09-27&to=2026-10-31'

// A session, which lasts from `start` to `end`, or 3 hours when its date isn't known.
function session(id: string, title: string, start: string | null, end: string | null, fields: Partial<Session> = {}): Session {
  const durationMinutes = start && end ? (Date.parse(end) - Date.parse(start)) / 60000 : 180
  return { id, title, start, end, durationMinutes, status: 'planned', sets: [], createdAt: '2026-10-01T12:00:00Z', ...fields } as Session
}

const performers = (...names: string[]) => ({ performers: names.map((name) => ({ id: name, name })) })
const TEAM = {
  id: 'team',
  name: "Calendrier de l'équipe",
  link: 'https://example.com/team.ics',
  privateTitles: false,
  createdBy: 'admin@example.com',
  createdAt: '2026-11-01T12:00:00Z',
  updatedBy: null,
  updatedAt: null,
  readAt: '2026-11-19T11:50:00-05:00',
  error: null,
}
// A feed of the guests' stays, whose titles are private.
const STAYS = { ...TEAM, id: 'stays', name: 'Séjours', link: 'https://example.com/stays.ics', privateTitles: true, error: "The link can't be read: its server fails (503)" }

const TAKEOVER = session('session-1', 'HAUTE RIVE TAKEOVER', '2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00', { sets: [performers('Aurore', 'Brume'), performers('Cyan')] as Session['sets'] })
const PLAYED = session('session-2', 'SOIRÉE', '2026-11-07T20:00:00-05:00', '2026-11-07T23:00:00-05:00', { status: 'done' })
const CANCELLED = session('session-3', 'LIVE PERFORMANCE', '2026-11-24T20:00:00-05:00', '2026-11-24T23:00:00-05:00', { status: 'cancelled' })
const UNDATED = session('session-4', 'LES SŒURS ONDES TAKEOVER', null, null, { sets: [performers('Ondine'), performers('Écume')] as Session['sets'] })
const REPAIR = { feedId: 'team', start: '2026-11-26T10:00:00-05:00', end: '2026-11-26T16:00:00-05:00', wholeDay: false, title: 'RÉPARATION' }
const CLOSED = { feedId: 'team', start: '2026-12-02T00:00:00-05:00', end: '2026-12-04T00:00:00-05:00', wholeDay: true, title: '' }
const STAY = { feedId: 'stays', start: '2026-11-20T15:00:00-05:00', end: '2026-11-22T11:00:00-05:00', wholeDay: false, title: null }
// The stay and the takeover, as the server gives them.
const CONFLICT = {
  start: TAKEOVER.start!,
  end: TAKEOVER.end!,
  things: [
    { kind: 'occupation', ...STAY },
    { kind: 'session', id: TAKEOVER.id, title: TAKEOVER.title, start: TAKEOVER.start!, end: TAKEOVER.end!, status: 'planned' },
  ],
} as Calendar['conflicts'][number]

const CALENDAR: Calendar = {
  ok: true,
  today: '2026-11-19',
  feeds: [TEAM, STAYS],
  sessions: [PLAYED, TAKEOVER, CANCELLED],
  occupations: [STAY, REPAIR, CLOSED],
  conflicts: [CONFLICT],
  undatedSessions: [UNDATED],
}
const EMPTY: Calendar = { ...CALENDAR, sessions: [], occupations: [] }

// The collectives a new session's form picks a takeover's from.
const HAUTE_RIVE = { id: 'collective-1', name: 'Haute Rive', members: [] } as unknown as Collective
const COLLECTIVES = { '/api/admin/collectives': { ok: true, collectives: [HAUTE_RIVE] } }

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
// A day's "+", which opens the form for a new session on it.
const addButton = (day: string) => within(cell(day)).getByRole('button', { name: /^nouvelle session le / })
const newSession = () => screen.queryByRole('form', { name: 'Nouvelle session' })
const chosenDay = () => screen.queryByRole('region', { name: /2026/ })
const loaded = () => screen.findByRole('region', { name: 'À régler' })

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
      // Going back finds the month before, with its day chosen.
      back()
      expect(path()).toBe('/admin/calendrier?day=2026-11-21')
      expect(screen.getByRole('heading', { name: 'novembre 2026' })).toBeInTheDocument()
      expect(dayButton('2026-11-21')).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'mois précédent' }))
      await waitFor(() => expect(requestsTo('GET', OCTOBER)).toHaveLength(1))
      expect(screen.getByRole('heading', { name: 'octobre 2026' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: "aujourd'hui" }))
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-19')
      expect(dayButton('2026-11-19')).toHaveAttribute('aria-pressed', 'true')
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

      expect(cellText('2026-11-21')).toBe('21+toute la journéeoccupation : Séjoursconflit21 h – 1 hsession : HAUTE RIVE TAKEOVER, avec Aurore, Brume · Cyanconflit')
      expect(within(cell('2026-11-21')).getByRole('link', { name: 'HAUTE RIVE TAKEOVER' })).toHaveAttribute('href', '/admin/sessions/session-1')
      expect(cellText('2026-11-22')).toBe("22+jusqu'à 11 hoccupation : Séjoursconflitjusqu'à 1 hsession : HAUTE RIVE TAKEOVER, avec Aurore, Brume · Cyanconflitdispo dès 11 h")
      expect(cellText('2026-11-07')).toBe('720 h – 23 hsession : SOIRÉE jouée')
      expect(cell('2026-11-07').querySelector('li')).toHaveClass('admin-status-done')
      expect(cellText('2026-11-24')).toContain('session : LIVE PERFORMANCE annulée')
      // An occupation's title, then its calendar, or its calendar alone.
      expect(cellText('2026-11-26')).toBe("26+dispo jusqu'à 10 h10 h – 16 hoccupation : RÉPARATION, calendrier Calendrier de l'équipedispo dès 16 h")
      expect(cell('2026-11-26').querySelector('.calendar-title')).toHaveTextContent(/^occupation : RÉPARATION$/)
      // Things of the other months too.
      expect(cellText('2026-12-02')).toBe("2+toute la journéeoccupation : Calendrier de l'équipe")
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

      // Free time and things in order of time.
      expect(cellText('2026-11-20')).toBe("20+dispo jusqu'à 15 hdès 15 hoccupation : Séjours")
      expect(cell('2026-11-21').querySelectorAll('.calendar-conflict')).toHaveLength(2)
      expect(cell('2026-11-22').querySelectorAll('.calendar-conflict')).toHaveLength(2)
    })

    it("shows the free time of the month's own days, a day that nothing takes as available", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const free = (day: string) => [...cell(day).querySelectorAll('.calendar-free')].map((tag) => tag.textContent)
      expect(free('2026-11-19')).toEqual(['disponible'])
      expect(cell('2026-11-19')).toHaveClass('calendar-available')
      expect(free('2026-11-26')).toEqual(["dispo jusqu'à 10 h", 'dispo dès 16 h'])
      expect(cell('2026-11-26')).not.toHaveClass('calendar-available')
      // Not that of the month after, which the model has (see model.test.ts).
      expect(free('2026-12-05')).toEqual([])
      expect(cell('2026-12-05')).not.toHaveClass('calendar-available')
    })
  })

  describe('choosing a day', () => {
    it('by clicking it, or again to unchoose it, without a step in the history', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY })
      renderAt('/admin/calendrier?month=2026-12')
      await loaded()
      fireEvent.click(screen.getByRole('button', { name: 'mois précédent' }))
      expect(path()).toBe('/admin/calendrier?month=2026-11')

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
      // Going back finds December, which the page showed before November: choosing days added no step.
      back()
      expect(path()).toBe('/admin/calendrier?month=2026-12')
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

      const stops = () => [...document.querySelectorAll('.calendar-month [data-day][tabindex="0"]')].map((element) => element.getAttribute('data-day'))
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
        'occupationven. 20 nov., 15 h – dim. 22 nov., 11 hSéjoursconflit avec la session HAUTE RIVE TAKEOVER',
        "sessionsam. 21 nov., 21 h – 1 hHAUTE RIVE TAKEOVER Aurore, Brume · Cyanconflit avec l'occupation Séjours",
        'disponibledès 11 h',
      ])
    })

    it('says when nothing takes it', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier?day=2026-11-18')
      await loaded()

      expect(within(chosenDay()!).getByText('Rien ce jour-là.')).toBeInTheDocument()
    })

    it("names an occupation by its title, then its calendar, and today", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      const first = renderAt('/admin/calendrier?day=2026-11-26')
      await loaded()
      expect(within(chosenDay()!).getAllByRole('listitem').map(visibleText)).toEqual(["disponiblejusqu'à 10 h", "occupation10 h – 16 hRÉPARATION, calendrier Calendrier de l'équipe", 'disponibledès 16 h'])
      first.unmount()

      renderAt('/admin/calendrier?day=2026-11-19')
      await loaded()
      expect(chosenDay()).toHaveAccessibleName("jeudi 19 novembre 2026, aujourd'hui")
      expect(within(chosenDay()!).getAllByRole('listitem').map(visibleText)).toEqual(['disponibletoute la journée'])
    })

    it('names the other thing of a conflict between two occupations', async () => {
      // A cleaning, during the stay, whose feed's titles are private, unlike the cleaning's.
      const cleaning = { feedId: 'team', start: '2026-11-21T10:00:00-05:00', end: '2026-11-21T12:00:00-05:00', wholeDay: false, title: 'MÉNAGE' }
      const conflict = { start: cleaning.start, end: cleaning.end, things: [{ kind: 'occupation', ...STAY }, { kind: 'occupation', ...cleaning }] } as Calendar['conflicts'][number]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, occupations: [STAY, cleaning], sessions: [], conflicts: [conflict] } })
      renderAt('/admin/calendrier?day=2026-11-21&issues=open')
      await loaded()

      expect(within(chosenDay()!).getAllByRole('listitem').map(visibleText)).toEqual([
        "occupationven. 20 nov., 15 h – dim. 22 nov., 11 hSéjoursconflit avec l'occupation MÉNAGE (Calendrier de l'équipe)",
        "occupation10 h – 12 hMÉNAGE, calendrier Calendrier de l'équipeconflit avec l'occupation Séjours",
      ])
      const box = screen.getByRole('region', { name: 'À régler' })
      expect(visibleText(within(box).getAllByRole('listitem')[0])).toBe(
        "sam. 21 nov. 202610 h – 12 hoccupation : Séjoursoccupation : MÉNAGE, calendrier Calendrier de l'équipevoir le jour, sam. 21 nov. 2026 →",
      )
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

  describe('a new session', () => {
    // What it sent to add the session.
    const sentSession = () => JSON.parse((requestsTo('POST', '/api/admin/sessions')[0].body as FormData).get('session') as string)
    const time = (label: 'Début' | 'Fin', value: string) => fireEvent.change(within(newSession()!).getByLabelText(label), { target: { value } })
    const create = () => fireEvent.click(within(newSession()!).getByRole('button', { name: 'créer' }))

    it('is added from the "+" of each day from today on, named by its day', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      expect(screen.queryByRole('link', { name: /nouvelle session/ })).not.toBeInTheDocument()
      expect(addButton('2026-11-19')).toHaveAccessibleName('nouvelle session le jeudi 19 novembre 2026')
      expect(addButton('2026-11-19')).toHaveTextContent('+')
      // The days of the month after too, which can be chosen.
      expect(addButton('2026-12-05')).toHaveAccessibleName('nouvelle session le samedi 5 décembre 2026')
      expect(within(cell('2026-11-18')).queryByRole('button', { name: /^nouvelle session/ })).not.toBeInTheDocument()
    })

    it('is reached with Tab from the day that is the grid\'s stop, whose arrows move from its "+" as from the day', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const tabbable = () => [...document.querySelectorAll('.calendar-month [tabindex="0"]')]
      expect(tabbable()).toEqual([dayButton('2026-11-19'), addButton('2026-11-19')])
      act(() => addButton('2026-11-19').focus())
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
      expect(document.activeElement).toBe(dayButton('2026-11-20'))
      expect(tabbable()).toEqual([dayButton('2026-11-20'), addButton('2026-11-20')])
      // A day before today has no "+".
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
      expect(tabbable()).toEqual([dayButton('2026-11-13')])
    })

    it('opens its form under the chosen day, which only the chosen day has', async () => {
      mockFetch({ ...LOGGED_IN, ...COLLECTIVES, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY })
      renderAt('/admin/calendrier')
      await loaded()

      fireEvent.click(addButton('2026-11-22'))
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-22')
      expect(chosenDay()).toHaveAccessibleName('dimanche 22 novembre 2026')
      // Under the day's things, with the focus on its heading.
      const form = newSession()!
      expect(chosenDay()!.lastElementChild).toBe(form)
      await waitFor(() => expect(document.activeElement).toBe(within(form).getByRole('heading', { name: 'Nouvelle session' })))
      expect(requestsTo('GET', '/api/admin/collectives')).toHaveLength(1)

      // Its "+" again keeps the day chosen, and what's typed.
      time('Début', '21:00')
      act(() => screen.getByRole('button', { name: "aujourd'hui" }).focus())
      fireEvent.click(addButton('2026-11-22'))
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-22')
      expect(document.activeElement).toBe(within(newSession()!).getByRole('heading', { name: 'Nouvelle session' }))
      expect(within(newSession()!).getByLabelText('Début')).toHaveValue('21:00')

      // Another day's "+" opens it there, empty.
      fireEvent.click(addButton('2026-11-25'))
      expect(chosenDay()).toHaveAccessibleName('mercredi 25 novembre 2026')
      expect(within(newSession()!).getByLabelText('Début')).toHaveValue('')

      // "annuler" closes it, and puts the focus back on the "+".
      fireEvent.click(within(newSession()!).getByRole('button', { name: 'annuler' }))
      expect(newSession()).not.toBeInTheDocument()
      expect(chosenDay()).toHaveAccessibleName('mercredi 25 novembre 2026')
      expect(document.activeElement).toBe(addButton('2026-11-25'))

      // Choosing another day closes it, and so does unchoosing it.
      fireEvent.click(addButton('2026-11-25'))
      fireEvent.click(cell('2026-11-26'))
      expect(newSession()).not.toBeInTheDocument()
      fireEvent.click(cell('2026-11-25'))
      expect(newSession()).not.toBeInTheDocument()
      fireEvent.click(addButton('2026-11-25'))
      fireEvent.click(screen.getByRole('button', { name: 'fermer le jour' }))
      expect(newSession()).not.toBeInTheDocument()

      // So does changing the month, and it stays closed when going back.
      fireEvent.click(addButton('2026-11-25'))
      fireEvent.click(screen.getByRole('button', { name: 'mois suivant' }))
      back()
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-25')
      expect(chosenDay()).toBeInTheDocument()
      expect(newSession()).not.toBeInTheDocument()
    })

    it('says what is wrong with its fields, as the session form does, and only shows those its type has', async () => {
      mockFetch({ ...LOGGED_IN, ...COLLECTIVES, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()
      fireEvent.click(addButton('2026-11-25'))
      const form = newSession()!

      create()
      expect(within(form).getByText("Indiquez l'heure de début.")).toBeInTheDocument()
      expect(within(form).getByText("Indiquez l'heure de fin.")).toBeInTheDocument()
      expect(within(form).getByText('Choisissez le type de la session.')).toBeInTheDocument()
      await waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText('Début')))

      // The end the next day, when it's before the start, but not at the start.
      time('Début', '21:00')
      time('Fin', '21:00')
      expect(within(form).getByText('La fin doit être après le début.')).toBeInTheDocument()
      time('Fin', '23:00')
      expect(within(form).getByRole('status')).toHaveTextContent('Dure 2 h.')
      time('Fin', '01:00')
      expect(within(form).getByRole('status')).toHaveTextContent("Dure 4 h, jusqu'au lendemain.")

      // A takeover's collective, and "Autre"'s name.
      const types = within(within(form).getByRole('group', { name: 'Type' }))
      expect(types.getAllByRole('radio').map((radio) => radio.parentElement!.textContent)).toEqual(['Guest mixes', 'Live performance', 'Takeover', 'Synth meetup', 'Autre'])
      expect(within(form).queryByRole('combobox', { name: 'Collectif' })).not.toBeInTheDocument()
      expect(within(form).queryByLabelText('Nom')).not.toBeInTheDocument()
      fireEvent.click(types.getByRole('radio', { name: 'Takeover' }))
      expect(within(form).getByText('Choisissez le collectif du takeover.')).toBeInTheDocument()
      expect(within(form).queryByLabelText('Nom')).not.toBeInTheDocument()
      fireEvent.click(types.getByRole('radio', { name: 'Autre' }))
      expect(within(form).queryByRole('combobox', { name: 'Collectif' })).not.toBeInTheDocument()
      expect(within(form).getByLabelText('Nom')).toHaveAttribute('placeholder', 'p. ex. LISTENING PARTY')
      expect(within(form).getByText('Indiquez le nom de la session.')).toBeInTheDocument()
      expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(0)
    })

    it('adds the session, without sets, and with its other fields empty, then goes to its page', async () => {
      const added = session('session-9', 'HAUTE RIVE TAKEOVER', '2026-11-25T21:00:00-05:00', '2026-11-26T01:00:00-05:00')
      mockFetch({ ...LOGGED_IN, ...COLLECTIVES, [NOVEMBER]: CALENDAR, 'POST /api/admin/sessions': { ok: true, session: added } })
      renderAt('/admin/calendrier')
      await loaded()
      fireEvent.click(addButton('2026-11-25'))
      const form = newSession()!

      time('Début', '21:00')
      time('Fin', '01:00')
      // A name typed for "Autre" isn't another type's.
      fireEvent.click(within(form).getByRole('radio', { name: 'Autre' }))
      fireEvent.change(within(form).getByLabelText('Nom'), { target: { value: 'ATELIER' } })
      fireEvent.click(within(form).getByRole('radio', { name: 'Takeover' }))
      const collective = await waitFor(() => {
        const picker = within(form).getByRole('combobox', { name: 'Collectif' })
        expect(picker).toBeEnabled()
        return picker
      })
      fireEvent.click(collective)
      fireEvent.mouseDown(screen.getByRole('option', { name: /^Haute Rive/ }))
      create()

      await waitFor(() => expect(path()).toBe('/admin/sessions/session-9'))
      expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1)
      expect(sentSession()).toEqual({
        start: '2026-11-25T21:00-05:00',
        durationMinutes: 240,
        type: 'takeover',
        takeover: 'collective-1',
        application: null,
        name: '',
        raEvent: null,
        description: '',
      })
      expect((requestsTo('POST', '/api/admin/sessions')[0].body as FormData).has('flyer')).toBe(false)
    })

    it("shows the server's error, naming the session it would overlap", async () => {
      mockFetch({
        ...LOGGED_IN,
        ...COLLECTIVES,
        [NOVEMBER]: CALENDAR,
        'POST /api/admin/sessions': { ok: false, error: 'The session overlaps another one', session: TAKEOVER, set: null },
      })
      renderAt('/admin/calendrier')
      await loaded()
      fireEvent.click(addButton('2026-11-21'))
      const form = newSession()!

      time('Début', '20:00')
      time('Fin', '22:00')
      fireEvent.click(within(form).getByRole('radio', { name: 'Guest mixes' }))
      create()

      const alert = await within(form).findByRole('alert')
      expect(visibleText(alert)).toBe("La session n'a pas pu être ajoutée : The session overlaps another one (HAUTE RIVE TAKEOVER, sam. 21 nov. 2026)")
      expect(within(alert).getByRole('link', { name: 'HAUTE RIVE TAKEOVER, sam. 21 nov. 2026' })).toHaveAttribute('href', '/admin/sessions/session-1')
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-21')
    })

    it('says when the collectives cannot be loaded', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, '/api/admin/collectives': { ok: false, error: 'Boom' } })
      renderAt('/admin/calendrier')
      await loaded()
      fireEvent.click(addButton('2026-11-25'))
      const form = newSession()!

      expect(await within(form).findByRole('alert')).toHaveTextContent("Les collectifs n'ont pas pu être chargés : Boom")
      fireEvent.click(within(form).getByRole('radio', { name: 'Takeover' }))
      expect(within(form).getByRole('combobox', { name: 'Collectif' })).toBeDisabled()
    })
  })

  describe('À régler', () => {
    it('counts what needs settling, closed until it is opened, which the address keeps', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const box = screen.getByRole('region', { name: 'À régler' })
      // Its first row, a button in its heading, whose chevron screen readers don't read.
      const toggle = within(within(box).getByRole('heading', { level: 2, name: /^À régler/ })).getByRole('button', { expanded: false })
      expect(toggle).toHaveAccessibleName('À régler 1 conflit 1 sans date')
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

      // A group for each kind, with its tag, its heading, and what to do.
      expect([...box.querySelectorAll('h3')].map(visibleText)).toEqual(['conflits chevauchements à résoudre', 'sans date sessions à placer'])
      expect(box).toHaveTextContent("déplacez, raccourcissez ou annulez l'une des deux. Les occupations se changent dans leur calendrier.")
      const [conflict, undated] = within(box).getAllByRole('listitem')
      expect(visibleText(conflict)).toBe('sam. 21 nov. 202621 h – 1 hoccupation : Séjourssession : HAUTE RIVE TAKEOVERvoir le jour, sam. 21 nov. 2026 →')
      expect(within(conflict).getByRole('link', { name: 'HAUTE RIVE TAKEOVER' })).toHaveAttribute('href', '/admin/sessions/session-1')
      // Its duration after its sets' performers, which "·" separates.
      expect(visibleText(undated)).toBe('à déterminerLES SŒURS ONDES TAKEOVER Ondine · Écume, 3 hlui donner une date, LES SŒURS ONDES TAKEOVER →')
      // Its action, a pill like the conflicts', which screen readers read with what it's about, without the arrow.
      const action = within(undated).getByRole('link', { name: 'lui donner une date, LES SŒURS ONDES TAKEOVER' })
      expect(action).toHaveAttribute('href', '/admin/sessions/session-4')
      expect(action).toHaveClass('admin-button')

      // Its day shows it, chosen, in its month, with the focus on it.
      fireEvent.click(within(conflict).getByRole('button', { name: 'voir le jour, sam. 21 nov. 2026' }))
      expect(path()).toBe('/admin/calendrier?month=2026-11&issues=open&day=2026-11-21')
      await waitFor(() => expect(document.activeElement).toBe(dayButton('2026-11-21')))
      expect(dayButton('2026-11-21')).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows a session that is done or cancelled in its status colors, on the chosen day and in its conflicts', async () => {
      // A session today, already played, during a repair.
      const morning = session('session-5', 'MATINALE', '2026-11-19T09:00:00-05:00', '2026-11-19T11:00:00-05:00', { status: 'done' })
      const repair = { feedId: 'team', start: '2026-11-19T10:00:00-05:00', end: '2026-11-19T12:00:00-05:00', wholeDay: false, title: 'RÉPARATION' }
      const conflict = {
        start: repair.start,
        end: morning.end!,
        things: [
          { kind: 'session', id: morning.id, title: morning.title, start: morning.start!, end: morning.end!, status: 'done' },
          { kind: 'occupation', ...repair },
        ],
      } as Calendar['conflicts'][number]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...EMPTY, sessions: [morning, CANCELLED], occupations: [repair], conflicts: [conflict] } })
      const first = renderAt('/admin/calendrier?day=2026-11-19&issues=open')
      await loaded()

      const [played] = within(chosenDay()!).getAllByRole('listitem')
      expect(played).toHaveClass('calendar-row', 'admin-status-done')
      expect(played).toHaveTextContent('MATINALE jouée')
      const box = screen.getByRole('region', { name: 'À régler' })
      expect(box.querySelector('.calendar-issue-thing')).toHaveClass('admin-status-done')
      first.unmount()

      renderAt('/admin/calendrier?day=2026-11-24')
      await loaded()
      // After the day's free time, which a cancelled session doesn't take.
      const [stretch, cancelled] = within(chosenDay()!).getAllByRole('listitem')
      expect(stretch).toHaveTextContent(/^disponible/)
      expect(cancelled).toHaveClass('calendar-row', 'admin-status-cancelled')
    })

    it('says when there is nothing to settle, and warns of the feeds that were not read', async () => {
      const notRead = { ...TEAM, id: 'new', name: 'Nouveau', readAt: null }
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, feeds: [TEAM, STAYS, notRead], conflicts: [], undatedSessions: [] } })
      renderAt('/admin/calendrier')
      await loaded()

      const box = screen.getByRole('region', { name: 'À régler' })
      // The same row, which can't be used.
      expect(within(box).getByRole('button', { name: 'À régler rien' })).toHaveAttribute('aria-disabled', 'true')
      expect(within(box).getByRole('button')).not.toHaveAttribute('aria-expanded')
      expect([...box.querySelectorAll('.admin-warning')].map(visibleText)).toEqual([
        "⚠ Des conflits peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier « Séjours » a échoué : The link can't be read: its server fails (503). Voir Configuration.",
        "⚠ Le calendrier « Nouveau » n'a pas encore été lu : des conflits peuvent manquer.",
      ])
      expect(within(box.querySelector('.admin-warning')!).getByRole('link', { name: 'Configuration' })).toHaveAttribute('href', '/admin/configuration')
    })

    it('says when there are no feeds', async () => {
      // Without feeds, there are no occupations, and no conflicts.
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...EMPTY, feeds: [], conflicts: [] } })
      renderAt('/admin/calendrier')
      await loaded()

      const box = screen.getByRole('region', { name: 'À régler' })
      expect(box).toHaveTextContent('Aucun calendrier externe : les conflits avec des occupations ne peuvent pas être trouvés.')
      expect(within(box).getByRole('link', { name: 'Configuration' })).toHaveAttribute('href', '/admin/configuration')
    })
  })

  describe('while loading, and when it fails', () => {
    it('says why the calendar could not be read', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ok: false, error: 'Internal server error' } })
      renderAt('/admin/calendrier?day=2026-11-21')

      expect(await screen.findByRole('alert')).toHaveTextContent("Le calendrier n'a pas pu être chargé : Internal server error")
      expect(screen.queryByRole('region', { name: 'À régler' })).not.toBeInTheDocument()
      expect(cellText('2026-11-21')).toBe('21+')
      // The chosen day only has its heading, and the form for a new session, which doesn't wait for the calendar.
      expect(within(chosenDay()!).queryByRole('listitem')).not.toBeInTheDocument()
      expect(within(chosenDay()!).queryByText('Rien ce jour-là.')).not.toBeInTheDocument()
      fireEvent.click(addButton('2026-11-21'))
      expect(within(chosenDay()!).getByRole('form', { name: 'Nouvelle session' })).toBeInTheDocument()
    })

    it("shows none of the month's things before its calendar is read, but keeps what needs settling", async () => {
      const december = held()
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: december.body })
      renderAt('/admin/calendrier')
      await loaded()

      fireEvent.click(screen.getByRole('button', { name: 'mois suivant' }))
      // December 2, whose occupation November's calendar has.
      expect(cellText('2026-12-02')).toBe('2+')
      expect(screen.getByRole('region', { name: 'À régler' })).toBeInTheDocument()
      await december.answer({ ...EMPTY, occupations: [CLOSED] })
      expect(cellText('2026-12-02')).toBe("2+toute la journéeoccupation : Calendrier de l'équipe")
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
      await december.answer({ ...EMPTY, occupations: [CLOSED], undatedSessions: [] })
      expect(screen.getByRole('heading', { name: 'janvier 2027' })).toBeInTheDocument()
      // January's: December's answer came too late.
      expect(screen.getByRole('region', { name: 'À régler' })).toHaveTextContent('1 sans date')
    })

    it('keeps the focus on "À régler"\'s row when there\'s nothing left to settle', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()
      const toggle = screen.getByRole('button', { name: /^À régler/ })
      act(() => toggle.focus())

      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, conflicts: [], undatedSessions: [] } })
      vi.setSystemTime(NOW.getTime() + 61 * 1000)
      await act(() => document.dispatchEvent(new Event('visibilitychange')))
      await waitFor(() => expect(toggle).toHaveAccessibleName('À régler rien'))
      expect(document.activeElement).toBe(toggle)
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
      expect(cellText('2026-11-26')).toBe("26+dispo jusqu'à 10 h10 h – 16 hoccupation : RÉPARATION, calendrier Calendrier de l'équipedispo dès 16 h")
      expect(screen.getByRole('region', { name: 'À régler' })).toBeInTheDocument()
    })
  })
})
