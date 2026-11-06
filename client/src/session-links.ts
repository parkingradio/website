// The links of sessions and sets, by their id or link, as the server reduces them (see server/src/sessions/links.ts,
// which must be changed together with this). Each function returns null, or false, for what it doesn't take.

// The address `sent` is, if it's an http(s) one.
function address(sent: string): URL | null {
  const url = URL.parse(sent)
  return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url : null
}

// The host of `url`, without the `www.` or `m.` it can have.
function siteOf(url: URL): string {
  return url.hostname.replace(/^(?:www|m)\./, '')
}

const RA_EVENT_ID = /^\d{1,20}$/

// An event on RA, by its id, e.g. "6683745", or a link to its page, e.g. "https://ra.co/events/6683745".
export function raEventId(sent: string): string | null {
  if (RA_EVENT_ID.test(sent)) return sent
  const url = address(sent)
  const id = url && siteOf(url) === 'ra.co' ? /^\/events\/([^/]+)\/?$/.exec(url.pathname)?.[1] : undefined
  return id && RA_EVENT_ID.test(id) ? id : null
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

// A video on YouTube, by its id, or a link to it, e.g. "https://www.youtube.com/watch?v=<id>", "https://youtu.be/<id>"
// or "https://www.youtube.com/live/<id>".
export function youtubeVideoId(sent: string): string | null {
  if (YOUTUBE_VIDEO_ID.test(sent)) return sent
  const url = address(sent)
  if (!url) return null
  let id: string | null | undefined
  if (siteOf(url) === 'youtu.be') id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1]
  else if (siteOf(url) === 'youtube.com') {
    id = /^\/watch\/?$/.test(url.pathname) ? url.searchParams.get('v') : /^\/(?:live|shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1]
  }
  return id && YOUTUBE_VIDEO_ID.test(id) ? id : null
}

// A link to a track on soundcloud.com, or a private track's private link, which ends with its secret. Whether it's a
// track is up to SoundCloud, which the server asks: this only checks that it can be one.
const SOUNDCLOUD_TRACK_LINK = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com(\/[^/?#\s]+\/[^/?#\s]+(?:\/s-[^/?#\s]+)?)\/?(?:[?#]\S*)?$/

export function isSoundcloudTrackLink(sent: string): boolean {
  return SOUNDCLOUD_TRACK_LINK.test(sent)
}
