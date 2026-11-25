import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import type { StoredSession, StoredSet } from '../sessions/store.js'
import { occupationsCalendar, sessionsCalendar } from './calendars.js'
import type { CalendarOptions, FeedWithRead } from './calendars.js'

// Admins' calendars, as iCalendar (see docs/design/server/admin-calendars.md). An iCalendar parser, ical.js, reads
// them back, as calendar apps would.

const SITE = 'https://parking.radio'
const NOW = new Date('2026-11-19T15:30:00Z')
const OPTIONS: CalendarOptions = { siteOrigin: SITE, environment: 'production', now: NOW }

function session(fields: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 'session-1',
    createdAt: new Date('2026-10-01T12:00:00Z'),
    createdBy: 'admin@example.com',
    startAt: new Date('2026-11-15T02:00:00Z'),
    durationMinutes: 120,
    type: 'guest-mixes',
    name: '',
    takeoverId: null,
    applicationId: null,
    raEventId: null,
    description: '',
    flyerKey: null,
    flyerType: null,
    updatedBy: null,
    updatedAt: null,
    status: 'planned',
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    announced: true,
    announcedUpdatedBy: null,
    announcedUpdatedAt: null,
    takeover: null,
    application: null,
    sets: [],
    ...fields,
  }
}

// A set of a session, with its performers, by name.
const set = (names: string[], status: StoredSet['status'] = 'planned'): StoredSet => ({
  id: `set-${names.join('-')}`,
  createdAt: new Date('2026-10-01T12:00:00Z'),
  createdBy: 'admin@example.com',
  sessionId: 'session-1',
  position: 0,
  durationMinutes: 60,
  performanceTypes: ['dj'],
  otherPerformanceType: '',
  genres: [],
  soundcloudTrackId: null,
  soundcloudTrackUrl: null,
  youtubeVideoId: null,
  applicationId: null,
  updatedBy: null,
  updatedAt: null,
  status,
  statusUpdatedBy: null,
  statusUpdatedAt: null,
  performers: names.map((name) => ({ id: `artist-${name}`, name })),
  application: null,
})

// The events of a calendar, as a parser reads them.
function vevents(body: string) {
  return new ICAL.Component(ICAL.parse(body)).getAllSubcomponents('vevent').map((vevent) => {
    const value = (name: string) => vevent.getFirstPropertyValue(name)
    // A DTSTART or a DTEND.
    const time = (name: 'dtstart' | 'dtend') => value(name) as ICAL.Time
    return { vevent, value, time }
  })
}

const calendarName = (body: string) => new ICAL.Component(ICAL.parse(body)).getFirstPropertyValue('x-wr-calname')

// The one event of the calendar of a session with `fields`, as a parser reads it.
const onlyEvent = (fields: Partial<StoredSession>) => vevents(sessionsCalendar([session(fields)], OPTIONS))[0]

describe('sessionsCalendar', () => {
  it('is named after the sessions, and the environment outside production, and asks to be read again every 15 minutes', () => {
    const body = sessionsCalendar([], OPTIONS)
    expect(body).toContain('\r\nNAME:Parking Radio · sessions\r\nX-WR-CALNAME:Parking Radio · sessions\r\n')
    expect(body).toContain('\r\nREFRESH-INTERVAL;VALUE=DURATION:PT15M\r\nX-PUBLISHED-TTL:PT15M\r\n')
    expect(vevents(body)).toEqual([])
    expect(calendarName(sessionsCalendar([], { ...OPTIONS, environment: 'test' }))).toBe('Parking Radio (test) · sessions')
  })

  it('has each session, with a UID of its own, its times in UTC, free rather than busy, and a link to its admin page', () => {
    const body = sessionsCalendar([session({ description: 'Une soirée.', sets: [set(['Ana', 'Brume']), set(['Cyan'], 'cancelled')] })], OPTIONS)
    expect(body).toContain(
      [
        'BEGIN:VEVENT',
        'UID:session-session-1@parking.radio',
        'DTSTAMP:20261119T153000Z',
        'DTSTART:20261115T020000Z',
        'DTEND:20261115T040000Z',
        'SUMMARY:GUEST MIXES',
        'TRANSP:TRANSPARENT',
        'LOCATION:parking.radio',
        'DESCRIPTION:Ana\\nBrume\\n\\nUne soirée.',
        'URL:https://parking.radio/admin/sessions/session-1',
        'END:VEVENT',
      ].join('\r\n'),
    )
  })

  it('marks a cancelled session, then one that is not announced, before its title', () => {
    const summary = (fields: Partial<StoredSession>) => onlyEvent(fields).value('summary')
    const status = (fields: Partial<StoredSession>) => onlyEvent(fields).value('status')
    expect(summary({ status: 'cancelled' })).toBe('[CANCELLED] GUEST MIXES')
    expect(status({ status: 'cancelled' })).toBe('CANCELLED')
    expect(summary({ announced: false })).toBe('[UNANNOUNCED] GUEST MIXES')
    expect(status({ announced: false })).toBeNull()
    expect(summary({ status: 'cancelled', announced: false, name: 'SOIRÉE' })).toBe('[CANCELLED] [UNANNOUNCED] SOIRÉE')
    expect(summary({ status: 'done' })).toBe('GUEST MIXES')
  })

  it("has the description of the session's type, and OPEN JAM for a synth meetup without a lineup that isn't cancelled", () => {
    const description = (fields: Partial<StoredSession>) => onlyEvent(fields).value('description')
    expect(description({ type: 'synth-meetup' })).toMatch(/^OPEN JAM\n\n./)
    expect(description({ type: 'synth-meetup', status: 'cancelled' })).not.toMatch(/OPEN JAM/)
  })
})

const feed = (fields: Partial<FeedWithRead['feed']> = {}) => ({ id: 'feed-1', name: 'Séjours', ...fields })
const read = (fields: Partial<FeedWithRead['read']> = {}): FeedWithRead['read'] => ({ events: [], readAt: new Date('2026-11-19T15:00:00Z'), error: null, ...fields })

// An occupation, from `start` to `end`.
const occupation = (start: string, end: string, fields: { wholeDay?: boolean; title?: string } = {}) => ({
  start: new Date(start),
  end: new Date(end),
  wholeDay: false,
  title: '',
  ...fields,
})

describe('occupationsCalendar', () => {
  it('is named after the occupations, and the environment outside production, and asks to be read again every 15 minutes', () => {
    const body = occupationsCalendar([], OPTIONS)
    expect(calendarName(body)).toBe('Parking Radio · occupations')
    expect(body).toContain('\r\nREFRESH-INTERVAL;VALUE=DURATION:PT15M\r\n')
    expect(vevents(body)).toEqual([])
    expect(calendarName(occupationsCalendar([], { ...OPTIONS, environment: 'development' }))).toBe('Parking Radio (development) · occupations')
  })

  it('names each occupation by its title, then its calendar, or by its calendar alone, its times in UTC', () => {
    const events = [occupation('2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z', { title: 'Réparation' }), occupation('2026-11-21T14:00:00Z', '2026-11-21T16:00:00Z')]
    const [titled, untitled] = vevents(occupationsCalendar([{ feed: feed({ name: "Calendrier de l'équipe" }), read: read({ events }) }], OPTIONS))
    expect(titled.value('summary')).toBe("Réparation (Calendrier de l'équipe)")
    expect(untitled.value('summary')).toBe("Calendrier de l'équipe")
    expect(titled.vevent.getFirstProperty('dtstart')!.toICALString()).toBe('DTSTART:20261120T140000Z')
    expect(titled.vevent.getFirstProperty('dtend')!.toICALString()).toBe('DTEND:20261120T160000Z')
    expect(titled.value('transp')).toBe('TRANSPARENT')
    expect(untitled.value('transp')).toBe('TRANSPARENT')
    expect(titled.value('description')).toBeNull()
    expect(titled.value('url')).toBeNull()
  })

  it('keeps whole-day occupations whole-day, by their days in Québec, even when the clocks change', () => {
    // From Saturday, October 31st, to Monday, November 2nd, 2026, excluded, over the night the clocks go back.
    const events = [occupation('2026-10-31T04:00:00Z', '2026-11-02T05:00:00Z', { wholeDay: true })]
    const body = occupationsCalendar([{ feed: feed(), read: read({ events }) }], OPTIONS)
    expect(body).toContain('\r\nDTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261102\r\n')
    const [{ time }] = vevents(body)
    expect(time('dtstart').isDate).toBe(true)
    expect(time('dtstart').toString()).toBe('2026-10-31')
  })

  it('gives occupations UIDs made from what they are, the same from one read to the next, and different for those that are the same', () => {
    const uids = (events: ReturnType<typeof occupation>[], fields: Partial<FeedWithRead['feed']> = {}) =>
      vevents(occupationsCalendar([{ feed: feed(fields), read: read({ events }) }], OPTIONS)).map(({ value }) => value('uid') as string)
    const stay = occupation('2026-11-20T14:00:00Z', '2026-11-22T16:00:00Z', { title: 'Séjour' })
    const repair = occupation('2026-11-25T14:00:00Z', '2026-11-25T16:00:00Z', { title: 'Réparation' })
    const [first, second] = uids([stay, repair])
    expect(first).toMatch(/^occupation-[0-9a-f]{32}@parking\.radio$/)
    expect(second).not.toBe(first)
    // Read again, in another order, or with the feed renamed: the same.
    expect(uids([repair, stay])).toEqual([second, first])
    expect(uids([stay, repair], { name: 'Airbnb' })).toEqual([first, second])
    // Any change to the event makes it another one, and so does another feed.
    expect(uids([{ ...stay, title: 'Autre séjour' }])[0]).not.toBe(first)
    expect(uids([{ ...stay, end: new Date('2026-11-22T17:00:00Z') }])[0]).not.toBe(first)
    expect(uids([{ ...stay, wholeDay: true }])[0]).not.toBe(first)
    expect(uids([stay], { id: 'feed-2' })[0]).not.toBe(first)
    // Two stays with the same dates, on the same platform.
    const same = uids([stay, stay, stay])
    expect(new Set(same).size).toBe(3)
    expect(same[0]).toBe(first)
    expect(uids([stay, stay])).toEqual(same.slice(0, 2))
  })

  it("gives what a feed read before its last read failed, and a whole-day event on today about the feed, whose UID is the feed's", () => {
    const events = [occupation('2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z', { title: 'Réparation' })]
    const failed = { feed: feed({ id: 'feed-2', name: 'Airbnb' }), read: read({ events, error: 'The link answered with an error (404)' }) }
    const never = { feed: feed({ id: 'feed-3', name: 'Équipe' }), read: read({ readAt: null, error: "The link's server can't be reached" }) }
    // NOW is November 19th in Québec, at 10:30.
    const [occupationOf, failedEvent, neverEvent] = vevents(occupationsCalendar([{ feed: feed(), read: read() }, failed, never], OPTIONS))
    expect(occupationOf.value('summary')).toBe('Réparation (Airbnb)')

    expect(failedEvent.value('uid')).toBe('feed-feed-2@parking.radio')
    expect(failedEvent.value('summary')).toBe('[REFRESH ERROR] Airbnb')
    expect(failedEvent.time('dtstart').toString()).toBe('2026-11-19')
    expect(failedEvent.time('dtend').toString()).toBe('2026-11-20')
    expect(failedEvent.value('description')).toBe(
      'The last read of this calendar feed failed. The link answered with an error (404).\nIt was last read successfully on 2026-11-19 10:00, Québec time.',
    )
    expect(failedEvent.value('transp')).toBe('TRANSPARENT')
    expect(failedEvent.value('url')).toBe('https://parking.radio/admin/calendrier')

    expect(neverEvent.value('uid')).toBe('feed-feed-3@parking.radio')
    expect(neverEvent.value('summary')).toBe('[REFRESH ERROR] Équipe')
    expect(neverEvent.value('description')).toBe(
      "The last read of this calendar feed failed. The link's server can't be reached.\nIt hasn't been read successfully since the server started.",
    )
  })

  it("puts the event about a feed whose last read failed on today in Québec, even when it's already tomorrow in UTC", () => {
    const failed = { feed: feed(), read: read({ error: 'Failed' }) }
    const [event] = vevents(occupationsCalendar([failed], { ...OPTIONS, now: new Date('2026-11-20T03:00:00Z') }))
    expect(event.time('dtstart').toString()).toBe('2026-11-19')
  })
})
