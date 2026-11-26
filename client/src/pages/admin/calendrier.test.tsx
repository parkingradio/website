import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import App from '../../app'
import type { Collective } from '../../collective-profile'
import type { Session } from '../../session-fields'
import { held, mockFetch, named, requestsTo, shownTime, spaced, timeParts, typeTime, visibleText as shownText } from '../../test-utils'
import type { Calendar, ConflictThing } from './calendrier/model'

// The admin pages load on demand (see AdminPage in shell.tsx): load them up front, so that no test waits for them.
beforeAll(() => import('./admin-pages'))

// Today is Thursday, November 19, 2026, in Québec.
const NOW = new Date('2026-11-19T12:00:00-05:00')
// The admin, and the token of the legend's links to their calendars, which the page reads once it opens.
const TOKEN = 'a'.repeat(64)
const TOKEN_URL = '/api/admin/ics-subscription-token'
const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' }, [TOKEN_URL]: { ok: true, token: TOKEN } }
const NOVEMBER = '/api/admin/calendar?from=2026-11-01&to=2026-12-05'
const DECEMBER = '/api/admin/calendar?from=2026-11-29&to=2027-01-02'
const OCTOBER = '/api/admin/calendar?from=2026-09-27&to=2026-10-31'

// A session, which lasts from `start` to `end`, or 3 hours when its date isn't known.
function session(id: string, title: string, start: string | null, end: string | null, fields: Partial<Session> = {}): Session {
  const durationMinutes = start && end ? (Date.parse(end) - Date.parse(start)) / 60000 : 180
  return { id, title, start, end, durationMinutes, status: 'planned', sets: [], createdAt: '2026-10-01T12:00:00Z', ...fields } as Session
}

// A session, as the server gives it among the sessions outside protected time.
const unprotected = ({ id, title, start, end }: Session) => ({ id, title, start: start!, end: end! })
const performers = (...names: string[]) => ({ performers: names.map((name) => ({ id: name, name })) })
const TEAM = {
  id: 'team',
  name: "Calendrier de l'équipe",
  kind: 'occupations' as const,
  link: 'https://example.com/team.ics',
  createdBy: 'admin@example.com',
  createdAt: '2026-11-01T12:00:00Z',
  updatedBy: null,
  updatedAt: null,
  readAt: '2026-11-19T11:50:00-05:00',
  error: null,
}
// A feed of the guests' stays, whose last read failed.
const STAYS = { ...TEAM, id: 'stays', name: 'Séjours', link: 'https://example.com/stays.ics', error: "The link can't be read: its server fails (503)" }
// A feed of the time protected for sessions, with a hold over the 365 days from today, and beyond, which are free time
// where nothing takes them.
const LOFT = { ...TEAM, id: 'loft', name: 'Loft', kind: 'holds' as const, link: 'https://example.com/loft.ics' }
const ALWAYS = { feedId: 'loft', start: '2026-10-01T00:00:00-04:00', end: '2028-01-01T00:00:00-05:00', wholeDay: true }
const [TODAY, LAST] = ['2026-11-19T00:00:00-05:00', '2027-11-19T00:00:00-05:00']

const TAKEOVER = session('session-1', 'HAUTE RIVE TAKEOVER', '2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00', { sets: [performers('Aurore', 'Brume'), performers('Cyan')] as Session['sets'] })
const PLAYED = session('session-2', 'SOIRÉE', '2026-11-07T20:00:00-05:00', '2026-11-07T23:00:00-05:00', { status: 'done' })
const CANCELLED = session('session-3', 'LIVE PERFORMANCE', '2026-11-24T20:00:00-05:00', '2026-11-24T23:00:00-05:00', { status: 'cancelled' })
const UNDATED = session('session-4', 'LES SŒURS ONDES TAKEOVER', null, null, { sets: [performers('Ondine'), performers('Écume')] as Session['sets'] })
const REPAIR = { feedId: 'team', start: '2026-11-26T10:00:00-05:00', end: '2026-11-26T16:00:00-05:00', wholeDay: false, title: 'RÉPARATION' }
const CLOSED = { feedId: 'team', start: '2026-12-02T00:00:00-05:00', end: '2026-12-04T00:00:00-05:00', wholeDay: true, title: '' }
// Without a title, so that it's named by its calendar alone.
const STAY = { feedId: 'stays', start: '2026-11-20T15:00:00-05:00', end: '2026-11-22T11:00:00-05:00', wholeDay: false, title: '' }
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
  feeds: [TEAM, STAYS, LOFT],
  sessions: [PLAYED, TAKEOVER, CANCELLED],
  occupations: [STAY, REPAIR, CLOSED],
  holds: [ALWAYS],
  // Around the stay, which the takeover is within, the repair, and the closed days, but not the cancelled session.
  freeTime: [
    { start: TODAY, end: STAY.start },
    { start: STAY.end, end: REPAIR.start },
    { start: REPAIR.end, end: CLOSED.start },
    { start: CLOSED.end, end: LAST },
  ],
  conflicts: [CONFLICT],
  unprotectedSessions: [],
  undatedSessions: [UNDATED],
}
// The free time with the closed days alone.
const AROUND_CLOSED = [
  { start: TODAY, end: CLOSED.start },
  { start: CLOSED.end, end: LAST },
]
const EMPTY: Calendar = { ...CALENDAR, sessions: [], occupations: [], freeTime: [{ start: TODAY, end: LAST }] }

// The list's days, from today to 364 days later, and what the server gives for them: a two-week stay that's going on,
// with conflicts today and on later days, a cancelled session, a session over three days, a whole-day occupation over
// three days, and a day with two things.
const LIST = '/api/admin/calendar?from=2026-11-19&to=2027-11-18'
const LONG_STAY = { feedId: 'stays', start: '2026-11-18T15:00:00-05:00', end: '2026-12-02T11:00:00-05:00', wholeDay: false, title: '' }
const MEETING = { feedId: 'team', start: '2026-11-19T10:00:00-05:00', end: '2026-11-19T12:00:00-05:00', wholeDay: false, title: 'RÉUNION' }
const DELIVERY = { feedId: 'team', start: '2026-12-15T10:00:00-05:00', end: '2026-12-15T12:00:00-05:00', wholeDay: false, title: 'LIVRAISON' }
const EVENING = session('session-6', 'SOIRÉE DE DÉCEMBRE', '2026-12-15T20:00:00-05:00', '2026-12-15T22:00:00-05:00')
const CLOSED_LATER = { feedId: 'team', start: '2026-12-09T00:00:00-05:00', end: '2026-12-12T00:00:00-05:00', wholeDay: true, title: 'FERMÉ' }
const MARATHON = session('session-5', 'MARATHON MODULAIRE', '2027-02-06T18:00:00-05:00', '2027-02-08T01:00:00-05:00')
const longStay: ConflictThing = { kind: 'occupation', ...LONG_STAY }
const LIST_CALENDAR: Calendar = {
  ...CALENDAR,
  sessions: [TAKEOVER, CANCELLED, EVENING, MARATHON],
  occupations: [LONG_STAY, MEETING, REPAIR, CLOSED_LATER, DELIVERY],
  conflicts: [
    { start: MEETING.start, end: MEETING.end, things: [longStay, { kind: 'occupation', ...MEETING }] },
    { start: TAKEOVER.start!, end: TAKEOVER.end!, things: [longStay, CONFLICT.things[1]] },
    { start: REPAIR.start, end: REPAIR.end, things: [longStay, { kind: 'occupation', ...REPAIR }] },
  ],
}

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
const visibleText = (element: Element) => spaced(shownText(element))
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
const list = () => screen.getByRole('region', { name: 'À venir' })
const listRow = (name: string | RegExp) => within(list()).getByRole('button', { name: named(name) })

// Where the page brings the chosen day into view, which jsdom has no way to.
const scrollIntoView = vi.fn()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  vi.useRealTimers()
  scrollIntoView.mockReset()
  // @ts-expect-error jsdom has none.
  delete Element.prototype.scrollIntoView
})

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

      // Which keeps the focus.
      const todayButton = screen.getByRole('button', { name: "aujourd'hui" })
      act(() => todayButton.focus())
      fireEvent.click(todayButton)
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-19')
      expect(dayButton('2026-11-19')).toHaveAttribute('aria-pressed', 'true')
      expect(document.activeElement).toBe(todayButton)
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

    it('stretches what lasts until the end of the day, things and free time, down to its bottom', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const stretching = (day: string) => [...cell(day).querySelectorAll('.calendar-things > li')].map((li) => li.classList.contains('calendar-to-day-end'))
      // The stay, all day, and the session, until 1 h the next day, then their ends, and the free time after them (see
      // model.test.ts).
      expect(stretching('2026-11-21')).toEqual([true, true])
      expect(stretching('2026-11-22')).toEqual([false, false, true])
    })

    it("shows the free time of the month's own days, a day that nothing takes as available", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const free = (day: string) => [...cell(day).querySelectorAll('.calendar-free')].map(visibleText)
      expect(free('2026-11-19')).toEqual(['disponible'])
      expect(cell('2026-11-19')).toHaveClass('calendar-available')
      expect(free('2026-11-26')).toEqual(["dispo jusqu'à 10 h", 'dispo dès 16 h'])
      expect(cell('2026-11-26')).not.toHaveClass('calendar-available')
      // Not that of the month after, which the model has (see model.test.ts).
      expect(free('2026-12-05')).toEqual([])
      expect(cell('2026-12-05')).not.toHaveClass('calendar-available')
    })

    it('shows the free time the server gives, around a session too, and none when it gives none', async () => {
      // Protected from 11 h to 18 h on the 23rd, around a session, and nowhere else.
      const tea = session('session-7', 'APÉRO', '2026-11-23T13:00:00-05:00', '2026-11-23T15:00:00-05:00')
      const holds = [{ feedId: 'loft', start: '2026-11-23T11:00:00-05:00', end: '2026-11-23T18:00:00-05:00', wholeDay: false }]
      const freeTime = [
        { start: holds[0].start, end: tea.start! },
        { start: tea.end!, end: holds[0].end },
      ]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...EMPTY, sessions: [tea], holds, freeTime } })
      const first = renderAt('/admin/calendrier')
      await loaded()

      expect(cellText('2026-11-23')).toBe('23+dispo 11 h – 13 h13 h – 15 hsession : APÉROdispo 15 h – 18 h')
      expect(cell('2026-11-23').querySelectorAll('.calendar-mark-free')).toHaveLength(1)
      // Nothing takes it, but it isn't protected: no color, no mention, no mark.
      expect(cellText('2026-11-24')).toBe('24+')
      expect(cell('2026-11-24')).not.toHaveClass('calendar-available')
      expect(cell('2026-11-24').querySelector('.calendar-marks')).toBeNull()
      first.unmount()

      // Nothing's protected without a holds feed.
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...EMPTY, feeds: [TEAM, STAYS], holds: [], freeTime: [] } })
      renderAt('/admin/calendrier')
      await loaded()
      expect(document.querySelectorAll('.calendar-month .calendar-free, .calendar-month .calendar-mark-free, .calendar-available')).toHaveLength(0)
    })

    it('says what each kind is in the legend, in a tooltip, which does nothing else', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const legend = screen.getByRole('list', { name: 'Légende' })
      const tips = {
        session: 'Toutes les sessions qui ont une date.',
        occupation: "Période où le studio n'est pas disponible pour des sessions.",
        disponible: 'Plage protégée pour les sessions, que ni session ni occupation ne prend.',
        conflit: 'Une session et une occupation, ou deux occupations, qui se chevauchent.',
      }
      expect(within(legend).getAllByRole('button').map((button) => button.textContent)).toEqual(Object.keys(tips))
      for (const [name, tip] of Object.entries(tips)) {
        const button = within(legend).getByRole('button', { name })
        expect(button).toHaveAccessibleDescription(tip)
        fireEvent.click(button)
        expect(path()).toBe('/admin/calendrier')
      }
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

    it('brings the chosen day, under the month, into view, and the day in the month too, when it is chosen by clicking it', async () => {
      mockFetch({ ...LOGGED_IN, ...COLLECTIVES, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY })
      renderAt('/admin/calendrier?day=2026-11-20')
      await loaded()
      // Not when the page opens with it.
      expect(scrollIntoView).not.toHaveBeenCalled()

      fireEvent.click(cell('2026-11-26'))
      // Its heading, then the day, which the heading's being in view mustn't hide.
      expect(scrollIntoView.mock.contexts).toEqual([within(chosenDay()!).getByRole('heading', { level: 2 }), cell('2026-11-26')])
      expect(scrollIntoView.mock.calls).toEqual([[{ block: 'nearest' }], [{ block: 'nearest' }]])
      // Nor when it's unchosen, nor by "+", which puts the focus on its form, nor by "aujourd'hui", nor going back.
      fireEvent.click(cell('2026-11-26'))
      fireEvent.click(addButton('2026-11-27'))
      fireEvent.click(screen.getByRole('button', { name: "aujourd'hui" }))
      fireEvent.click(screen.getByRole('button', { name: 'mois suivant' }))
      back()
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
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

    it('says when a session is outside protected time, on each day it takes, and the month does not', async () => {
      const unprotectedSessions = [unprotected(TAKEOVER)]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, unprotectedSessions } })
      renderAt('/admin/calendrier?day=2026-11-21')
      await loaded()

      expect(visibleText(within(chosenDay()!).getAllByRole('listitem')[1])).toBe(
        "session21 h – 1 hHAUTE RIVE TAKEOVER Aurore, Brume · Cyanhors plage protégéeconflit avec l'occupation Séjours",
      )
      fireEvent.click(dayButton('2026-11-22'))
      expect(visibleText(within(chosenDay()!).getAllByRole('listitem')[1])).toBe(
        "sessionsam. 21 nov., 21 h – 1 hHAUTE RIVE TAKEOVER Aurore, Brume · Cyanhors plage protégéeconflit avec l'occupation Séjours",
      )
      expect(cellText('2026-11-21')).not.toContain('protégée')
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
      // A cleaning, during the stay, which has a title, unlike the stay.
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
      // By their names alone: an occupation's title, or its calendar's name when it has none.
      expect(visibleText(within(box).getAllByRole('listitem')[0])).toBe('sam. 21 nov. 10 h – 12 h · Séjours et MÉNAGE')
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
    const timeField = (label: 'Début' | 'Fin') => within(newSession()!).getByRole('group', { name: label })
    const time = (label: 'Début' | 'Fin', value: string) => typeTime(timeField(label), value)
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
      expect(shownTime(timeField('Début'))).toBe('21 h 00')

      // Another day's "+" opens it there, empty.
      fireEvent.click(addButton('2026-11-25'))
      expect(chosenDay()).toHaveAccessibleName('mercredi 25 novembre 2026')
      expect(shownTime(timeField('Début'))).toBe('–– h ––')

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
      // Its hour.
      await waitFor(() => expect(document.activeElement).toBe(timeParts(timeField('Début'))[0]))

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

    it('takes times in the 24-hour format, which have no time while their hour or their minute is empty, and is sent with Enter', async () => {
      mockFetch({ ...LOGGED_IN, ...COLLECTIVES, [NOVEMBER]: CALENDAR, 'POST /api/admin/sessions': { ok: false, error: 'Internal Server Error' } })
      renderAt('/admin/calendrier')
      await loaded()
      fireEvent.click(addButton('2026-11-25'))
      const form = newSession()!

      // Going from a time's hour to its minute isn't leaving it.
      act(() => timeParts(timeField('Début'))[0].focus())
      act(() => timeParts(timeField('Début'))[1].focus())
      expect(within(form).queryByText("Indiquez l'heure de début.")).not.toBeInTheDocument()
      act(() => timeParts(timeField('Fin'))[0].focus())
      expect(within(form).getByText("Indiquez l'heure de début.")).toBeInTheDocument()

      time('Début', '21:00')
      time('Fin', '23:00')
      expect(shownTime(timeField('Début'))).toBe('21 h 00')
      expect(within(form).getByText('Dure 2 h.')).toBeInTheDocument()
      // Emptying only the start's minute leaves its hour, but no time.
      const [, minute] = timeParts(timeField('Début'))
      act(() => minute.focus())
      fireEvent.keyDown(minute, { key: 'Backspace' })
      expect(shownTime(timeField('Début'))).toBe('21 h ––')
      expect(within(form).queryByText(/^Dure/)).not.toBeInTheDocument()
      expect(within(form).getByText("Indiquez l'heure de début.")).toBeInTheDocument()
      // The same time again.
      time('Début', '21:00')
      expect(within(form).queryByText("Indiquez l'heure de début.")).not.toBeInTheDocument()
      expect(within(form).getByText('Dure 2 h.')).toBeInTheDocument()

      // Enter in a time sends the form.
      fireEvent.click(within(form).getByRole('radio', { name: 'Guest mixes' }))
      fireEvent.keyDown(minute, { key: 'Enter' })
      await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    })

    it('adds the session, without sets, and with its other fields empty, then shows it on its day, still chosen', async () => {
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
      // The calendar as it is once the session is added.
      const POST = { 'POST /api/admin/sessions': { ok: true, session: added } }
      mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...POST, [NOVEMBER]: { ...CALENDAR, sessions: [...CALENDAR.sessions, added] } })
      create()

      // The form closes, and the day stays chosen, with the focus on it, and says so.
      await waitFor(() => expect(newSession()).not.toBeInTheDocument())
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-25')
      expect(document.activeElement).toBe(dayButton('2026-11-25'))
      expect(within(chosenDay()!).getByRole('status')).toHaveTextContent('La session HAUTE RIVE TAKEOVER a été ajoutée.')
      // It's read again, which shows the session.
      await waitFor(() => expect(within(chosenDay()!).getByRole('link', { name: 'HAUTE RIVE TAKEOVER' })).toHaveAttribute('href', '/admin/sessions/session-9'))
      expect(requestsTo('GET', NOVEMBER)).toHaveLength(1)
      expect(cellText('2026-11-25')).toContain('21 h – 1 hsession : HAUTE RIVE TAKEOVER')
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

      // Until the form opens again.
      fireEvent.click(addButton('2026-11-25'))
      expect(within(chosenDay()!).queryByText(/a été ajoutée/)).not.toBeInTheDocument()
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
      expect(within(alert).getByRole('link', { name: named('HAUTE RIVE TAKEOVER, sam. 21 nov. 2026') })).toHaveAttribute('href', '/admin/sessions/session-1')
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

  describe('the views', () => {
    it('ask for the 365 days from today with the list, and the grid otherwise', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [LIST]: LIST_CALENDAR })
      const first = renderAt('/admin/calendrier?view=list')
      await loaded()
      expect(requestsTo('GET', LIST)).toHaveLength(1)
      expect(list()).toBeInTheDocument()
      // Without a legend, since the rows say what they are.
      expect(screen.queryByRole('list', { name: 'Légende' })).not.toBeInTheDocument()
      first.unmount()

      renderAt('/admin/calendrier?view=semaine')
      await loaded()
      expect(requestsTo('GET', NOVEMBER)).toHaveLength(1)
      expect(screen.getByRole('table', { name: 'novembre 2026' })).toBeInTheDocument()
    })

    it('add a step to the history, keeping the month and the day, the one shown doing nothing', async () => {
      mockFetch({ ...LOGGED_IN, [DECEMBER]: EMPTY, [LIST]: LIST_CALENDAR })
      renderAt('/admin/calendrier?month=2026-12&day=2026-12-02')
      await loaded()
      const [month, listed] = within(screen.getByRole('group', { name: 'Vue' })).getAllByRole('button')
      expect([month.textContent, listed.textContent]).toEqual(['mois', 'liste'])
      expect(month).toHaveAttribute('aria-pressed', 'true')
      const heading = screen.getByRole('heading', { name: 'décembre 2026' })

      act(() => listed.focus())
      fireEvent.click(listed)
      expect(path()).toBe('/admin/calendrier?month=2026-12&day=2026-12-02&view=list')
      // The same heading, which screen readers announce, and the same buttons, which keep the focus.
      expect(heading).toHaveTextContent('À venir')
      expect(heading).toHaveAttribute('aria-live', 'polite')
      expect(document.activeElement).toBe(listed)
      expect(listed).toHaveAttribute('aria-pressed', 'true')
      expect(month).toHaveAttribute('aria-pressed', 'false')
      for (const name of ['mois précédent', 'mois suivant', "aujourd'hui"]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      expect(chosenDay()).not.toBeInTheDocument()
      await waitFor(() => expect(requestsTo('GET', LIST)).toHaveLength(1))

      fireEvent.click(listed)
      expect(path()).toBe('/admin/calendrier?month=2026-12&day=2026-12-02&view=list')
      back()
      expect(path()).toBe('/admin/calendrier?month=2026-12&day=2026-12-02')
      expect(chosenDay()).toHaveAccessibleName('mercredi 2 décembre 2026')
    })

    it('close the form for a new session, which stays closed when going back', async () => {
      mockFetch({ ...LOGGED_IN, ...COLLECTIVES, [NOVEMBER]: CALENDAR, [LIST]: LIST_CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      fireEvent.click(addButton('2026-11-25'))
      expect(newSession()).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'liste' }))
      fireEvent.click(screen.getByRole('button', { name: 'mois' }))
      expect(chosenDay()).toHaveAccessibleName('mercredi 25 novembre 2026')
      expect(newSession()).not.toBeInTheDocument()
    })
  })

  describe('the list', () => {
    it('gives every month of its days, each thing once, on the first of them it takes, on one line', async () => {
      mockFetch({ ...LOGGED_IN, [LIST]: LIST_CALENDAR })
      renderAt('/admin/calendrier?view=list')
      await loaded()

      const months = within(list()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
      expect(months).toHaveLength(13)
      expect([months[0], months[1], months[2], months.at(-1)]).toEqual(['novembre 2026', 'décembre 2026', 'janvier 2027', 'novembre 2027'])
      expect(within(list()).getAllByRole('listitem').map(visibleText)).toEqual([
        // Going on since yesterday, with its conflicts: today's, and those of later days, with their day.
        "jeu. 19 nov. occupation → mer. 2 Séjours · conflit avec RÉUNION · conflit avec HAUTE RIVE TAKEOVER (sam. 21 nov.) · conflit avec RÉPARATION (jeu. 26 nov.)",
        "jeu. 19 nov. occupation 10 h – 12 h RÉUNION, calendrier Calendrier de l'équipe · conflit avec Séjours",
        'sam. 21 nov. session 21 h – 1 h HAUTE RIVE TAKEOVER · Aurore, Brume · Cyan · conflit avec Séjours',
        'mar. 24 nov. session 20 h – 23 h LIVE PERFORMANCE annulée',
        "jeu. 26 nov. occupation 10 h – 16 h RÉPARATION, calendrier Calendrier de l'équipe · conflit avec Séjours",
        "mer. 9 déc. occupation → ven. 11 FERMÉ, calendrier Calendrier de l'équipe",
        // In order of start.
        "mar. 15 déc. occupation 10 h – 12 h LIVRAISON, calendrier Calendrier de l'équipe",
        'mar. 15 déc. session 20 h – 22 h SOIRÉE DE DÉCEMBRE',
        'sam. 6 févr. session 18 h → lun. 8 MARATHON MODULAIRE',
      ])
      // Each row is one control, without links, and a cancelled session's in its status colors.
      expect(within(list()).queryByRole('link')).not.toBeInTheDocument()
      expect(listRow(/LIVE PERFORMANCE/).closest('li')).toHaveClass('admin-status-cancelled')
      // A month without anything, and where the list stops.
      expect(within(list()).getByRole('heading', { name: 'janvier 2027' }).nextElementSibling).toHaveTextContent(/^Rien\.$/)
      expect(within(list()).getByRole('heading', { name: 'novembre 2027' }).nextElementSibling).toHaveTextContent(/^Rien\.$/)
      expect(list().lastElementChild).toHaveTextContent("La liste s'arrête au jeudi 18 novembre 2027.")
      // Without free time.
      expect(within(list()).queryByText(/dispo/)).not.toBeInTheDocument()
    })

    it('says which sessions are outside protected time', async () => {
      const unprotectedSessions = [unprotected(TAKEOVER)]
      mockFetch({ ...LOGGED_IN, [LIST]: { ...LIST_CALENDAR, unprotectedSessions } })
      renderAt('/admin/calendrier?view=list')
      await loaded()

      expect(visibleText(listRow(/^sam\. 21 nov\. session/))).toBe('sam. 21 nov. session 21 h – 1 h HAUTE RIVE TAKEOVER · Aurore, Brume · Cyan · hors plage protégée · conflit avec Séjours')
      expect(visibleText(listRow(/^mar\. 15 déc\. session/))).toBe('mar. 15 déc. session 20 h – 22 h SOIRÉE DE DÉCEMBRE')
    })

    it("says a conflict's day with its year when it isn't the row's day's", async () => {
      const asThing = ({ id, title, start, end, status }: Session): ConflictThing => ({ kind: 'session', id, title, start: start!, end: end!, status })
      // A stay until January, and another over January, each in conflict with a session in January.
      const late = session('session-7', 'NOUVEL AN', '2027-01-01T22:00:00-05:00', '2027-01-02T02:00:00-05:00')
      const later = session('session-8', 'ÉPIPHANIE', '2027-01-06T20:00:00-05:00', '2027-01-06T23:00:00-05:00')
      const stay = { ...LONG_STAY, end: '2027-01-02T11:00:00-05:00' }
      const january = { ...LONG_STAY, start: '2027-01-04T15:00:00-05:00', end: '2027-01-08T11:00:00-05:00' }
      const conflicts: Calendar['conflicts'] = [
        { start: late.start!, end: late.end!, things: [{ kind: 'occupation', ...stay }, asThing(late)] },
        { start: later.start!, end: later.end!, things: [{ kind: 'occupation', ...january }, asThing(later)] },
      ]
      mockFetch({ ...LOGGED_IN, [LIST]: { ...EMPTY, sessions: [late, later], occupations: [stay, january], conflicts } })
      renderAt('/admin/calendrier?view=list')
      await loaded()

      const rows = within(list()).getAllByRole('listitem').map(visibleText)
      expect(rows[0]).toBe('jeu. 19 nov. occupation → sam. 2 janv. Séjours · conflit avec NOUVEL AN (ven. 1 janv. 2027)')
      expect(rows[2]).toBe('lun. 4 janv. occupation 15 h → ven. 8 Séjours · conflit avec ÉPIPHANIE (mer. 6 janv.)')
    })

    it('shows the day of a row, chosen, in the month, as a step in the history, and back finds the list', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY, [LIST]: LIST_CALENDAR })
      renderAt('/admin/calendrier?view=list')
      await loaded()

      fireEvent.click(listRow(/^sam\. 21 nov\./))
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-21')
      await waitFor(() => expect(document.activeElement).toBe(dayButton('2026-11-21')))
      expect(dayButton('2026-11-21')).toHaveAttribute('aria-pressed', 'true')
      // Once it shows what's on it, the chosen day is brought into view.
      await waitFor(() => expect(scrollIntoView.mock.contexts).toEqual([within(chosenDay()!).getByRole('heading', { level: 2 }), cell('2026-11-21')]))
      expect(chosenDay()).toHaveTextContent('HAUTE RIVE TAKEOVER')

      // The list, as it was, while it's read again.
      const again = held()
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY, [LIST]: again.body })
      back()
      expect(path()).toBe('/admin/calendrier?view=list')
      expect(listRow(/^sam\. 21 nov\./)).toBeInTheDocument()
      await again.answer(LIST_CALENDAR)

      // Something going on since before today is on today.
      fireEvent.click(listRow(/^jeu\. 19 nov\. occupation → mer\. 2/))
      expect(path()).toBe('/admin/calendrier?month=2026-11&day=2026-11-19')
      back()
      // A day of another month.
      fireEvent.click(listRow(/SOIRÉE DE DÉCEMBRE/))
      expect(path()).toBe('/admin/calendrier?month=2026-12&day=2026-12-15')
      await waitFor(() => expect(document.activeElement).toBe(dayButton('2026-12-15')))
    })

    it('shows the day of a conflict of "À régler" in the month, as a step in the history', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [LIST]: LIST_CALENDAR })
      renderAt('/admin/calendrier?view=list&issues=open')
      const box = await loaded()

      const row = () => within(box).getAllByRole('button', { name: named(/^sam\. 21 nov\./) })[0]
      fireEvent.click(row())
      expect(path()).toBe('/admin/calendrier?issues=open&month=2026-11&day=2026-11-21')
      await waitFor(() => expect(document.activeElement).toBe(dayButton('2026-11-21')))
      // From the month of that day, it doesn't add one.
      fireEvent.click(screen.getByRole('button', { name: 'fermer le jour' }))
      fireEvent.click(row())
      expect(path()).toBe('/admin/calendrier?issues=open&month=2026-11&day=2026-11-21')
      back()
      expect(path()).toBe('/admin/calendrier?view=list&issues=open')
    })

    it('shows nothing before its calendar is read', async () => {
      const read = held()
      mockFetch({ ...LOGGED_IN, [LIST]: read.body })
      renderAt('/admin/calendrier?view=list')

      expect(await screen.findByRole('region', { name: 'À venir' })).toBeEmptyDOMElement()
      await read.answer(LIST_CALENDAR)
      expect(within(list()).getAllByRole('heading', { level: 3 })).toHaveLength(13)
    })

    it('shows only the view asked for last, whatever order the answers come in', async () => {
      const read = held()
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [LIST]: read.body })
      renderAt('/admin/calendrier')
      await loaded()

      fireEvent.click(screen.getByRole('button', { name: 'liste' }))
      fireEvent.click(screen.getByRole('button', { name: 'mois' }))
      await waitFor(() => expect(requestsTo('GET', NOVEMBER)).toHaveLength(2))
      await read.answer({ ...LIST_CALENDAR, undatedSessions: [] })
      // November's: the list's answer came too late.
      expect(screen.getByRole('region', { name: 'À régler' })).toHaveTextContent('1 sans date')
      fireEvent.click(screen.getByRole('button', { name: 'liste' }))
      // Nor was it kept for the list.
      expect(list()).toBeEmptyDOMElement()
    })
  })

  describe('on narrow screens', () => {
    it("marks what's on each day, for the eyes only, in the month's order", async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR })
      renderAt('/admin/calendrier')
      await loaded()

      const marks = (day: string) => cell(day).querySelector('.calendar-marks')
      const kinds = (day: string) => [...marks(day)!.children].map((mark) => mark.className.match(/calendar-mark-(session|occupation|free)/)![1])
      const conflicting = (day: string) => [...marks(day)!.children].map((mark) => mark.classList.contains('calendar-mark-conflict'))
      expect(marks('2026-11-21')).toHaveAttribute('aria-hidden', 'true')
      expect(marks('2026-11-21')).toHaveTextContent(/^$/)
      // Both in a conflict, each framed.
      expect(kinds('2026-11-21')).toEqual(['occupation', 'session'])
      expect(conflicting('2026-11-21')).toEqual([true, true])
      // Free time once, after the things, whatever its stretches.
      expect(kinds('2026-11-22')).toEqual(['occupation', 'session', 'free'])
      expect(kinds('2026-11-26')).toEqual(['occupation', 'free'])
      expect(conflicting('2026-11-26')).toEqual([false, false])
      // A day free all day.
      expect(kinds('2026-11-19')).toEqual(['free'])
      // Done and cancelled sessions.
      expect(marks('2026-11-07')!.firstElementChild).toHaveClass('calendar-mark-done')
      expect(marks('2026-11-24')!.firstElementChild).toHaveClass('calendar-mark-cancelled')
      // Only the month's own days have free time.
      expect(marks('2026-12-01')).toBeNull()
      expect(kinds('2026-12-02')).toEqual(['occupation'])
      // The day's words still describe its button.
      expect(dayButton('2026-11-19')).toHaveAccessibleDescription('disponible')
      // The legend gives the sessions' status, which narrow screens alone show, as marks.
      const legend = screen.getByRole('list', { name: 'Légende' })
      const narrow = [...legend.querySelectorAll('.calendar-legend-narrow')]
      expect(narrow.map((item) => item.textContent?.trim())).toEqual(['jouée', 'annulée'])
      expect(narrow[0].firstElementChild).toHaveClass('calendar-mark', 'calendar-mark-session', 'calendar-mark-done')
      expect(narrow[1].firstElementChild).toHaveClass('calendar-mark', 'calendar-mark-session', 'calendar-mark-cancelled')
    })
  })

  describe('À régler', () => {
    it('counts what needs settling, closed until it is opened, which the address keeps', async () => {
      const unprotectedSessions = [unprotected(TAKEOVER)]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, unprotectedSessions } })
      renderAt('/admin/calendrier')
      await loaded()

      const box = screen.getByRole('region', { name: 'À régler' })
      // Its first row, a button in its heading, whose chevron screen readers don't read.
      const toggle = within(within(box).getByRole('heading', { level: 2, name: /^À régler/ })).getByRole('button', { expanded: false })
      expect(toggle).toHaveAccessibleName('À régler 1 conflit 1 hors plage protégée 1 sans date')
      expect(within(box).queryByRole('link', { name: 'LES SŒURS ONDES TAKEOVER' })).not.toBeInTheDocument()
      fireEvent.click(toggle)
      expect(path()).toBe('/admin/calendrier?issues=open')
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(toggle)
      expect(path()).toBe('/admin/calendrier')
    })

    it('lists the conflicts and the sessions without a date, each row of which is what is done about it', async () => {
      // A conflict next year, which says its year, between a stay and a repair that starts with its day.
      const nextYear = {
        start: '2027-01-09T00:00:00-05:00',
        end: '2027-01-10T11:00:00-05:00',
        things: [
          { kind: 'occupation', ...STAY, start: '2027-01-08T15:00:00-05:00', end: '2027-01-10T11:00:00-05:00' },
          { kind: 'occupation', ...REPAIR, start: '2027-01-09T00:00:00-05:00', end: '2027-01-11T00:00:00-05:00' },
        ],
      } as Calendar['conflicts'][number]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: { ...EMPTY, conflicts: [CONFLICT, nextYear] } })
      renderAt('/admin/calendrier?month=2026-12&issues=open')
      const box = await screen.findByRole('region', { name: 'À régler' })

      // A group for each kind, with its tag and its heading.
      expect([...box.querySelectorAll('h3')].map(visibleText)).toEqual(['conflits chevauchements à résoudre', 'sans date sessions à placer'])
      // Without sentences under them.
      expect(box.querySelectorAll('.calendar-issue-group > p')).toHaveLength(0)
      const [conflict, later, undated] = within(box).getAllByRole('listitem')
      // One line each, a single control, without links of its own.
      expect(visibleText(conflict)).toBe('sam. 21 nov. 21 h – 1 h · Séjours et HAUTE RIVE TAKEOVER')
      const showDay = within(conflict).getByRole('button')
      expect(within(conflict).getByRole('button', { name: named('sam. 21 nov. 21 h – 1 h · Séjours et HAUTE RIVE TAKEOVER') })).toBe(showDay)
      expect(within(conflict).queryByRole('link')).not.toBeInTheDocument()
      expect(visibleText(later)).toBe('sam. 9 janv. 2027 → dim. 10 · Séjours et RÉPARATION')
      // Its duration after its sets' performers, which "·" separates.
      expect(visibleText(undated)).toBe('à déterminer LES SŒURS ONDES TAKEOVER · Ondine · Écume, 3 h')
      expect(within(undated).getByRole('link')).toBe(within(undated).getByRole('link', { name: named('à déterminer LES SŒURS ONDES TAKEOVER · Ondine · Écume, 3 h') }))
      expect(within(undated).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-4')

      // A conflict shows its day, chosen, in its month, with the focus on it.
      fireEvent.click(showDay)
      expect(path()).toBe('/admin/calendrier?month=2026-11&issues=open&day=2026-11-21')
      await waitFor(() => expect(document.activeElement).toBe(dayButton('2026-11-21')))
      expect(dayButton('2026-11-21')).toHaveAttribute('aria-pressed', 'true')
    })

    it('lists the sessions outside protected time, between the conflicts and the sessions without a date, each row of which shows its day', async () => {
      // In the month after the one shown, and next year.
      const nextYear = session('session-8', 'NOUVEL AN', '2027-01-02T21:00:00-05:00', '2027-01-03T01:00:00-05:00')
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, unprotectedSessions: [unprotected(EVENING), unprotected(nextYear)] }, [DECEMBER]: EMPTY })
      renderAt('/admin/calendrier?issues=open')
      const box = await loaded()

      expect([...box.querySelectorAll('h3')].map(visibleText)).toEqual([
        'conflits chevauchements à résoudre',
        'hors plage protégée sessions à protéger ou à déplacer',
        'sans date sessions à placer',
      ])
      const [, evening, newYear] = within(box).getAllByRole('listitem')
      expect(visibleText(evening)).toBe('mar. 15 déc. 20 h – 22 h · SOIRÉE DE DÉCEMBRE')
      expect(visibleText(newYear)).toBe('sam. 2 janv. 2027 21 h – 1 h · NOUVEL AN')
      const showDay = within(evening).getByRole('button')
      expect(within(evening).getByRole('button', { name: named('mar. 15 déc. 20 h – 22 h · SOIRÉE DE DÉCEMBRE') })).toBe(showDay)
      expect(within(evening).queryByRole('link')).not.toBeInTheDocument()

      // Its day, chosen, in its month, with the focus on it.
      fireEvent.click(showDay)
      expect(path()).toBe('/admin/calendrier?issues=open&month=2026-12&day=2026-12-15')
      await waitFor(() => expect(document.activeElement).toBe(dayButton('2026-12-15')))
      expect(dayButton('2026-12-15')).toHaveAttribute('aria-pressed', 'true')
    })

    it('is to be opened when the only thing to settle is a session outside protected time', async () => {
      const unprotectedSessions = [unprotected(TAKEOVER)]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, conflicts: [], undatedSessions: [], unprotectedSessions } })
      renderAt('/admin/calendrier')
      const box = await loaded()

      const toggle = within(box).getByRole('button', { name: 'À régler 1 hors plage protégée' })
      expect(toggle).not.toHaveAttribute('aria-disabled')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('shows a session that is done or cancelled in its status colors on the chosen day, and its title alone in its conflicts', async () => {
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
      const freeTime = [
        { start: TODAY, end: morning.start! },
        { start: repair.end, end: LAST },
      ]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...EMPTY, sessions: [morning, CANCELLED], occupations: [repair], conflicts: [conflict], freeTime } })
      const first = renderAt('/admin/calendrier?day=2026-11-19&issues=open')
      await loaded()

      // After the free time before it.
      const [before, played] = within(chosenDay()!).getAllByRole('listitem')
      expect(visibleText(before)).toBe("disponiblejusqu'à 9 h")
      expect(played).toHaveClass('calendar-row', 'admin-status-done')
      expect(played).toHaveTextContent('MATINALE jouée')
      const box = screen.getByRole('region', { name: 'À régler' })
      expect(visibleText(within(box).getAllByRole('listitem')[0])).toBe('jeu. 19 nov. 10 h – 11 h · MATINALE et RÉPARATION')
      first.unmount()

      renderAt('/admin/calendrier?day=2026-11-24')
      await loaded()
      // After the day's free time, which a cancelled session doesn't take.
      const [stretch, cancelled] = within(chosenDay()!).getAllByRole('listitem')
      expect(stretch).toHaveTextContent(/^disponible/)
      expect(cancelled).toHaveClass('calendar-row', 'admin-status-cancelled')
    })

    it('says when there is nothing to settle, and warns of the feeds that were not read, about conflicts alone without a holds feed', async () => {
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

    it('warns of the holds feeds that were not read, and of free time with the occupations feeds then', async () => {
      const failed = "The link can't be read: its server fails (503)"
      const feeds = [TEAM, STAYS, { ...TEAM, id: 'new', name: 'Nouveau', readAt: null }, { ...LOFT, error: failed }, { ...LOFT, id: 'blocks', name: 'Blocages', readAt: null }]
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...CALENDAR, feeds } })
      renderAt('/admin/calendrier')
      const box = await loaded()

      expect([...box.querySelectorAll('.admin-warning')].map(visibleText)).toEqual([
        `⚠ Des conflits et des plages disponibles peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier « Séjours » a échoué : ${failed}. Voir Configuration.`,
        "⚠ Le calendrier « Nouveau » n'a pas encore été lu : des conflits peuvent manquer, et des plages être indiquées disponibles à tort.",
        `⚠ Des plages disponibles et des sessions hors plage protégée peuvent manquer, ou ne plus être à jour, car la dernière lecture du calendrier « Loft » a échoué : ${failed}. Voir Configuration.`,
        "⚠ Le calendrier « Blocages » n'a pas encore été lu : des plages disponibles peuvent manquer, et des sessions être signalées à tort hors plage protégée.",
      ])
      expect(within(box.querySelectorAll<HTMLElement>('.admin-warning')[2]).getByRole('link', { name: 'Configuration' })).toHaveAttribute('href', '/admin/configuration')
    })

    it('has no notice when there are no feeds: with nothing to settle, it only has its row', async () => {
      // Without feeds, there are no occupations, and no conflicts.
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: { ...EMPTY, feeds: [], conflicts: [], undatedSessions: [] } })
      renderAt('/admin/calendrier')
      await loaded()

      const box = screen.getByRole('region', { name: 'À régler' })
      expect(visibleText(box)).toBe('À régler rien')
    })
  })

  describe('reading the feeds again', () => {
    const REFRESH = 'POST /api/admin/calendar/feeds/refresh'
    const refreshButton = () => screen.getByRole('button', { name: 'relire les calendriers externes' })
    // What screen readers are told about it.
    const said = () => visibleText(document.querySelector('.calendar-toolbar + [role="status"]')!)

    it('reads them, greyed out and keeping the focus meanwhile, then reads the calendar again', async () => {
      const refresh = held()
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [REFRESH]: refresh.body })
      renderAt('/admin/calendrier')
      await loaded()
      const button = refreshButton()
      act(() => button.focus())

      fireEvent.click(button)
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(said()).toBe('Lecture des calendriers externes…')
      await waitFor(() => expect(requestsTo('POST', '/api/admin/calendar/feeds/refresh')).toHaveLength(1))
      // Clicking it again meanwhile does nothing.
      fireEvent.click(button)
      expect(requestsTo('POST', '/api/admin/calendar/feeds/refresh')).toHaveLength(1)
      expect(requestsTo('GET', NOVEMBER)).toHaveLength(1)

      await refresh.answer({ ok: true, total: 1, feeds: [TEAM] })
      await waitFor(() => expect(requestsTo('GET', NOVEMBER)).toHaveLength(2))
      expect(button).not.toHaveAttribute('aria-disabled')
      expect(said()).toBe('Calendriers externes relus.')
      expect(document.activeElement).toBe(button)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('tells screen readers which feeds could not be read, whose warnings "À régler" has', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [REFRESH]: { ok: true, total: 3, feeds: [TEAM, STAYS, { ...STAYS, id: 'airbnb', name: 'Airbnb' }] } })
      renderAt('/admin/calendrier')
      await loaded()
      fireEvent.click(refreshButton())
      await waitFor(() => expect(said()).toBe('Calendriers externes relus, sauf « Séjours » et « Airbnb » : voir « À régler ».'))
    })

    it('says why they could not be read again, without reading the calendar again, until they are read again', async () => {
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [REFRESH]: { ok: false, error: 'Internal server error' } })
      renderAt('/admin/calendrier')
      await loaded()
      fireEvent.click(refreshButton())

      expect(await screen.findByRole('alert')).toHaveTextContent("Les calendriers externes n'ont pas pu être relus : Internal server error")
      expect(refreshButton()).not.toHaveAttribute('aria-disabled')
      expect(said()).toBe('')
      expect(requestsTo('GET', NOVEMBER)).toHaveLength(1)

      // Used again, the error goes away as soon as it's clicked.
      const refresh = held()
      mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [REFRESH]: refresh.body })
      fireEvent.click(refreshButton())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await refresh.answer({ ok: true, total: 1, feeds: [TEAM] })
      await waitFor(() => expect(said()).toBe('Calendriers externes relus.'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
      await december.answer({ ...EMPTY, occupations: [CLOSED], freeTime: AROUND_CLOSED })
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
      await december.answer({ ...EMPTY, occupations: [CLOSED], freeTime: AROUND_CLOSED, undatedSessions: [] })
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

describe("Calendrier's links to the admin's calendars", () => {
  const legend = () => screen.getByRole('list', { name: 'Légende' })
  const link = (calendar: string) => within(legend()).getByRole('link', { name: `s'abonner au calendrier des ${calendar}` })
  const webcal = (calendar: string) => `webcal://${location.host}/${calendar}.ics?token=${TOKEN}`

  it('are in the legend, after "session" and "occupation", read once whatever the view or the month', async () => {
    mockFetch({ ...LOGGED_IN, [NOVEMBER]: CALENDAR, [DECEMBER]: EMPTY, [LIST]: LIST_CALENDAR })
    renderAt('/admin/calendrier')

    await waitFor(() => link('sessions'))
    expect(link('sessions')).toHaveAttribute('href', webcal('sessions'))
    expect(link('sessions')).toHaveAttribute('title', "s'abonner au calendrier des sessions")
    expect(link('occupations')).toHaveAttribute('href', webcal('occupations'))
    expect(link('occupations')).toHaveAttribute('title', "s'abonner au calendrier des occupations")
    // Only "session" and "occupation" have one.
    expect(
      within(legend())
        .getAllByRole('listitem')
        .map((item) => within(item).queryByRole('link') !== null),
    ).toEqual([true, true, false, false, false, false])

    // Not read again when the month or the view changes.
    fireEvent.click(screen.getByRole('button', { name: 'mois suivant' }))
    await waitFor(() => expect(requestsTo('GET', DECEMBER)).toHaveLength(1))
    expect(link('sessions')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'liste' }))
    await waitFor(() => expect(requestsTo('GET', LIST)).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'mois' }))
    expect(link('occupations')).toHaveAttribute('href', webcal('occupations'))
    expect(requestsTo('GET', TOKEN_URL)).toHaveLength(1)
  })

  it("aren't there until the token is read, nor when it can't be", async () => {
    const answer = held()
    mockFetch({ ...LOGGED_IN, [TOKEN_URL]: answer.body, [NOVEMBER]: CALENDAR })
    renderAt('/admin/calendrier')
    await loaded()
    expect(within(legend()).getByText('session')).toBeInTheDocument()
    expect(within(legend()).queryByRole('link')).toBeNull()

    await answer.answer({ ok: false, error: 'Internal server error' })
    expect(within(legend()).queryByRole('link')).toBeNull()
    expect(screen.queryByText(/Internal server error/)).toBeNull()
  })
})
