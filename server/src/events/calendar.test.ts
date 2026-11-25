import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import ICAL from 'ical.js'
import { calendar } from './calendar.js'
import type { Event } from './routes.js'

// The calendar feed, as iCalendar (see `GET /calendar.ics` in docs/design/server/events.md). An iCalendar parser, ical.js,
// reads it back, as calendar apps would.

const SITE = 'https://parking.radio'
const NOW = new Date('2026-11-19T15:30:00Z')

function event(fields: Partial<Event> = {}): Event {
  return {
    id: 'session-1',
    title: 'GUEST MIXES',
    type: 'guest-mixes',
    start: '2026-11-15T02:00:00.000Z',
    end: '2026-11-15T04:00:00.000Z',
    cancelled: false,
    description: 'Une soirée.',
    flyer: null,
    raEvent: null,
    takeover: null,
    sets: [],
    lineup: [],
    ...fields,
  }
}

const feed = (events: Event[]) => calendar(events, { siteOrigin: SITE, now: NOW })

// The feed, as a parser reads it.
const parsed = (events: Event[]) => new ICAL.Component(ICAL.parse(feed(events)))

// The one event of a feed of `fields`, as a parser reads it.
function parsedEvent(fields: Partial<Event> = {}) {
  const [vevent] = parsed([event(fields)]).getAllSubcomponents('vevent')
  const value = (name: string) => vevent.getFirstPropertyValue(name)
  return { vevent, value }
}

const octets = (line: string) => Buffer.byteLength(line)

describe('calendar', () => {
  it('is a calendar named Parking Radio, which asks to be read again every hour, even without events', () => {
    const body = feed([])
    expect(body).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Parking Radio//Calendrier//FR',
        'NAME:Parking Radio',
        'X-WR-CALNAME:Parking Radio',
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    )
    const vcalendar = parsed([])
    expect(vcalendar.name).toBe('vcalendar')
    expect(vcalendar.getAllSubcomponents('vevent')).toEqual([])
    expect(vcalendar.getFirstPropertyValue('x-wr-calname')).toBe('Parking Radio')
  })

  it('has each event, with its fields, its times in UTC', () => {
    const lineup = [
      { id: 'artist-1', name: 'Ana' },
      { id: 'artist-2', name: 'Brume' },
    ]
    const body = feed([event({ lineup, raEvent: 'https://ra.co/events/6683745' })])
    expect(body).toContain(
      [
        'BEGIN:VEVENT',
        'UID:session-1@parking.radio',
        'DTSTAMP:20261119T153000Z',
        'DTSTART:20261115T020000Z',
        'DTEND:20261115T040000Z',
        'SUMMARY:GUEST MIXES',
        'LOCATION:parking.radio',
        'DESCRIPTION:Ana\\nBrume\\n\\nUne soirée.',
        'URL:https://ra.co/events/6683745',
        'END:VEVENT',
      ].join('\r\n'),
    )
    expect(body).not.toContain('STATUS')
  })

  it('gives the times of a summer event in UTC too', () => {
    // 21:00 to 23:00, at -04:00.
    const { value } = parsedEvent({ start: '2026-07-01T21:00:00-04:00', end: '2026-07-01T23:00:00-04:00' })
    expect(String(value('dtstart'))).toBe('2026-07-02T01:00:00Z')
    expect(String(value('dtend'))).toBe('2026-07-02T03:00:00Z')
  })

  it('marks a cancelled event as cancelled, which stays in it', () => {
    const { value } = parsedEvent({ cancelled: true })
    expect(value('summary')).toBe('[CANCELLED] GUEST MIXES')
    expect(value('status')).toBe('CANCELLED')
  })

  it("links an event without an event on RA to the site's Programmation page", () => {
    expect(parsedEvent().value('url')).toBe('https://parking.radio/programmation')
  })

  it('has OPEN JAM as the lineup of a synth meetup without one, unless it is cancelled', () => {
    const meetup = { type: 'synth-meetup' as const, description: 'SYNTH MEETUPS' }
    expect(parsedEvent(meetup).value('description')).toBe('OPEN JAM\n\nSYNTH MEETUPS')
    expect(parsedEvent({ ...meetup, cancelled: true }).value('description')).toBe('SYNTH MEETUPS')
    expect(parsedEvent({ ...meetup, lineup: [{ id: 'artist-1', name: 'Ana' }] }).value('description')).toBe('Ana\n\nSYNTH MEETUPS')
  })

  it('has only the lineup, or only the description, when the other is empty, or no description without either', () => {
    expect(parsedEvent({ lineup: [{ id: 'artist-1', name: 'Ana' }], description: '' }).value('description')).toBe('Ana')
    expect(parsedEvent({ lineup: [] }).value('description')).toBe('Une soirée.')
    expect(parsedEvent({ description: '' }).vevent.hasProperty('description')).toBe(false)
  })

  it('escapes text, and folds long lines, which a parser reads back as they were', () => {
    const title = 'NUIT; BASSE, \\ AVEC « ÉMOJIS » 🎛️ '.repeat(5)
    const description = 'Ligne 1\r\nLigne 2\rLigne 3\nFin\u0000\u0007\tavec une tabulation'
    const { value } = parsedEvent({ title, description })
    expect(value('summary')).toBe(title)
    expect(value('description')).toBe('Ligne 1\nLigne 2\nLigne 3\nFin\tavec une tabulation')
  })

  it('has lines of at most 75 octets, ending in CRLF', () => {
    const long = 'é🎛️a'.repeat(100)
    const body = feed([event({ title: long, description: long, lineup: [{ id: 'artist-1', name: long }] })])
    expect(body.endsWith('\r\n')).toBe(true)
    const lines = body.slice(0, -2).split('\r\n')
    for (const line of lines) expect(octets(line)).toBeLessThanOrEqual(75)
    expect(body.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })
})

describe('calendar, with any text', () => {
  // Text with what has to be escaped, line breaks, control characters, tabs, and characters of every size in UTF-8, among
  // any others.
  const special = fc.constantFrom('\\', ';', ',', '\r', '\n', '\r\n', '\t', '\u0000', '\u0007', '\u001f', '\u007f', '\u0085', 'é', '€', '🎛', ' ')
  const anyText = fc.string({ unit: fc.oneof(special, fc.string({ unit: 'binary', minLength: 1, maxLength: 1 })), minLength: 1, maxLength: 200 })
  // What a value is read back as: its line breaks as LF, without control characters other than tabs.
  const readBack = (value: string) => value.replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\t\n]/gu, '')

  it('reads back the title, the lineup and the description as they were, in lines of at most 75 octets', () => {
    fc.assert(
      fc.property(anyText, anyText, anyText, (title, name, description) => {
        const body = feed([event({ title, lineup: [{ id: 'artist-1', name }], description })])
        for (const line of body.slice(0, -2).split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75)
        const { value } = parsedEvent({ title, lineup: [{ id: 'artist-1', name }], description })
        expect(value('summary')).toBe(readBack(title))
        expect(value('description')).toBe(readBack(`${name}\n\n${description}`))
      }),
    )
  })
})
