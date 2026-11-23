import { describe, expect, it } from 'vitest'
import { FeedName, LINK_MAX_LENGTH, Link } from './fields.js'

// The fields of a calendar feed that's added (see `POST /api/admin/calendar/feeds` in docs/design/server/calendar.md).

const error = (sent: unknown) => Link.safeParse(sent).error?.issues[0].message

describe('Link', () => {
  it('keeps an https link as it is, but for what comes after #, and its spaces around it', () => {
    expect(Link.parse('  https://calendar.google.com/calendar/ical/x/private-abc/basic.ics ')).toBe('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics')
    expect(Link.parse('https://example.com/feed.ics?token=abc#part')).toBe('https://example.com/feed.ics?token=abc')
    expect(Link.parse('HTTPS://Example.COM')).toBe('https://example.com/')
  })

  it('reads a webcal link as the https link it stands for', () => {
    expect(Link.parse('webcal://p01-caldav.icloud.com/published/2/abc')).toBe('https://p01-caldav.icloud.com/published/2/abc')
    expect(Link.parse('WEBCAL://example.com/feed.ics?a=1#x')).toBe('https://example.com/feed.ics?a=1')
  })

  it('encodes the characters links cannot have', () => {
    expect(Link.parse('https://example.com/calendrier équipe.ics')).toBe('https://example.com/calendrier%20%C3%A9quipe.ics')
  })

  it('refuses what is neither an https nor a webcal link, without quoting it', () => {
    for (const sent of ['http://example.com/feed.ics', 'ftp://example.com/feed.ics', 'example.com/feed.ics', 'webcal:', 'https://', '', 'secret']) {
      expect(error(sent), sent).toBe('The link must be an https or webcal link')
    }
  })

  it('refuses a link with the NUL character, rather than dropping or encoding it', () => {
    for (const sent of ['https://example.com/a.ics\0', '\0https://example.com/a.ics', 'webcal://example.com/a\0b.ics']) {
      expect(error(sent), JSON.stringify(sent)).toBe('The link must be an https or webcal link')
    }
  })

  it('refuses a link with a user name or a password', () => {
    expect(error('https://user:secret@example.com/feed.ics')).toBe("The link can't have a user name or a password")
    expect(error('webcal://user@example.com/feed.ics')).toBe("The link can't have a user name or a password")
  })

  it(`refuses a link over ${LINK_MAX_LENGTH} characters as it's kept`, () => {
    const base = 'https://example.com/'
    expect(Link.parse(`${base}${'a'.repeat(LINK_MAX_LENGTH - base.length)}`)).toHaveLength(LINK_MAX_LENGTH)
    expect(error(`${base}${'a'.repeat(LINK_MAX_LENGTH - base.length + 1)}`)).toBe(`The link must be at most ${LINK_MAX_LENGTH} characters`)
    // Each é takes 6 characters once it's encoded.
    expect(error(`${base}${'é'.repeat(400)}`)).toBe(`The link must be at most ${LINK_MAX_LENGTH} characters`)
  })
})

describe('FeedName', () => {
  it('is trimmed, then between 1 and 100 characters', () => {
    expect(FeedName.parse('  Calendrier de l’équipe ')).toBe('Calendrier de l’équipe')
    expect(FeedName.safeParse('   ').error?.issues[0].message).toBe('The name must not be blank')
    expect(FeedName.safeParse('x'.repeat(101)).error?.issues[0].message).toBe('The name must be at most 100 characters')
  })
})
