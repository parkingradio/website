// Writing calendars in iCalendar (RFC 5545), for the calendars that calendar apps subscribe to: the public events' feed
// (see `GET /calendar.ics` in docs/design/server/events.md) and admins' calendars (see
// docs/design/server/admin-calendars.md).

const PRODUCT = '-//Parking Radio//Calendrier//FR'
// Lines are at most this many octets long, without their CRLF.
const MAX_LINE_OCTETS = 75

// A TEXT value: backslashes, semicolons, commas and line breaks escaped, and the control characters other than tabs, which
// it can't hold, dropped.
export function text(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\P{Cc}\t\n]/gu, '')
    .replace(/[\\;,]/g, (character) => `\\${character}`)
    .replace(/\n/g, '\\n')
}

// A content line, folded into lines of at most MAX_LINE_OCTETS octets, continued on the next with a space, which counts
// towards them. Lines are only folded between characters, never inside one's UTF-8 octets.
export function contentLine(line: string): string {
  if (Buffer.byteLength(line) <= MAX_LINE_OCTETS) return line
  const lines: string[] = []
  let current = ''
  let octets = 0
  for (const character of line) {
    const size = Buffer.byteLength(character)
    if (octets + size > MAX_LINE_OCTETS) {
      lines.push(current)
      current = ' '
      octets = 1
    }
    current += character
    octets += size
  }
  lines.push(current)
  return lines.join('\r\n')
}

// A DATE-TIME in UTC, e.g. 20261115T020000Z.
export function dateTime(instant: string | Date): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
}

// A DATE, from a day, YYYY-MM-DD, e.g. 20261115.
export function date(day: string): string {
  return day.replaceAll('-', '')
}

type Calendar = {
  // Its name, which calendar apps show.
  name: string
  // How often subscribers are asked to read it again, as a DURATION, e.g. PT1H, for the apps that take it (RFC 7986 and
  // Outlook's own).
  refreshInterval: string
  // Its components, each as its content lines, unfolded, e.g. ['BEGIN:VEVENT', …, 'END:VEVENT'].
  components: string[][]
}

// A calendar, its lines folded and ending in CRLF.
export function calendar({ name, refreshInterval, components }: Calendar): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT}`,
    `NAME:${text(name)}`,
    `X-WR-CALNAME:${text(name)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${refreshInterval}`,
    `X-PUBLISHED-TTL:${refreshInterval}`,
    ...components.flat(),
    'END:VCALENDAR',
  ]
  return lines.map((line) => `${contentLine(line)}\r\n`).join('')
}
