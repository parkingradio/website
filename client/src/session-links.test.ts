import { describe, expect, it } from 'vitest'
import { isSoundcloudTrackLink, raEventId, youtubeVideoId } from './session-links'

// The client's copies of the server's rules for links, which must agree with them (see server/src/sessions/links.test.ts).

describe('raEventId', () => {
  it.each([
    ['6683745', '6683745'],
    ['https://ra.co/events/6683745', '6683745'],
    ['https://www.ra.co/events/6683745/', '6683745'],
    ['http://ra.co/events/6683745?utm=x#top', '6683745'],
  ])('reduces %s to its id', (sent, id) => {
    expect(raEventId(sent)).toBe(id)
  })

  it.each([
    ['an id that is not only digits', '6683745a'],
    ['an id that is too long', '1'.repeat(21)],
    ['a link to another page of RA', 'https://ra.co/promoters/183980'],
    ['a link to an event with another id', 'https://ra.co/events/abc'],
    ['a link to another site', 'https://example.com/events/6683745'],
    ['a link that is not http', 'ftp://ra.co/events/6683745'],
    ['a link to a page under the event', 'https://ra.co/events/6683745/tickets'],
  ])('refuses %s', (_, sent) => {
    expect(raEventId(sent)).toBeNull()
  })
})

describe('youtubeVideoId', () => {
  const id = 'dQw4w9WgXcQ'
  it.each([
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?feature=share&v=${id}&t=42`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/live/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}/`,
    `https://www.youtube.com/embed/${id}`,
    `http://youtube.com/watch/?v=${id}`,
  ])('reduces %s to its id', (sent) => {
    expect(youtubeVideoId(sent)).toBe(id)
  })

  it.each([
    ['an id that is too short', 'dQw4w9WgXc'],
    ['an id with other characters', 'dQw4w9WgX.Q'],
    ['a link without a video', 'https://www.youtube.com/watch'],
    ['a link to a channel', 'https://www.youtube.com/@parkingradio'],
    ['a link to a playlist', 'https://www.youtube.com/playlist?list=PL123'],
    ['a link to another site', `https://example.com/watch?v=${id}`],
    ['a link with a path under the video', `https://youtu.be/${id}/more`],
  ])('refuses %s', (_, sent) => {
    expect(youtubeVideoId(sent)).toBeNull()
  })
})

describe('isSoundcloudTrackLink', () => {
  it.each([
    'https://soundcloud.com/parkingdotradio/3tons',
    'https://www.soundcloud.com/parkingdotradio/3tons/',
    'http://m.soundcloud.com/parkingdotradio/3tons?si=abc&utm_source=x',
    'https://soundcloud.com/parkingdotradio/3tons/s-AbC123?si=abc',
  ])('takes %s', (sent) => {
    expect(isSoundcloudTrackLink(sent)).toBe(true)
  })

  it.each([
    ['a link to an account', 'https://soundcloud.com/parkingdotradio'],
    ['a link to a playlist', 'https://soundcloud.com/parkingdotradio/sets/rotation'],
    ['a short link, as the app shares them', 'https://on.soundcloud.com/AbCdE'],
    ['a link to another site', 'https://example.com/parkingdotradio/3tons'],
    ['something that is not a link', 'parkingdotradio/3tons'],
  ])('refuses %s', (_, sent) => {
    expect(isSoundcloudTrackLink(sent)).toBe(false)
  })
})

