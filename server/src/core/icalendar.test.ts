import { describe, expect, it } from 'vitest'
import { calendar, contentLine, date, dateTime, text } from './icalendar.js'

// Writing iCalendar. The calendars themselves are tested with their routes, e.g. events/calendar.test.ts, which read them
// back with a parser, ical.js, as calendar apps would.

describe('calendar', () => {
  it('has its name, escaped, its refresh interval, and its components, in lines that end in CRLF', () => {
    const body = calendar({ name: 'Parking Radio, test', refreshInterval: 'PT15M', components: [['BEGIN:VEVENT', 'UID:a', 'END:VEVENT']] })
    expect(body).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Parking Radio//Calendrier//FR',
        'NAME:Parking Radio\\, test',
        'X-WR-CALNAME:Parking Radio\\, test',
        'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
        'X-PUBLISHED-TTL:PT15M',
        'BEGIN:VEVENT',
        'UID:a',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    )
  })
})

describe('dateTime', () => {
  it('is in UTC, to the second', () => {
    expect(dateTime('2026-11-14T21:00:30.250-05:00')).toBe('20261115T020030Z')
    expect(dateTime(new Date('2026-07-01T12:00:00Z'))).toBe('20260701T120000Z')
  })
})

describe('date', () => {
  it('is the day without its dashes', () => {
    expect(date('2026-11-15')).toBe('20261115')
  })
})

describe('text', () => {
  it('escapes backslashes, then semicolons, commas and line breaks', () => {
    expect(text('a\\;b,c\nd\r\ne\rf')).toBe('a\\\\\\;b\\,c\\nd\\ne\\nf')
  })

  it('drops control characters other than tabs', () => {
    expect(text('a\u0000b\u0008c\td\u000be\u001ff\u007fg\u0085h')).toBe('abc\tdefgh')
  })
})

describe('contentLine', () => {
  it('leaves a line of 75 octets as it is', () => {
    const line = 'A'.repeat(75)
    expect(contentLine(line)).toBe(line)
  })

  it('folds a line of 76 octets, continuing it on the next line after a space', () => {
    expect(contentLine('A'.repeat(76))).toBe(`${'A'.repeat(75)}\r\n A`)
  })

  it('continues on lines of 74 octets after their space', () => {
    expect(contentLine('A'.repeat(75 + 74 + 1))).toBe(`${'A'.repeat(75)}\r\n ${'A'.repeat(74)}\r\n A`)
  })

  it('never splits a character', () => {
    // 74 octets, then a character of 2 octets, which would end at 76.
    expect(contentLine(`${'A'.repeat(74)}éB`)).toBe(`${'A'.repeat(74)}\r\n éB`)
    // 73 octets, then a character of 4 octets.
    expect(contentLine(`${'A'.repeat(73)}🎛B`)).toBe(`${'A'.repeat(73)}\r\n 🎛B`)
    // 71 octets, then a character of 4 octets, which ends at 75.
    expect(contentLine(`${'A'.repeat(71)}🎛B`)).toBe(`${'A'.repeat(71)}🎛\r\n B`)
  })
})
