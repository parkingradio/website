// What the links of sessions and sets are reduced to: the id of a session's event on RA, and the link to a set's track
// on SoundCloud and the id of its video on YouTube (see "Links" in docs/design/server/sessions.md). Each function
// returns null for what it doesn't take.

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

export function raEventUrl(id: string): string {
  return `https://ra.co/events/${id}`
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

export function youtubeVideoUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}

// A link to a track on soundcloud.com, e.g. "https://soundcloud.com/parkingdotradio/3tons", or a private track's private
// link, which ends with its secret, e.g. "https://soundcloud.com/parkingdotradio/3tons/s-AbC123". Parameters, e.g.
// "?si=...", are allowed. Whether it's a track is up to SoundCloud: this only checks that it can be one.
const SOUNDCLOUD_TRACK_LINK = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com(\/[^/?#\s]+\/[^/?#\s]+(?:\/s-[^/?#\s]+)?)\/?(?:[?#]\S*)?$/

// The link to a track on SoundCloud, reduced to "https://soundcloud.com/<account>/<track>", with "/s-<secret>" for a
// private link.
export function soundcloudTrackLink(sent: string): string | null {
  const path = SOUNDCLOUD_TRACK_LINK.exec(sent)?.[1]
  return path ? `https://soundcloud.com${path}` : null
}
