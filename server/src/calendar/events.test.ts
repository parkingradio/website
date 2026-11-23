import { describe, expect, it } from 'vitest'
import { calendarEvents, keptTime, MAX_OCCURRENCES_PER_EVENT, MAX_OCCURRENCES_PER_READ, shortTitle, TITLE_MAX_LENGTH } from './events.js'
import { FeedReadError } from './fetch.js'

// The events a read keeps of a feed (see "Events" in docs/design/server/calendar.md), from feeds shaped like Google
// Calendar's.

const WINDOW = { from: new Date('2025-11-22T12:00:00Z'), to: new Date('2028-11-22T12:00:00Z') }

// Québec's time zone, as Google defines it in its feeds.
const TORONTO = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Toronto',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
]

// The same rules, under the name Outlook gives them, which isn't an IANA time zone.
const EASTERN = TORONTO.map((line) => (line === 'TZID:America/Toronto' ? 'TZID:Eastern Standard Time' : line))

let uids = 0

// A VEVENT with these lines, and a UID unless they have one.
function vevent(...lines: string[]): string[] {
  const uid = lines.some((line) => line.startsWith('UID:')) ? [] : [`UID:event-${++uids}@google.com`]
  return ['BEGIN:VEVENT', ...uid, 'DTSTAMP:20261101T000000Z', ...lines, 'END:VEVENT']
}

function feed(...parts: string[][]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', ...parts.flat(), 'END:VCALENDAR', ''].join('\r\n')
}

function read(text: string, privateTitles = false, window = WINDOW) {
  return calendarEvents(text, privateTitles, window)
}

// The events of a feed, as ISO strings in UTC.
function intervals(text: string, privateTitles = false, window = WINDOW) {
  return read(text, privateTitles, window).events.map(({ start, end }) => [start.toISOString(), end.toISOString()])
}

const one = (...lines: string[]) => intervals(feed(TORONTO, vevent(...lines)))

function failure(text: string): FeedReadError {
  try {
    read(text)
  } catch (error) {
    if (error instanceof FeedReadError) return error
    throw error
  }
  throw new Error('The read succeeded')
}

describe('calendarEvents', () => {
  describe('timed events', () => {
    it('keep their times in UTC', () => {
      expect(one('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z')).toEqual([['2026-11-24T23:00:00.000Z', '2026-11-25T01:00:00.000Z']])
    })

    it('read their times in their IANA time zone, whether the feed defines it or not', () => {
      const event = ['DTSTART;TZID=America/Toronto:20261124T190000', 'DTEND;TZID=America/Toronto:20261124T210000']
      expect(intervals(feed(TORONTO, vevent(...event)))).toEqual([['2026-11-25T00:00:00.000Z', '2026-11-25T02:00:00.000Z']])
      expect(intervals(feed(vevent(...event)))).toEqual([['2026-11-25T00:00:00.000Z', '2026-11-25T02:00:00.000Z']])
      expect(intervals(feed(vevent('DTSTART;TZID=Europe/Paris:20261124T190000', 'DTEND;TZID=Europe/Paris:20261124T210000')))).toEqual([
        ['2026-11-24T18:00:00.000Z', '2026-11-24T20:00:00.000Z'],
      ])
    })

    it("read them with the feed's definition of a time zone whose name isn't IANA's", () => {
      const event = vevent('DTSTART;TZID=Eastern Standard Time:20260715T190000', 'DTEND;TZID=Eastern Standard Time:20260715T200000')
      expect(intervals(feed(EASTERN, event))).toEqual([['2026-07-15T23:00:00.000Z', '2026-07-16T00:00:00.000Z']])
    })

    it('read them in Québec time without a time zone, or with one that is neither known nor defined', () => {
      expect(one('DTSTART:20260715T190000', 'DTEND:20260715T200000')).toEqual([['2026-07-15T23:00:00.000Z', '2026-07-16T00:00:00.000Z']])
      expect(one('DTSTART;TZID=Mars/Olympus_Mons:20260715T190000', 'DTEND;TZID=Mars/Olympus_Mons:20260715T200000')).toEqual([
        ['2026-07-15T23:00:00.000Z', '2026-07-16T00:00:00.000Z'],
      ])
    })

    it('take the first of the two instants of a time the clocks show twice, and move one they skip forward', () => {
      for (const zone of [TORONTO, []]) {
        const twice = vevent('DTSTART;TZID=America/Toronto:20261101T013000', 'DTEND;TZID=America/Toronto:20261101T040000')
        const skipped = vevent('DTSTART;TZID=America/Toronto:20260308T023000', 'DTEND;TZID=America/Toronto:20260308T040000')
        expect(intervals(feed(zone, skipped, twice))).toEqual([
          ['2026-03-08T07:30:00.000Z', '2026-03-08T08:00:00.000Z'],
          ['2026-11-01T05:30:00.000Z', '2026-11-01T09:00:00.000Z'],
        ])
      }
    })

    it('last for their DURATION without a DTEND', () => {
      expect(one('DTSTART;TZID=America/Toronto:20261124T190000', 'DURATION:PT2H30M')).toEqual([['2026-11-25T00:00:00.000Z', '2026-11-25T02:30:00.000Z']])
    })

    it("count their DURATION's days in their local time, and its hours as they pass, across a change of daylight saving time", () => {
      const start = 'DTSTART;TZID=America/Toronto:20261031T120000'
      expect(one(start, 'DURATION:P1D')).toEqual([['2026-10-31T16:00:00.000Z', '2026-11-01T17:00:00.000Z']])
      expect(one(start, 'DURATION:P1DT2H')).toEqual([['2026-10-31T16:00:00.000Z', '2026-11-01T19:00:00.000Z']])
      expect(one(start, 'DURATION:PT24H')).toEqual([['2026-10-31T16:00:00.000Z', '2026-11-01T16:00:00.000Z']])
      const weekly = vevent('DTSTART;TZID=America/Toronto:20261024T120000', 'DURATION:P1W', 'RRULE:FREQ=WEEKLY;COUNT=2')
      expect(intervals(feed(TORONTO, weekly))).toEqual([
        ['2026-10-24T16:00:00.000Z', '2026-10-31T16:00:00.000Z'],
        ['2026-10-31T16:00:00.000Z', '2026-11-07T17:00:00.000Z'],
      ])
    })

    it('end at their DTEND across a change of daylight saving time, e.g. a stay over a weekend', () => {
      const stay = ['DTSTART;TZID=America/Toronto:20261031T160000', 'DTEND;TZID=America/Toronto:20261102T110000', 'SUMMARY:Reserved']
      for (const zone of [TORONTO, []]) {
        expect(intervals(feed(zone, vevent(...stay)), true)).toEqual([['2026-10-31T20:00:00.000Z', '2026-11-02T16:00:00.000Z']])
      }
    })
  })

  describe('whole-day events', () => {
    it('take their whole days in Québec time, including a day of 25 hours', () => {
      expect(one('DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102')).toEqual([['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']])
      expect(one('DTSTART;VALUE=DATE:20261123', 'DTEND;VALUE=DATE:20261126')).toEqual([['2026-11-23T05:00:00.000Z', '2026-11-26T05:00:00.000Z']])
    })

    it('take one day without a DTEND, or their DURATION', () => {
      expect(one('DTSTART;VALUE=DATE:20261123')).toEqual([['2026-11-23T05:00:00.000Z', '2026-11-24T05:00:00.000Z']])
      expect(one('DTSTART;VALUE=DATE:20261123', 'DURATION:P2D')).toEqual([['2026-11-23T05:00:00.000Z', '2026-11-25T05:00:00.000Z']])
    })

    it('take the studio even when they say they are free', () => {
      expect(one('DTSTART;VALUE=DATE:20261123', 'TRANSP:TRANSPARENT')).toHaveLength(1)
    })

    it('are whole-day, unlike timed events, even those from 00:00 to 00:00, and so are their occurrences', () => {
      const wholeDays = (...parts: string[][]) => read(feed(TORONTO, ...parts)).events.map(({ start, wholeDay }) => [start.toISOString(), wholeDay])
      expect(wholeDays(vevent('DTSTART;VALUE=DATE:20261123'))).toEqual([['2026-11-23T05:00:00.000Z', true]])
      expect(wholeDays(vevent('DTSTART;TZID=America/Toronto:20261123T000000', 'DTEND;TZID=America/Toronto:20261124T000000'))).toEqual([['2026-11-23T05:00:00.000Z', false]])
      expect(wholeDays(vevent('DTSTART;VALUE=DATE:20261123', 'RRULE:FREQ=DAILY;COUNT=2'))).toEqual([
        ['2026-11-23T05:00:00.000Z', true],
        ['2026-11-24T05:00:00.000Z', true],
      ])
    })

    it('follow their own DTSTART when an occurrence is changed on its own', () => {
      const wholeDays = (...parts: string[][]) => read(feed(TORONTO, ...parts)).events.map(({ start, end, wholeDay }) => [start.toISOString(), end.toISOString(), wholeDay])
      // A whole-day occurrence that's made timed.
      expect(
        wholeDays(
          vevent('UID:days', 'DTSTART;VALUE=DATE:20261123', 'RRULE:FREQ=DAILY;COUNT=2'),
          vevent('UID:days', 'RECURRENCE-ID;VALUE=DATE:20261124', 'DTSTART;TZID=America/Toronto:20261124T100000', 'DTEND;TZID=America/Toronto:20261124T120000'),
        ),
      ).toEqual([
        ['2026-11-23T05:00:00.000Z', '2026-11-24T05:00:00.000Z', true],
        ['2026-11-24T15:00:00.000Z', '2026-11-24T17:00:00.000Z', false],
      ])
      // A timed occurrence that's made whole-day.
      expect(
        wholeDays(
          vevent('UID:times', 'DTSTART;TZID=America/Toronto:20261123T100000', 'DTEND;TZID=America/Toronto:20261123T120000', 'RRULE:FREQ=DAILY;COUNT=2'),
          vevent('UID:times', 'RECURRENCE-ID;TZID=America/Toronto:20261124T100000', 'DTSTART;VALUE=DATE:20261124', 'DTEND;VALUE=DATE:20261125'),
        ),
      ).toEqual([
        ['2026-11-23T15:00:00.000Z', '2026-11-23T17:00:00.000Z', false],
        ['2026-11-24T05:00:00.000Z', '2026-11-25T05:00:00.000Z', true],
      ])
    })
  })

  describe('recurring events', () => {
    it('take each occurrence at the same local time on both sides of a change of daylight saving time', () => {
      for (const zone of [TORONTO, []]) {
        const weekly = vevent('DTSTART;TZID=America/Toronto:20261027T190000', 'DTEND;TZID=America/Toronto:20261027T200000', 'RRULE:FREQ=WEEKLY;COUNT=3')
        expect(intervals(feed(zone, weekly))).toEqual([
          ['2026-10-27T23:00:00.000Z', '2026-10-28T00:00:00.000Z'],
          ['2026-11-04T00:00:00.000Z', '2026-11-04T01:00:00.000Z'],
          ['2026-11-11T00:00:00.000Z', '2026-11-11T01:00:00.000Z'],
        ])
      }
      const spring = vevent('DTSTART;TZID=America/Toronto:20270310T190000', 'DTEND;TZID=America/Toronto:20270310T200000', 'RRULE:FREQ=WEEKLY;UNTIL=20270318T000000Z')
      expect(intervals(feed(TORONTO, spring))).toEqual([
        ['2027-03-11T00:00:00.000Z', '2027-03-11T01:00:00.000Z'],
        ['2027-03-17T23:00:00.000Z', '2027-03-18T00:00:00.000Z'],
      ])
    })

    it('leave out the occurrences that EXDATE excludes, and add those of RDATE', () => {
      const event = vevent(
        'DTSTART;TZID=America/Toronto:20261201T100000',
        'DTEND;TZID=America/Toronto:20261201T110000',
        'RRULE:FREQ=DAILY;COUNT=3',
        'EXDATE;TZID=America/Toronto:20261202T100000',
        'RDATE;TZID=America/Toronto:20261210T100000',
      )
      expect(intervals(feed(TORONTO, event)).map(([start]) => start)).toEqual(['2026-12-01T15:00:00.000Z', '2026-12-03T15:00:00.000Z', '2026-12-10T15:00:00.000Z'])
    })

    it('leave out the occurrences of an RDATE that is a period, but not the others', () => {
      const event = vevent('DTSTART:20261201T150000Z', 'DTEND:20261201T160000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'RDATE;VALUE=PERIOD:20261210T150000Z/20261210T170000Z', 'RDATE:20261212T150000Z')
      expect(intervals(feed(event)).map(([start]) => start)).toEqual(['2026-12-01T15:00:00.000Z', '2026-12-02T15:00:00.000Z', '2026-12-12T15:00:00.000Z'])
    })

    // RFC 5545 requires a feed to define the time zones it names, as Google's do. When it doesn't, the library the server
    // reads feeds with compares their local times with the UTC ones of an EXDATE or a RECURRENCE-ID as if they were UTC, so
    // that these don't name the occurrence they should (see "Events" in docs/design/server/calendar.md). This is what it
    // does then, which isn't the design's: it's only pinned here so that a change is seen.
    it("can miss the occurrences that an EXDATE or a RECURRENCE-ID names in UTC, when the feed doesn't define their time zone", () => {
      const uid = 'UID:undefined-zone@example.com'
      const series = ['DTSTART;TZID=America/Toronto:20261201T190000', 'DTEND;TZID=America/Toronto:20261201T200000', 'RRULE:FREQ=DAILY;COUNT=3']
      const text = (zone: string[]) =>
        feed(
          zone,
          vevent(uid, ...series, 'EXDATE:20261203T000000Z'),
          vevent(uid, 'RECURRENCE-ID:20261204T000000Z', 'DTSTART;TZID=America/Toronto:20261203T210000', 'DTEND;TZID=America/Toronto:20261203T220000'),
        )
      expect(intervals(text(TORONTO)).map(([start]) => start)).toEqual(['2026-12-02T00:00:00.000Z', '2026-12-04T02:00:00.000Z'])
      expect(intervals(text([])).map(([start]) => start)).toEqual(['2026-12-02T00:00:00.000Z', '2026-12-03T00:00:00.000Z', '2026-12-04T00:00:00.000Z'])
    })

    it('repeat whole days', () => {
      const event = vevent('DTSTART;VALUE=DATE:20261228', 'DTEND;VALUE=DATE:20261229', 'RRULE:FREQ=YEARLY;COUNT=2')
      expect(intervals(feed(event))).toEqual([
        ['2026-12-28T05:00:00.000Z', '2026-12-29T05:00:00.000Z'],
        ['2027-12-28T05:00:00.000Z', '2027-12-29T05:00:00.000Z'],
      ])
    })

    it('take the times of the occurrences changed on their own, and leave out those cancelled', () => {
      const uid = 'UID:weekly@google.com'
      const text = feed(
        TORONTO,
        vevent(uid, 'DTSTART;TZID=America/Toronto:20261201T190000', 'DTEND;TZID=America/Toronto:20261201T200000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Atelier'),
        vevent(uid, 'RECURRENCE-ID;TZID=America/Toronto:20261208T190000', 'DTSTART;TZID=America/Toronto:20261209T180000', 'DTEND;TZID=America/Toronto:20261209T183000', 'SUMMARY:Atelier déplacé'),
        vevent(uid, 'RECURRENCE-ID;TZID=America/Toronto:20261215T190000', 'DTSTART;TZID=America/Toronto:20261215T190000', 'DTEND;TZID=America/Toronto:20261215T200000', 'STATUS:CANCELLED'),
      )
      expect(read(text).events).toEqual([
        { start: new Date('2026-12-02T00:00:00Z'), end: new Date('2026-12-02T01:00:00Z'), wholeDay: false, title: 'Atelier' },
        { start: new Date('2026-12-09T23:00:00Z'), end: new Date('2026-12-09T23:30:00Z'), wholeDay: false, title: 'Atelier déplacé' },
      ])
    })

    it("only change the occurrences of their own UID", () => {
      const text = feed(
        TORONTO,
        vevent('UID:a', 'DTSTART;TZID=America/Toronto:20261201T190000', 'DTEND;TZID=America/Toronto:20261201T200000', 'RRULE:FREQ=DAILY;COUNT=2', 'SUMMARY:A'),
        vevent('UID:b', 'DTSTART;TZID=America/Toronto:20261201T190000', 'DTEND;TZID=America/Toronto:20261201T200000', 'RRULE:FREQ=DAILY;COUNT=2', 'SUMMARY:B'),
        vevent('UID:a', 'RECURRENCE-ID;TZID=America/Toronto:20261202T190000', 'DTSTART;TZID=America/Toronto:20261202T210000', 'DTEND;TZID=America/Toronto:20261202T220000', 'SUMMARY:A moved'),
      )
      expect(read(text).events.map(({ start, title }) => [start.toISOString(), title])).toEqual([
        ['2026-12-02T00:00:00.000Z', 'A'],
        ['2026-12-02T00:00:00.000Z', 'B'],
        ['2026-12-03T00:00:00.000Z', 'B'],
        ['2026-12-03T02:00:00.000Z', 'A moved'],
      ])
    })

    it('keep an occurrence whose recurring event is not in the feed as an event of its own', () => {
      const invited = vevent('UID:someone-else@google.com', 'RECURRENCE-ID;TZID=America/Toronto:20261201T190000', 'DTSTART;TZID=America/Toronto:20261201T190000', 'DTEND;TZID=America/Toronto:20261201T200000')
      expect(intervals(feed(TORONTO, invited))).toEqual([['2026-12-02T00:00:00.000Z', '2026-12-02T01:00:00.000Z']])
    })
  })

  describe('the time a read keeps', () => {
    it('is from a year before the read to two years after it', () => {
      const text = feed(
        vevent('DTSTART:20251122T110000Z', 'DTEND:20251122T120000Z'),
        vevent('DTSTART:20251122T113000Z', 'DTEND:20251122T123000Z'),
        vevent('DTSTART:20281122T113000Z', 'DTEND:20281122T123000Z'),
        vevent('DTSTART:20281122T120000Z', 'DTEND:20281122T130000Z'),
      )
      expect(intervals(text).map(([start]) => start)).toEqual(['2025-11-22T11:30:00.000Z', '2028-11-22T11:30:00.000Z'])
    })

    it('has the occurrences of an event that recurs forever', () => {
      const daily = vevent('DTSTART;TZID=America/Toronto:20100101T190000', 'DTEND;TZID=America/Toronto:20100101T200000', 'RRULE:FREQ=DAILY')
      const events = intervals(feed(TORONTO, daily))
      // From November 22, 2025 to November 21, 2028, at 19:00 in Québec time.
      expect(events).toHaveLength(365 + 365 + 366)
      expect(events[0]).toEqual(['2025-11-23T00:00:00.000Z', '2025-11-23T01:00:00.000Z'])
      expect(events.at(-1)).toEqual(['2028-11-22T00:00:00.000Z', '2028-11-22T01:00:00.000Z'])
    })
  })

  describe('events that are left out', () => {
    it("are those cancelled, those that take no time, and those that can't be read, without the others", () => {
      const kept = vevent('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z')
      const { events, skipped } = read(
        feed(
          vevent('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z', 'STATUS:CANCELLED'),
          vevent('DTSTART:20261124T230000Z'),
          vevent('DTSTART:20261124T230000Z', 'DTEND:20261124T220000Z'),
          vevent('DTEND:20261125T010000Z'),
          vevent('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'EXDATE:not-a-date'),
          kept,
        ),
      )
      expect(events.map(({ start }) => start.toISOString())).toEqual(['2026-11-24T23:00:00.000Z'])
      expect(skipped).toBe(2)
    })

    it(`are those with more than ${MAX_OCCURRENCES_PER_EVENT} occurrences until the end of the time kept`, () => {
      const { events, skipped } = read(
        feed(vevent('DTSTART:20261124T230000Z', 'DTEND:20261124T230100Z', 'RRULE:FREQ=MINUTELY'), vevent('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z')),
      )
      expect(events).toHaveLength(1)
      expect(skipped).toBe(1)
    })
  })

  it(`fails the read when it goes through more than ${MAX_OCCURRENCES_PER_READ} events and occurrences`, () => {
    const many = Array.from({ length: Math.ceil(MAX_OCCURRENCES_PER_READ / MAX_OCCURRENCES_PER_EVENT) + 1 }, () => vevent('DTSTART:20261124T230000Z', 'DTEND:20261124T230100Z', 'RRULE:FREQ=MINUTELY'))
    const error = failure(feed(...many))
    expect(error).toMatchObject({ status: 400, message: `The link can't be read: it has more than ${MAX_OCCURRENCES_PER_READ} events and occurrences` })
  })

  it(`keeps titles on one line, of at most ${TITLE_MAX_LENGTH} characters, cut after a whole word`, () => {
    expect(shortTitle('  Réparation\n du\t toit ')).toBe('Réparation du toit')
    expect(shortTitle('mot '.repeat(49) + 'mots')).toBe('mot '.repeat(49) + 'mots')
    expect(shortTitle('mot '.repeat(60))).toBe(`${'mot '.repeat(49)}mot…`)
    expect(shortTitle('mot '.repeat(48) + 'mot motlong')).toBe(`${'mot '.repeat(48)}mot…`)
    // Within a word when none fits, but not within a character.
    expect(shortTitle('x'.repeat(300))).toBe(`${'x'.repeat(199)}…`)
    expect(shortTitle(`${'x'.repeat(198)}😀y`)).toBe(`${'x'.repeat(198)}…`)
    const text = feed(vevent('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z', `SUMMARY:${'x'.repeat(300)}`))
    expect(read(text).events[0].title).toBe(`${'x'.repeat(199)}…`)
  })

  it('keeps the titles, unless they are private', () => {
    const text = feed(vevent('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z', 'SUMMARY:  Réparation du toit ', 'DESCRIPTION:Guest: Jane Doe', 'LOCATION:Studio'))
    expect(read(text).events[0].title).toBe('Réparation du toit')
    expect(read(text, true).events[0]).toEqual({ start: new Date('2026-11-24T23:00:00Z'), end: new Date('2026-11-25T01:00:00Z'), wholeDay: false, title: null })
    expect(read(feed(vevent('DTSTART:20261124T230000Z', 'DTEND:20261125T010000Z'))).events[0].title).toBe('')
  })

  it("fails the read when the text isn't a valid iCalendar calendar, without quoting it", () => {
    for (const text of ['<!doctype html><html><body>https://calendar.google.com/secret</body></html>', '{"ok":true}', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR']) {
      expect(failure(text)).toMatchObject({ status: 400, message: "The link can't be read: its answer isn't valid iCalendar" })
    }
    for (const text of ['', 'BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD\r\n']) {
      expect(failure(text)).toMatchObject({ status: 400, message: "The link can't be read: its answer isn't an iCalendar calendar" })
    }
    // ical.js refuses it as it parses the feed, rather than as it reads the event.
    expect(failure(feed(vevent('DTSTART:20261124T230000Z', 'RRULE:FREQ=NEVER')))).toMatchObject({ status: 400 })
  })

  // ical.js looks a time zone up among all of a calendar's components, and only remembers those it finds, so that a
  // TZID without a VTIMEZONE once made a read go through every event for each of its times.
  it("reads a calendar of nearly 10 MB quickly, even when it doesn't define its time zone", () => {
    const events = Array.from({ length: 28_000 }, (_, index) => {
      const day = `2026${String((index % 12) + 1).padStart(2, '0')}15`
      return vevent(`DTSTART;TZID=America/Toronto:${day}T120000`, `DTEND;TZID=America/Toronto:${day}T130000`, 'SUMMARY:An event', `DESCRIPTION:${'x'.repeat(150)}`)
    })
    const text = feed(...events)
    expect(text.length).toBeGreaterThan(9_500_000)
    const started = performance.now()
    expect(read(text).events).toHaveLength(28_000)
    expect(performance.now() - started).toBeLessThan(5000)
  }, 20_000)

  it('keeps from a year before a read to two years after it', () => {
    expect(keptTime(new Date('2026-11-22T12:00:00Z'))).toEqual(WINDOW)
    expect(keptTime(new Date('2028-02-29T12:00:00Z'))).toEqual({ from: new Date('2027-03-01T12:00:00Z'), to: new Date('2030-03-01T12:00:00Z') })
  })
})
